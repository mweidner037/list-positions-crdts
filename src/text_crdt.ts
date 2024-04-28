import {
  BunchMeta,
  OrderSavedState,
  Outline,
  OutlineSavedState,
  Position,
  PositionSet,
  Text,
  TextSavedState,
} from "list-positions";

export type TextCrdtMessage =
  | {
      readonly type: "set";
      readonly startPos: Position;
      readonly chars: string;
      readonly meta?: BunchMeta;
    }
  // OPT: Use items instead of Position[].
  | { readonly type: "delete"; readonly poss: Position[] };

export type TextCrdtSavedState = {
  readonly order: OrderSavedState;
  readonly text: TextSavedState;
  readonly seen: OutlineSavedState;
};

// TODO: events

/**
 * A traditional op-based/state-based text CRDT implemented on top of list-positions.
 *
 * send/receive work on general networks (they build in exactly-once partial-order delivery),
 * and save/load work as state-based merging.
 *
 * Internally, its state is a Text (for values) and a PositionSet (for tracking
 * which Positions have been "seen"). This implementation uses Positions in messages
 * and manually manages metadata; in particular, it must buffer certain out-of-order
 * messages.
 */
export class TextCrdt {
  private readonly text: Text;
  /**
   * A set of all Positions we've ever seen, whether currently present or deleted.
   * Used for state-based merging and handling reordered messages.
   *
   * We use PositionSet here because we don't care about the list order. If you did,
   * you could use Outline instead, with the same Order as this.list
   * (`this.seen = new Outline(this.order);`).
   */
  private readonly seen: PositionSet;
  /**
   * Maps from bunchID to a Set of messages that are waiting on that
   * bunch's BunchMeta before they can be processed.
   */
  private readonly pending: Map<string, Set<TextCrdtMessage>>;

  constructor(private readonly send: (message: TextCrdtMessage) => void) {
    this.text = new Text();
    this.seen = new PositionSet();
    this.pending = new Map();
  }

  getAt(index: number): string {
    return this.text.getAt(index);
  }

  [Symbol.iterator](): IterableIterator<string> {
    return this.text.values();
  }

  values(): IterableIterator<string> {
    return this.text.values();
  }

  slice(start?: number, end?: number): string {
    return this.text.slice(start, end);
  }

  toString(): string {
    return this.text.toString();
  }

  insertAt(index: number, chars: string): void {
    const [pos, newMeta] = this.text.insertAt(index, chars);
    this.seen.add(pos);
    const message: TextCrdtMessage = {
      type: "set",
      startPos: pos,
      chars,
      ...(newMeta ? { meta: newMeta } : {}),
    };
    this.send(message);
  }

  deleteAt(index: number, count = 1): void {
    const poss = [...this.text.positions(index, index + count)];
    for (const pos of poss) this.text.delete(pos);
    const message: TextCrdtMessage = { type: "delete", poss };
    this.send(message);
  }

  receive(message: TextCrdtMessage): void {
    switch (message.type) {
      case "delete":
        for (const pos of message.poss) {
          // Mark the position as seen immediately, even if we don't have metadata
          // for its bunch yet. Okay because this.seen is a PositionSet instead of an Outline.
          this.seen.add(pos);
          // Delete the position if present.
          // If the bunch is unknown, it's definitely not present, and we
          // should skip calling text.has to avoid a "Missing metadata" error.
          if (
            this.text.order.getNode(pos.bunchID) !== undefined &&
            this.text.has(pos)
          ) {
            this.text.delete(pos);
          }
        }
        break;
      case "set": {
        // This check is okay even if we don't have metadata for pos's bunch yet,
        // because this.seen is a PositionSet instead of an Outline.
        if (this.seen.has(message.startPos)) {
          // The position has already been seen (inserted, inserted & deleted, or
          // deleted by an out-of-order message). So don't need to insert it again.
          return;
        }

        const bunchID = message.startPos.bunchID;
        if (message.meta) {
          const parentID = message.meta.parentID;
          if (this.text.order.getNode(parentID) === undefined) {
            // The meta can't be processed yet because its parent bunch is unknown.
            // Add it to pending.
            this.addToPending(parentID, message);
            return;
          } else this.text.order.addMetas([message.meta]);

          if (this.text.order.getNode(bunchID) === undefined) {
            // The message can't be processed yet because its bunch is unknown.
            // Add it to pending.
            this.addToPending(bunchID, message);
            return;
          }
        }

        // At this point, BunchMeta dependencies are satisfied. Process the message.
        this.text.set(message.startPos, message.chars);
        // Add to seen even before it's deleted, to reduce sparse-array fragmentation.
        this.seen.add(message.startPos, message.chars.length);

        if (message.meta) {
          // The meta may have unblocked pending messages.
          const unblocked = this.pending.get(message.meta.bunchID);
          if (unblocked !== undefined) {
            this.pending.delete(message.meta.bunchID);
            // TODO: if you unblock a long dependency chain (unlikely),
            // this recursion could overflow the stack.
            for (const msg2 of unblocked) this.receive(msg2);
          }
        }
        break;
      }
    }
  }

  private addToPending(bunchID: string, message: TextCrdtMessage): void {
    let bunchPending = this.pending.get(bunchID);
    if (bunchPending === undefined) {
      bunchPending = new Set();
      this.pending.set(bunchID, bunchPending);
    }
    bunchPending.add(message);
  }

  save(): TextCrdtSavedState {
    return {
      order: this.text.order.save(),
      text: this.text.save(),
      seen: this.seen.save(),
    };
  }

  load(savedState: TextCrdtSavedState): void {
    if (this.seen.state.size === 0) {
      // Never been used, so okay to load directly instead of doing a state-based
      // merge.
      this.text.order.load(savedState.order);
      this.text.load(savedState.text);
      this.seen.load(savedState.seen);
    } else {
      // TODO: benchmark merging.
      const otherText = new Text();
      const otherSeen = new Outline(otherText.order);
      otherText.order.load(savedState.order);
      otherText.load(savedState.text);
      otherSeen.load(savedState.seen);

      // Loop over all positions that had been inserted or deleted into
      // the other list.
      this.text.order.load(savedState.order);
      for (const pos of otherSeen) {
        if (!this.seen.has(pos)) {
          // pos is new to us. Copy its state from the other list.
          if (otherText.has(pos)) this.text.set(pos, otherText.get(pos)!);
          this.seen.add(pos);
        } else {
          // We already know of pos. If it's deleted in the other list,
          // ensure it's deleted here too.
          if (!otherText.has(pos)) this.text.delete(pos);
        }
      }
    }
  }
}
