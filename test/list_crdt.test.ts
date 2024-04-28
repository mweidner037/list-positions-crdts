import { describe } from "mocha";
import { assert } from "chai";
import { ListCrdt, ListCrdtMessage } from "../src";

describe("ListCrdt", () => {
  let alice!: ListCrdt<string>;
  let bob!: ListCrdt<string>;

  let getAliceMessage!: () => ListCrdtMessage<string>;
  let getBobMessage!: () => ListCrdtMessage<string>;

  beforeEach(() => {
    let aliceMessage: ListCrdtMessage<string> | null = null;
    alice = new ListCrdt((message) => {
      aliceMessage = message;
    });
    getAliceMessage = () => {
      assert.isNotNull(aliceMessage);
      const ans = aliceMessage!;
      aliceMessage = null;
      return ans;
    };

    let bobMessage: ListCrdtMessage<string> | null = null;
    bob = new ListCrdt((message) => {
      bobMessage = message;
    });
    getBobMessage = () => {
      assert.isNotNull(bobMessage);
      const ans = bobMessage!;
      bobMessage = null;
      return ans;
    };
  });

  it("inserts", () => {
    alice.insertAt(0, ..."abc");
    assert.deepStrictEqual(alice.slice(), [..."abc"]);

    bob.receive(getAliceMessage());
    assert.deepStrictEqual(bob.slice(), [..."abc"]);

    bob.insertAt(2, ..."d");
    assert.deepStrictEqual(bob.slice(), [..."abdc"]);

    alice.receive(getBobMessage());
    assert.deepStrictEqual(alice.slice(), [..."abdc"]);
  });

  it("deletes", () => {
    alice.insertAt(0, ..."abcdefghij");
    bob.receive(getAliceMessage());

    alice.deleteAt(3, 2);
    assert.deepStrictEqual(alice.slice(), [..."abcfghij"]);

    bob.receive(getAliceMessage());
    assert.deepStrictEqual(bob.slice(), [..."abcfghij"]);

    bob.deleteAt(6);
    assert.deepStrictEqual(bob.slice(), [..."abcfghj"]);

    alice.receive(getBobMessage());
    assert.deepStrictEqual(alice.slice(), [..."abcfghj"]);
  });

  it("skips redundant inserts", () => {
    alice.insertAt(0, ..."abc");
    assert.deepStrictEqual(alice.slice(), [..."abc"]);

    bob.receive(getAliceMessage());
    assert.deepStrictEqual(bob.slice(), [..."abc"]);

    bob.insertAt(2, ..."d");
    assert.deepStrictEqual(bob.slice(), [..."abdc"]);

    const message = getBobMessage();
    alice.receive(message);
    assert.deepStrictEqual(alice.slice(), [..."abdc"]);

    // Receive again.
    bob.receive(message);
    assert.deepStrictEqual(bob.slice(), [..."abdc"]);
    alice.receive(message);
    assert.deepStrictEqual(alice.slice(), [..."abdc"]);

    // Delete the "d", then receive again.
    alice.deleteAt(2);
    assert.deepStrictEqual(alice.slice(), [..."abc"]);
    bob.receive(getAliceMessage());
    assert.deepStrictEqual(bob.slice(), [..."abc"]);

    alice.receive(message);
    assert.deepStrictEqual(alice.slice(), [..."abc"]);
    bob.receive(message);
    assert.deepStrictEqual(bob.slice(), [..."abc"]);
  });

  it("skips redundant deletes", () => {
    alice.insertAt(0, ..."abcde");
    assert.deepStrictEqual(alice.slice(), [..."abcde"]);

    bob.receive(getAliceMessage());
    assert.deepStrictEqual(bob.slice(), [..."abcde"]);

    bob.deleteAt(2);
    assert.deepStrictEqual(bob.slice(), [..."abde"]);

    const message = getBobMessage();
    alice.receive(message);
    assert.deepStrictEqual(alice.slice(), [..."abde"]);

    // Receive again.
    bob.receive(message);
    assert.deepStrictEqual(bob.slice(), [..."abde"]);
    alice.receive(message);
    assert.deepStrictEqual(alice.slice(), [..."abde"]);
  });

  it("allows delete before insert message", () => {
    alice.insertAt(0, ..."a");
    bob.receive(getAliceMessage());

    // This uses the same bunch as "a", so bob knows the bunch, just not the insert.
    alice.insertAt(1, ..."bcde");
    const m1 = getAliceMessage();
    alice.deleteAt(2, 1);
    const m2 = getAliceMessage();
    assert.deepStrictEqual(alice.slice(), [..."abde"]);

    bob.receive(m2);
    assert.deepStrictEqual(bob.slice(), [..."a"]);

    // Should remember that m2 was deleted.
    bob.receive(m1);
    assert.deepStrictEqual(bob.slice(), [..."abde"]);
  });

  it("allows delete with missing deps", () => {
    alice.insertAt(0, ..."abcde");
    const m1 = getAliceMessage();
    alice.deleteAt(2, 1);
    const m2 = getAliceMessage();
    assert.deepStrictEqual(alice.slice(), [..."abde"]);

    // Receive delete without dependent BunchMeta.
    bob.receive(m2);
    assert.deepStrictEqual(bob.slice(), [...""]);

    // Should remember that m2 was deleted.
    bob.receive(m1);
    assert.deepStrictEqual(bob.slice(), [..."abde"]);
  });

  it("buffers missing deps", () => {
    // Create a chain of bunches in the tree.
    const ms: ListCrdtMessage<string>[] = [];
    for (let i = 0; i < 10; i++) {
      alice.insertAt(0, `${i}`);
      ms.push(getAliceMessage());
    }
    assert.deepStrictEqual(alice.slice(), [..."9876543210"]);

    // Deliver then out-of-order to Bob. Check that inserts are unblocked
    // by dependents' delivery.
    bob.receive(ms[1]);
    assert.deepStrictEqual(bob.slice(), [...""]);
    bob.receive(ms[0]);
    assert.deepStrictEqual(bob.slice(), [..."10"]);

    bob.receive(ms[4]);
    assert.deepStrictEqual(bob.slice(), [..."10"]);
    bob.receive(ms[3]);
    assert.deepStrictEqual(bob.slice(), [..."10"]);
    bob.receive(ms[2]);
    assert.deepStrictEqual(bob.slice(), [..."43210"]);

    bob.receive(ms[9]);
    assert.deepStrictEqual(bob.slice(), [..."43210"]);
    bob.receive(ms[8]);
    assert.deepStrictEqual(bob.slice(), [..."43210"]);
    bob.receive(ms[6]);
    assert.deepStrictEqual(bob.slice(), [..."43210"]);
    bob.receive(ms[5]);
    assert.deepStrictEqual(bob.slice(), [..."6543210"]);
    bob.receive(ms[7]);
    assert.deepStrictEqual(bob.slice(), [..."9876543210"]);
  });

  it("buffers missing deps - bulk", () => {
    // Create a chain of bunches in the tree.
    const ms: ListCrdtMessage<string>[] = [];
    for (let i = 0; i < 10; i++) {
      alice.insertAt(0, ...`${i}${i}${i}`);
      ms.push(getAliceMessage());
    }
    assert.deepStrictEqual(alice.slice(), [
      ..."999888777666555444333222111000",
    ]);

    // Deliver then out-of-order to Bob. Check that inserts are unblocked
    // by dependents' delivery.
    bob.receive(ms[1]);
    assert.deepStrictEqual(bob.slice(), [...""]);
    bob.receive(ms[0]);
    assert.deepStrictEqual(bob.slice(), [..."111000"]);

    bob.receive(ms[4]);
    assert.deepStrictEqual(bob.slice(), [..."111000"]);
    bob.receive(ms[3]);
    assert.deepStrictEqual(bob.slice(), [..."111000"]);
    bob.receive(ms[2]);
    assert.deepStrictEqual(bob.slice(), [..."444333222111000"]);

    bob.receive(ms[9]);
    assert.deepStrictEqual(bob.slice(), [..."444333222111000"]);
    bob.receive(ms[8]);
    assert.deepStrictEqual(bob.slice(), [..."444333222111000"]);
    bob.receive(ms[6]);
    assert.deepStrictEqual(bob.slice(), [..."444333222111000"]);
    bob.receive(ms[5]);
    assert.deepStrictEqual(bob.slice(), [..."666555444333222111000"]);
    bob.receive(ms[7]);
    assert.deepStrictEqual(bob.slice(), [..."999888777666555444333222111000"]);
  });

  it("skips redundant messages after reload", () => {
    alice.insertAt(0, ..."a");
    const m1 = getAliceMessage();
    alice.insertAt(1, ..."bcde");
    const m2 = getAliceMessage();
    alice.deleteAt(0);
    const m3 = getAliceMessage();
    alice.deleteAt(0, 2);
    const m4 = getAliceMessage();

    assert.deepStrictEqual(alice.slice(), [..."de"]);

    bob.load(alice.save());
    assert.deepStrictEqual(bob.slice(), [..."de"]);

    // The messages should be redundant, including for the reloaded state.
    for (const m of [m1, m2, m3, m4]) {
      alice.receive(m);
      assert.deepStrictEqual(alice.slice(), [..."de"]);
    }
    for (const m of [m1, m2, m3, m4]) {
      bob.receive(m);
      assert.deepStrictEqual(bob.slice(), [..."de"]);
    }
  });

  it("remembers buffer after reload", () => {
    alice.insertAt(0, ..."abcde");
    bob.receive(getAliceMessage());

    // Create 3 messages, latter 2 depend on the first.
    alice.insertAt(2, ..."fgh");
    const m1 = getAliceMessage();
    alice.insertAt(3, ..."ijk");
    const m2 = getAliceMessage();
    alice.deleteAt(4);
    const m3 = getAliceMessage();
    assert.deepStrictEqual(alice.slice(), [..."abfikghcde"]);

    // Give latter 2 message to Bob - does nothing for now.
    bob.receive(m2);
    assert.deepStrictEqual(bob.slice(), [..."abcde"]);
    bob.receive(m3);
    assert.deepStrictEqual(bob.slice(), [..."abcde"]);

    // Load the state on a new replica.
    const charlie = new ListCrdt(() => {});
    charlie.load(bob.save());
    assert.deepStrictEqual(charlie.slice(), [..."abcde"]);

    // Unblock buffered messages, including on the new replica.
    bob.receive(m1);
    assert.deepStrictEqual(bob.slice(), [..."abfikghcde"]);

    charlie.receive(m1);
    assert.deepStrictEqual(charlie.slice(), [..."abfikghcde"]);
  });

  it("merges inserts", () => {
    alice.insertAt(0, ..."abc");
    bob.insertAt(0, ..."def");

    const bobSave = bob.save();
    bob.load(alice.save());
    alice.load(bobSave);

    // Merge can be either "abcdef" or "defabc".
    const ans = alice.getAt(0) === "a" ? [..."abcdef"] : [..."defabc"];
    assert.deepStrictEqual(alice.slice(), ans);
    assert.deepStrictEqual(bob.slice(), ans);
  });

  it("merges delete", () => {
    alice.insertAt(0, ..."abcde");
    bob.receive(getAliceMessage());

    bob.deleteAt(2, 2);
    assert.deepStrictEqual(bob.slice(), [..."abe"]);
    alice.load(bob.save());
    assert.deepStrictEqual(alice.slice(), [..."abe"]);
  });

  it("merges delete of new pos", () => {
    alice.insertAt(0, ..."abcde");
    bob.receive(getAliceMessage());

    // Insert something, then delete part of it.
    bob.insertAt(0, ..."fghi");
    bob.deleteAt(2, 2);
    assert.deepStrictEqual(bob.slice(), [..."fgabcde"]);

    // Merging should receive the pos but see it as deleted.
    alice.load(bob.save());
    assert.deepStrictEqual(alice.slice(), [..."fgabcde"]);

    // Receiving the insert again is redundant.
    alice.receive(getBobMessage());
    assert.deepStrictEqual(alice.slice(), [..."fgabcde"]);
  });

  it("merges buffered messages", () => {
    alice.insertAt(0, ..."abcde");
    bob.receive(getAliceMessage());

    // Create 3 messages, latter 2 depend on the first.
    alice.insertAt(2, ..."fgh");
    // const m1 = getAliceMessage();
    alice.insertAt(3, ..."ijk");
    const m2 = getAliceMessage();
    alice.deleteAt(4);
    const m3 = getAliceMessage();
    assert.deepStrictEqual(alice.slice(), [..."abfikghcde"]);

    // Give latter 2 message to Bob - does nothing for now.
    bob.receive(m2);
    assert.deepStrictEqual(bob.slice(), [..."abcde"]);
    bob.receive(m3);
    assert.deepStrictEqual(bob.slice(), [..."abcde"]);

    // Unblock buffered messages by merging.
    bob.load(alice.save());
    assert.deepStrictEqual(bob.slice(), [..."abfikghcde"]);
  });
});
