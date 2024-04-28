import {
  BunchMeta,
  List,
  ListSavedState,
  OrderSavedState,
  Outline,
  OutlineSavedState,
  Position,
  PositionSet,
} from "list-positions";

export type ListCrdtMessage<T> =
  | {
      readonly type: "set";
      readonly startPos: Position;
      readonly values: T[];
      readonly meta?: BunchMeta;
    }
  // OPT: Use items instead of Position[].
  | { readonly type: "delete"; readonly poss: Position[] };

export type ListCrdtSavedState<T> = {
  readonly order: OrderSavedState;
  readonly list: ListSavedState<T>;
  readonly seen: OutlineSavedState;
};

// TODO: events

/**
 * A traditional op-based/state-based list CRDT implemented on top of list-positions.
 *
 * send/receive work on general networks (they build in exactly-once partial-order delivery),
 * and save/load work as state-based merging.
 *
 * Internally, its state is a `List<T>` (for values) and a PositionSet (for tracking
 * which Positions have been "seen"). This implementation uses Positions in messages
 * and manually manages metadata; in particular, it must buffer certain out-of-order
 * messages.
 */
export class ListCrdt<T> {
  private readonly list: List<T>;
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
  private readonly pending: Map<string, Set<ListCrdtMessage<T>>>;

  constructor(private readonly send: (message: ListCrdtMessage<T>) => void) {
    this.list = new List();
    this.seen = new PositionSet();
    this.pending = new Map();
  }

  getAt(index: number): T {
    return this.list.getAt(index);
  }

  [Symbol.iterator](): IterableIterator<T> {
    return this.list.values();
  }

  values(): IterableIterator<T> {
    return this.list.values();
  }

  slice(start?: number, end?: number): T[] {
    return this.list.slice(start, end);
  }

  insertAt(index: number, ...values: T[]): void {
    const [pos, newMeta] = this.list.insertAt(index, ...values);
    this.seen.add(pos);
    const message: ListCrdtMessage<T> = {
      type: "set",
      startPos: pos,
      values,
      ...(newMeta ? { meta: newMeta } : {}),
    };
    this.send(message);
  }

  deleteAt(index: number, count = 1): void {
    const poss = [...this.list.positions(index, index + count)];
    for (const pos of poss) this.list.delete(pos);
    const message: ListCrdtMessage<T> = { type: "delete", poss };
    this.send(message);
  }

  receive(message: ListCrdtMessage<T>): void {
    switch (message.type) {
      case "delete":
        for (const pos of message.poss) {
          // Mark the position as seen immediately, even if we don't have metadata
          // for its bunch yet. Okay because this.seen is a PositionSet instead of an Outline.
          this.seen.add(pos);
          // Delete the position if present.
          // If the bunch is unknown, it's definitely not present, and we
          // should skip calling list.has to avoid a "Missing metadata" error.
          if (
            this.list.order.getNode(pos.bunchID) !== undefined &&
            this.list.has(pos)
          ) {
            this.list.delete(pos);
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
          if (this.list.order.getNode(parentID) === undefined) {
            // The meta can't be processed yet because its parent bunch is unknown.
            // Add it to pending.
            this.addToPending(parentID, message);
            return;
          } else this.list.order.addMetas([message.meta]);

          if (this.list.order.getNode(bunchID) === undefined) {
            // The message can't be processed yet because its bunch is unknown.
            // Add it to pending.
            this.addToPending(bunchID, message);
            return;
          }
        }

        // At this point, BunchMeta dependencies are satisfied. Process the message.
        this.list.set(message.startPos, ...message.values);
        // Add to seen even before it's deleted, to reduce sparse-array fragmentation.
        this.seen.add(message.startPos, message.values.length);

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

  private addToPending(bunchID: string, message: ListCrdtMessage<T>): void {
    let bunchPending = this.pending.get(bunchID);
    if (bunchPending === undefined) {
      bunchPending = new Set();
      this.pending.set(bunchID, bunchPending);
    }
    bunchPending.add(message);
  }

  save(): ListCrdtSavedState<T> {
    return {
      order: this.list.order.save(),
      list: this.list.save(),
      seen: this.seen.save(),
    };
  }

  load(savedState: ListCrdtSavedState<T>): void {
    if (this.seen.state.size === 0) {
      // Never been used, so okay to load directly instead of doing a state-based
      // merge.
      this.list.order.load(savedState.order);
      this.list.load(savedState.list);
      this.seen.load(savedState.seen);
    } else {
      // TODO: benchmark merging.
      const otherList = new List<T>();
      const otherSeen = new Outline(otherList.order);
      otherList.order.load(savedState.order);
      otherList.load(savedState.list);
      otherSeen.load(savedState.seen);

      // Loop over all positions that had been inserted or deleted into
      // the other list.
      this.list.order.load(savedState.order);
      for (const pos of otherSeen) {
        if (!this.seen.has(pos)) {
          // pos is new to us. Copy its state from the other list.
          if (otherList.has(pos)) this.list.set(pos, otherList.get(pos)!);
          this.seen.add(pos);
        } else {
          // We already know of pos. If it's deleted in the other list,
          // ensure it's deleted here too.
          if (!otherList.has(pos)) this.list.delete(pos);
        }
      }
    }
  }
}
