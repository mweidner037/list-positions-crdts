import { describe } from "mocha";
import { assert } from "chai";
import { TextCrdt, TextCrdtMessage } from "../src";

describe("TextCrdt", () => {
  let alice!: TextCrdt;
  let bob!: TextCrdt;

  let getAliceMessage!: () => TextCrdtMessage;
  let getBobMessage!: () => TextCrdtMessage;

  beforeEach(() => {
    let aliceMessage: TextCrdtMessage | null = null;
    alice = new TextCrdt((message) => {
      aliceMessage = message;
    });
    getAliceMessage = () => {
      assert.isNotNull(aliceMessage);
      const ans = aliceMessage!;
      aliceMessage = null;
      return ans;
    };

    let bobMessage: TextCrdtMessage | null = null;
    bob = new TextCrdt((message) => {
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
    alice.insertAt(0, "abc");
    assert.strictEqual(alice.toString(), "abc");

    bob.receive(getAliceMessage());
    assert.strictEqual(bob.toString(), "abc");

    bob.insertAt(2, "d");
    assert.strictEqual(bob.toString(), "abdc");

    alice.receive(getBobMessage());
    assert.strictEqual(alice.toString(), "abdc");
  });

  it("deletes", () => {
    alice.insertAt(0, "abcdefghij");
    bob.receive(getAliceMessage());

    alice.deleteAt(3, 2);
    assert.strictEqual(alice.toString(), "abcfghij");

    bob.receive(getAliceMessage());
    assert.strictEqual(bob.toString(), "abcfghij");

    bob.deleteAt(6);
    assert.strictEqual(bob.toString(), "abcfghj");

    alice.receive(getBobMessage());
    assert.strictEqual(alice.toString(), "abcfghj");
  });

  it("skips redundant inserts", () => {
    alice.insertAt(0, "abc");
    assert.strictEqual(alice.toString(), "abc");

    bob.receive(getAliceMessage());
    assert.strictEqual(bob.toString(), "abc");

    bob.insertAt(2, "d");
    assert.strictEqual(bob.toString(), "abdc");

    const message = getBobMessage();
    alice.receive(message);
    assert.strictEqual(alice.toString(), "abdc");

    // Receive again.
    bob.receive(message);
    assert.strictEqual(bob.toString(), "abdc");
    alice.receive(message);
    assert.strictEqual(alice.toString(), "abdc");

    // Delete the "d", then receive again.
    alice.deleteAt(2);
    assert.strictEqual(alice.toString(), "abc");
    bob.receive(getAliceMessage());
    assert.strictEqual(bob.toString(), "abc");

    alice.receive(message);
    assert.strictEqual(alice.toString(), "abc");
    bob.receive(message);
    assert.strictEqual(bob.toString(), "abc");
  });

  it("skips redundant deletes", () => {
    alice.insertAt(0, "abcde");
    assert.strictEqual(alice.toString(), "abcde");

    bob.receive(getAliceMessage());
    assert.strictEqual(bob.toString(), "abcde");

    bob.deleteAt(2);
    assert.strictEqual(bob.toString(), "abde");

    const message = getBobMessage();
    alice.receive(message);
    assert.strictEqual(alice.toString(), "abde");

    // Receive again.
    bob.receive(message);
    assert.strictEqual(bob.toString(), "abde");
    alice.receive(message);
    assert.strictEqual(alice.toString(), "abde");
  });

  it("allows delete before insert message", () => {
    alice.insertAt(0, "a");
    bob.receive(getAliceMessage());

    // This uses the same bunch as "a", so bob knows the bunch, just not the insert.
    alice.insertAt(1, "bcde");
    const m1 = getAliceMessage();
    alice.deleteAt(2, 1);
    const m2 = getAliceMessage();
    assert.strictEqual(alice.toString(), "abde");

    bob.receive(m2);
    assert.strictEqual(bob.toString(), "a");

    // Should remember that m2 was deleted.
    bob.receive(m1);
    assert.strictEqual(bob.toString(), "abde");
  });

  it("allows delete with missing deps", () => {
    alice.insertAt(0, "abcde");
    const m1 = getAliceMessage();
    alice.deleteAt(2, 1);
    const m2 = getAliceMessage();
    assert.strictEqual(alice.toString(), "abde");

    // Receive delete without dependent BunchMeta.
    bob.receive(m2);
    assert.strictEqual(bob.toString(), "");

    // Should remember that m2 was deleted.
    bob.receive(m1);
    assert.strictEqual(bob.toString(), "abde");
  });

  it("buffers missing deps", () => {
    // Create a chain of bunches in the tree.
    const ms: TextCrdtMessage[] = [];
    for (let i = 0; i < 10; i++) {
      alice.insertAt(0, `${i}`);
      ms.push(getAliceMessage());
    }
    assert.strictEqual(alice.toString(), "9876543210");

    // Deliver then out-of-order to Bob. Check that inserts are unblocked
    // by dependents' delivery.
    bob.receive(ms[1]);
    assert.strictEqual(bob.toString(), "");
    bob.receive(ms[0]);
    assert.strictEqual(bob.toString(), "10");

    bob.receive(ms[4]);
    assert.strictEqual(bob.toString(), "10");
    bob.receive(ms[3]);
    assert.strictEqual(bob.toString(), "10");
    bob.receive(ms[2]);
    assert.strictEqual(bob.toString(), "43210");

    bob.receive(ms[9]);
    assert.strictEqual(bob.toString(), "43210");
    bob.receive(ms[8]);
    assert.strictEqual(bob.toString(), "43210");
    bob.receive(ms[6]);
    assert.strictEqual(bob.toString(), "43210");
    bob.receive(ms[5]);
    assert.strictEqual(bob.toString(), "6543210");
    bob.receive(ms[7]);
    assert.strictEqual(bob.toString(), "9876543210");
  });

  it("buffers missing deps - bulk", () => {
    // Create a chain of bunches in the tree.
    const ms: TextCrdtMessage[] = [];
    for (let i = 0; i < 10; i++) {
      alice.insertAt(0, `${i}${i}${i}`);
      ms.push(getAliceMessage());
    }
    assert.strictEqual(alice.toString(), "999888777666555444333222111000");

    // Deliver then out-of-order to Bob. Check that inserts are unblocked
    // by dependents' delivery.
    bob.receive(ms[1]);
    assert.strictEqual(bob.toString(), "");
    bob.receive(ms[0]);
    assert.strictEqual(bob.toString(), "111000");

    bob.receive(ms[4]);
    assert.strictEqual(bob.toString(), "111000");
    bob.receive(ms[3]);
    assert.strictEqual(bob.toString(), "111000");
    bob.receive(ms[2]);
    assert.strictEqual(bob.toString(), "444333222111000");

    bob.receive(ms[9]);
    assert.strictEqual(bob.toString(), "444333222111000");
    bob.receive(ms[8]);
    assert.strictEqual(bob.toString(), "444333222111000");
    bob.receive(ms[6]);
    assert.strictEqual(bob.toString(), "444333222111000");
    bob.receive(ms[5]);
    assert.strictEqual(bob.toString(), "666555444333222111000");
    bob.receive(ms[7]);
    assert.strictEqual(bob.toString(), "999888777666555444333222111000");
  });

  it("skips redundant messages after reload", () => {
    alice.insertAt(0, "a");
    const m1 = getAliceMessage();
    alice.insertAt(1, "bcde");
    const m2 = getAliceMessage();
    alice.deleteAt(0);
    const m3 = getAliceMessage();
    alice.deleteAt(0, 2);
    const m4 = getAliceMessage();

    assert.strictEqual(alice.toString(), "de");

    bob.load(alice.save());
    assert.strictEqual(bob.toString(), "de");

    // The messages should be redundant, including for the reloaded state.
    for (const m of [m1, m2, m3, m4]) {
      alice.receive(m);
      assert.strictEqual(alice.toString(), "de");
    }
    for (const m of [m1, m2, m3, m4]) {
      bob.receive(m);
      assert.strictEqual(bob.toString(), "de");
    }
  });

  it("remembers buffer after reload", () => {
    alice.insertAt(0, "abcde");
    bob.receive(getAliceMessage());

    // Create 3 messages, latter 2 depend on the first.
    alice.insertAt(2, "fgh");
    const m1 = getAliceMessage();
    alice.insertAt(3, "ijk");
    const m2 = getAliceMessage();
    alice.deleteAt(4);
    const m3 = getAliceMessage();
    assert.strictEqual(alice.toString(), "abfikghcde");

    // Give latter 2 message to Bob - does nothing for now.
    bob.receive(m2);
    assert.strictEqual(bob.toString(), "abcde");
    bob.receive(m3);
    assert.strictEqual(bob.toString(), "abcde");

    // Load the state on a new replica.
    const charlie = new TextCrdt(() => {});
    charlie.load(bob.save());
    assert.strictEqual(charlie.toString(), "abcde");

    // Unblock buffered messages, including on the new replica.
    bob.receive(m1);
    assert.strictEqual(bob.toString(), "abfikghcde");

    charlie.receive(m1);
    assert.strictEqual(charlie.toString(), "abfikghcde");
  });

  it("merges inserts", () => {
    alice.insertAt(0, "abc");
    bob.insertAt(0, "def");

    const bobSave = bob.save();
    bob.load(alice.save());
    alice.load(bobSave);

    // Merge can be either "abcdef" or "defabc".
    const ans = alice.getAt(0) === "a" ? "abcdef" : "defabc";
    assert.strictEqual(alice.toString(), ans);
    assert.strictEqual(bob.toString(), ans);
  });

  it("merges delete", () => {
    alice.insertAt(0, "abcde");
    bob.receive(getAliceMessage());

    bob.deleteAt(2, 2);
    assert.strictEqual(bob.toString(), "abe");
    alice.load(bob.save());
    assert.strictEqual(alice.toString(), "abe");
  });

  it("merges delete of new pos", () => {
    alice.insertAt(0, "abcde");
    bob.receive(getAliceMessage());

    // Insert something, then delete part of it.
    bob.insertAt(0, "fghi");
    bob.deleteAt(2, 2);
    assert.strictEqual(bob.toString(), "fgabcde");

    // Merging should receive the pos but see it as deleted.
    alice.load(bob.save());
    assert.strictEqual(alice.toString(), "fgabcde");

    // Receiving the insert again is redundant.
    alice.receive(getBobMessage());
    assert.strictEqual(alice.toString(), "fgabcde");
  });

  it("merges buffered messages", () => {
    alice.insertAt(0, "abcde");
    bob.receive(getAliceMessage());

    // Create 3 messages, latter 2 depend on the first.
    alice.insertAt(2, "fgh");
    // const m1 = getAliceMessage();
    alice.insertAt(3, "ijk");
    const m2 = getAliceMessage();
    alice.deleteAt(4);
    const m3 = getAliceMessage();
    assert.strictEqual(alice.toString(), "abfikghcde");

    // Give latter 2 message to Bob - does nothing for now.
    bob.receive(m2);
    assert.strictEqual(bob.toString(), "abcde");
    bob.receive(m3);
    assert.strictEqual(bob.toString(), "abcde");

    // Unblock buffered messages by merging.
    bob.load(alice.save());
    assert.strictEqual(bob.toString(), "abfikghcde");
  });
});
