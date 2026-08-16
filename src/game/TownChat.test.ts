// Phase 8 tests: ambient chatter cadence and player-chat routing.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { fallbackChatter, freshChatterState, maybeChatter, playerChatResponders, fallbackReply } from "./TownChat";

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

describe("ambient chatter", () => {
  it("produces a handful of messages per day, none at night", () => {
    const e = engine();
    const cs = freshChatterState();
    let count = 0;
    for (let t = 0; t < 1; t += 0.005) {
      e.state.timeOfDay = t;
      e.state.phase = t >= 0.8 ? "night" : t >= 0.6 ? "evening" : t >= 0.35 ? "afternoon" : "morning";
      if (maybeChatter(e.state, cs)) count++;
    }
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(8);
  });

  it("fallback lines reflect state (grudge, regular)", () => {
    const e = engine();
    const a = e.state.adventurers[0];
    a.relationships.shopkeeper = -60;
    // Some line pool must include the grumble; sample across days.
    const lines = new Set<string>();
    for (let d = 1; d < 15; d++) {
      e.state.day = d;
      lines.add(fallbackChatter(a, e.state));
    }
    expect([...lines].some((l) => l.includes("out of hand"))).toBe(true);
  });
});

describe("player chat", () => {
  it("routes stock announcements to gear-needy adventurers", () => {
    const e = engine();
    const rs = playerChatResponders(e.state, "Just got a shipment of steel swords!");
    expect(rs.length).toBeGreaterThan(0);
    expect(rs.length).toBeLessThanOrEqual(2);
  });

  it("routes danger warnings to the cautious", () => {
    const e = engine();
    const rs = playerChatResponders(e.state, "Be careful in Shadow Cave today");
    for (const a of rs) expect(a.personality.riskTolerance).toBeLessThan(50);
  });

  it("a named adventurer answers directly", () => {
    const e = engine();
    const target = e.state.adventurers[2];
    const first = target.name.split(" ")[0];
    const rs = playerChatResponders(e.state, `${first}, want to buy this potion?`);
    expect(rs).toHaveLength(1);
    expect(rs[0].id).toBe(target.id);
  });

  it("engine.sendPlayerChat appends the message and at least one reply", () => {
    const e = engine();
    const before = e.state.messages.length;
    e.sendPlayerChat("Fresh potions on the shelves!");
    const added = e.state.messages.slice(before);
    expect(added[0].type).toBe("player");
    expect(added.length).toBeGreaterThanOrEqual(2); // player + >=1 reply
    expect(added.slice(1).every((m) => m.type === "social")).toBe(true);
  });

  it("ignores empty input", () => {
    const e = engine();
    const before = e.state.messages.length;
    e.sendPlayerChat("   ");
    expect(e.state.messages.length).toBe(before);
  });

  it("fallback replies stay on topic", () => {
    const e = engine();
    const a = e.state.adventurers[0];
    expect(fallbackReply(a, "new swords in stock")).toMatch(/look|coin/);
    expect(fallbackReply(a, "danger in the cave")).toMatch(/challenge|warning/i);
  });
});
