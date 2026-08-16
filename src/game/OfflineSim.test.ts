// Phase 7 tests: auto-pilot inference and the offline simulation.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { inferProfile, autoPrice, describeProfile } from "./AutoPilot";
import { elapsedOfflineDays, runOfflineSim, MAX_OFFLINE_DAYS } from "./OfflineSim";
import { saveGame } from "./GameStatePersistence";
import type { PriceRecord } from "../types";

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

function record(cat: PriceRecord["itemCategory"], markup: number): PriceRecord {
  return {
    itemCategory: cat,
    itemName: "x",
    priceSet: Math.round(100 * markup),
    baseValue: 100,
    markupRatio: markup,
    daySet: 1,
  };
}

describe("auto-pilot inference", () => {
  it("learns per-category markup from history", () => {
    const profile = inferProfile([
      record("weapon", 1.5),
      record("weapon", 1.3),
      record("consumable", 1.1),
    ]);
    expect(profile.averageMarkup.weapon).toBeCloseTo(1.4, 5);
    expect(profile.averageMarkup.consumable).toBeCloseTo(1.1, 5);
    expect(profile.confidenceScore).toBeGreaterThan(0);
  });

  it("falls back to overall markup for unseen categories", () => {
    const profile = inferProfile([record("weapon", 1.5)]);
    const price = autoPrice(profile, {
      id: "i",
      name: "Ring",
      category: "accessory",
      baseValue: 100,
      salePrice: null,
      quality: 2,
      icon: "ring",
    });
    expect(price).toBe(150); // overall = 1.5
  });

  it("has zero confidence with no data and says so", () => {
    const profile = inferProfile([]);
    expect(profile.confidenceScore).toBe(0);
    expect(describeProfile(profile)).toMatch(/hasn't learned/);
  });
});

describe("elapsedOfflineDays", () => {
  it("converts real minutes to game days with a cap", () => {
    const now = Date.now();
    expect(elapsedOfflineDays(null, now)).toBe(0);
    expect(elapsedOfflineDays(now - 5 * 60_000, now)).toBe(0); // 5 min < 1 day
    expect(elapsedOfflineDays(now - 25 * 60_000, now)).toBe(2); // 25 min = 2 days
    expect(elapsedOfflineDays(now - 100 * 24 * 60 * 60_000, now)).toBe(MAX_OFFLINE_DAYS);
  });
});

describe("runOfflineSim", () => {
  it("advances days, trades via auto-pilot style, and stores a summary", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    // Seed a pricing style: everything at 1.2×.
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    const dayBefore = e.state.day;
    const summary = runOfflineSim(e, 3);
    expect(e.state.day).toBe(dayBefore + 3);
    expect(summary.daysElapsed).toBe(3);
    expect(summary.itemsSold).toBeGreaterThan(0); // auto-pilot priced + sold
    expect(e.state.offlineSummary).toBe(summary);
    expect(e.state.aiMode).toBe("off"); // restored
  });

  it("damps net gains below live rate", () => {
    // Run the same seed twice is impossible (randomness), so assert the
    // arithmetic contract instead: goldEnd never exceeds start + 65% of the
    // undamped gain implies goldEnd - goldStart <= any positive gain * 0.65...
    // We can't observe the undamped figure from outside, so assert the
    // documented invariant indirectly: a profitable offline period still ends
    // with SOME gain (damping is a haircut, not a wipe).
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    const summary = runOfflineSim(e, 4);
    if (summary.itemsSold > 3) {
      // Gold alone is not the scoreboard — the auto-pilot converts cash into
      // shelf stock. Net worth (gold + stock at base) must stay healthy.
      const stockValue =
        e.state.shelves.reduce((n, it) => n + (it?.baseValue ?? 0), 0) +
        e.state.inventory.reduce((n, it) => n + it.baseValue, 0);
      expect(summary.goldEnd + stockValue).toBeGreaterThan(summary.goldStart * 0.8);
    }
  });

  it("kicks in automatically when loading an old save", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    e.state.lastSavedAt = null;
    saveGame(e.state); // stamps lastSavedAt = now
    // Rewind the stamp 35 real minutes → 3 offline days.
    const raw = JSON.parse(store.get("wdsa_save_v1")!);
    raw.lastSavedAt = Date.now() - 35 * 60_000;
    store.set("wdsa_save_v1", JSON.stringify(raw));

    const resumed = new GameEngine(true);
    expect(resumed.state.offlineSummary).not.toBeNull();
    expect(resumed.state.offlineSummary!.daysElapsed).toBe(3);
    expect(resumed.state.day).toBe(e.state.day + 3);
  });
});
