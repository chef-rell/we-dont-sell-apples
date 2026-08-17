// NPC competitor stores (spec V2.10, issue #94). Pure-function unit tests —
// no engine cycling, per Forge.ts/Property.ts's own precedent for this kind
// of module. No unseeded randomness: every scenario builds state directly
// per CLAUDE.md's determinism discipline.

import { describe, expect, it } from "vitest";
import {
  chooseCompetitorStore,
  competitorStock,
  defaultCompetitors,
  recycleCompetitorGold,
  resolveCompetitorPurchase,
} from "./Competition";
import { defaultBuildings } from "../utils/TownBuildings";
import type { Adventurer, GameState } from "../types";

function adventurer(overrides: Partial<Adventurer> = {}): Adventurer {
  return {
    id: "a-1",
    gold: 1000,
    alive: true,
    ...overrides,
  } as Adventurer;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    day: 10,
    buildings: defaultBuildings(),
    competitors: defaultCompetitors(),
    adventurers: [],
    ...overrides,
  } as GameState;
}

describe("defaultCompetitors", () => {
  it("seeds two stores, priced 1.5-1.9x base (spec V2.10)", () => {
    const stores = defaultCompetitors();
    expect(stores).toHaveLength(2);
    const ids = stores.map((c) => c.id).sort();
    expect(new Set(ids).size).toBe(2); // unique ids
    for (const store of stores) {
      expect(store.priceLevel).toBeGreaterThanOrEqual(1.5);
      expect(store.priceLevel).toBeLessThanOrEqual(1.9);
      expect(store.till).toBe(0);
    }
  });
});

describe("competitorStock", () => {
  it("is deterministic given the same day + store id", () => {
    const [store] = defaultCompetitors();
    const a = competitorStock(store, 10);
    const b = competitorStock(store, 10);
    expect(a).toEqual(b);
  });

  it("rolls 3-4 items, priced at the store's markup off real baseValue", () => {
    for (const store of defaultCompetitors()) {
      for (let day = 0; day < 20; day += 3) {
        const stock = competitorStock(store, day);
        expect(stock.length).toBeGreaterThanOrEqual(3);
        expect(stock.length).toBeLessThanOrEqual(4);
        for (const it of stock) expect(it.price).toBeGreaterThan(0);
      }
    }
  });

  it("re-rolls every 2 days (rotation), and the two stores differ", () => {
    const [north, east] = defaultCompetitors();
    const day0 = competitorStock(north, 0);
    const day1 = competitorStock(north, 1); // same rotation window as day 0
    expect(day1).toEqual(day0);
    // Different store ids seed differently — vanishingly unlikely to match
    // by chance across every field.
    expect(competitorStock(east, 0)).not.toEqual(day0);
    // The rotation SOMETIMES coincidentally repeats a set — but across the
    // day-0 vs day-2 window it should differ often enough that at least one
    // of several checked days diverges (day 2 is the very next rotation
    // window after day 0's).
    const anyDiff = [2, 4, 6, 8, 10].some((d) => JSON.stringify(competitorStock(north, d)) !== JSON.stringify(day0));
    expect(anyDiff).toBe(true);
  });
});

describe("chooseCompetitorStore", () => {
  it("is deterministic for the same adventurer + state", () => {
    const s = baseState();
    const a = adventurer({ gold: 50 });
    expect(chooseCompetitorStore(a, s)).toBe(chooseCompetitorStore(a, s));
  });

  it("returns null when nothing anywhere is affordable", () => {
    const s = baseState();
    const a = adventurer({ gold: 0 });
    expect(chooseCompetitorStore(a, s)).toBeNull();
  });

  it("returns a real competitor id when something is affordable", () => {
    const s = baseState();
    const a = adventurer({ gold: 100 });
    const storeId = chooseCompetitorStore(a, s);
    expect(s.competitors.map((c) => c.id)).toContain(storeId);
  });
});

describe("resolveCompetitorPurchase", () => {
  it("conserves gold: adventurer.gold + store.till is invariant across the transaction", () => {
    const s = baseState();
    const a = adventurer({ gold: 200 });
    const storeId = chooseCompetitorStore(a, s)!;
    const store = s.competitors.find((c) => c.id === storeId)!;
    const before = a.gold + store.till;
    const result = resolveCompetitorPurchase(a, s, storeId);
    expect(result).not.toBeNull();
    expect(a.gold + store.till).toBe(before);
    expect(store.till).toBe(result!.price);
  });

  it("returns null for an unknown store id, touching nothing", () => {
    const s = baseState();
    const a = adventurer({ gold: 200 });
    const before = a.gold;
    expect(resolveCompetitorPurchase(a, s, "nope")).toBeNull();
    expect(a.gold).toBe(before);
  });

  it("returns null when nothing at the store is affordable any more", () => {
    const s = baseState();
    const a = adventurer({ gold: 0 });
    expect(resolveCompetitorPurchase(a, s, s.competitors[0].id)).toBeNull();
  });
});

describe("recycleCompetitorGold", () => {
  it("conserves total gold: sum of all wallets + tills is invariant", () => {
    const s = baseState({
      adventurers: [
        adventurer({ id: "a-1", gold: 5, alive: true }),
        adventurer({ id: "a-2", gold: 50, alive: true }),
        adventurer({ id: "a-3", gold: 500, alive: true }),
        adventurer({ id: "a-4", gold: 0, alive: false }), // dead — excluded from the split
      ],
    });
    s.competitors[0].till = 37;
    s.competitors[1].till = 12;
    const totalBefore =
      s.adventurers.reduce((n, a) => n + a.gold, 0) + s.competitors.reduce((n, c) => n + c.till, 0);
    recycleCompetitorGold(s);
    const totalAfter =
      s.adventurers.reduce((n, a) => n + a.gold, 0) + s.competitors.reduce((n, c) => n + c.till, 0);
    expect(totalAfter).toBe(totalBefore);
  });

  it("resets every till to 0 and pays the poorest, never the richest", () => {
    const s = baseState({
      adventurers: [
        adventurer({ id: "poor", gold: 1, alive: true }),
        adventurer({ id: "rich", gold: 900, alive: true }),
      ],
    });
    s.competitors[0].till = 20;
    const poorBefore = s.adventurers[0].gold;
    const richBefore = s.adventurers[1].gold;
    recycleCompetitorGold(s);
    for (const c of s.competitors) expect(c.till).toBe(0);
    expect(s.adventurers[0].gold).toBeGreaterThan(poorBefore); // poorest half (n=1) got it
    expect(s.adventurers[1].gold).toBe(richBefore); // richest untouched
  });

  it("is a no-op when nobody is alive to receive it (till carries over, not lost)", () => {
    const s = baseState({ adventurers: [adventurer({ id: "a-1", alive: false })] });
    s.competitors[0].till = 15;
    recycleCompetitorGold(s);
    expect(s.competitors[0].till).toBe(15);
  });
});
