// Phase 6 tests: morale drift, departures, reputation spread, regulars.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { processDayEnd, arrivalBonus, isRegular, REGULAR_LOYALTY } from "./MoraleSystem";

const store = new Map<string, string>();
beforeEach(() => store.clear());
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

function engine(): GameEngine {
  const e = new GameEngine(false);
  e.state.aiMode = "off";
  return e;
}

describe("processDayEnd", () => {
  it("drifts morale toward the resting point from both directions", () => {
    const e = engine();
    e.state.adventurers[0].morale = 10;
    e.state.adventurers[1].morale = 95;
    processDayEnd(e.state);
    expect(e.state.adventurers[0].morale).toBe(13); // +3 upward
    expect(e.state.adventurers[1].morale).toBe(94); // -1 downward
  });

  it("makes a persistently miserable adventurer leave town", () => {
    const e = engine();
    const a = e.state.adventurers[0];
    let departed = 0;
    for (let day = 0; day < 10 && a.alive; day++) {
      a.morale = 5; // something keeps grinding them down
      const r = processDayEnd(e.state);
      departed += r.departed.length;
    }
    expect(a.alive).toBe(false);
    expect(departed).toBe(1);
  });

  it("recovering morale resets the countdown", () => {
    const e = engine();
    const a = e.state.adventurers[0];
    a.morale = 5;
    processDayEnd(e.state);
    processDayEnd(e.state);
    expect(a.memory.lowMoraleDays).toBeGreaterThan(0);
    a.morale = 80; // a good day
    processDayEnd(e.state);
    expect(a.memory.lowMoraleDays).toBe(0);
    expect(a.alive).toBe(true);
  });

  it("spreads reputation: one burned customer sours the bystanders", () => {
    const e = engine();
    for (const a of e.state.adventurers) a.relationships.shopkeeper = 0;
    e.state.adventurers[0].relationships.shopkeeper = -90; // one burned customer
    const r = processDayEnd(e.state);
    expect(r.reputation).toBeLessThan(0);
    // The bystanders heard about it at the tavern.
    expect(e.state.adventurers[3].relationships.shopkeeper).toBeLessThan(0);
  });

  it("sustained bad reputation grinds morale down past the drift", () => {
    const e = engine();
    for (const a of e.state.adventurers) a.relationships.shopkeeper = -60;
    const before = e.state.adventurers[0].morale;
    processDayEnd(e.state);
    processDayEnd(e.state);
    expect(e.state.adventurers[0].morale).toBeLessThan(before);
  });

  it("announces a new regular exactly once", () => {
    const e = engine();
    const a = e.state.adventurers[0];
    a.loyalty = REGULAR_LOYALTY;
    expect(isRegular(a)).toBe(true);
    const first = processDayEnd(e.state);
    const second = processDayEnd(e.state);
    const regularMsgs = (msgs: typeof first.messages) =>
      msgs.filter((m) => m.content.includes("regular")).length;
    expect(regularMsgs(first.messages)).toBe(1);
    expect(regularMsgs(second.messages)).toBe(0);
  });
});

describe("arrivalBonus", () => {
  it("shaves wait days as reputation climbs", () => {
    expect(arrivalBonus(-0.5)).toBe(0);
    expect(arrivalBonus(0.4)).toBe(1);
    expect(arrivalBonus(0.9)).toBe(2);
  });
});
