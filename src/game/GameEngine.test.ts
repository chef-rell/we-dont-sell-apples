// Integration tests over the headless engine: the full economic loop,
// loot re-queue, merchant cycle, save/load round-trip, and game over.
// These formalize the ad-hoc sims used in PR verification.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { loadGame, saveGame } from "./GameStatePersistence";

// Minimal localStorage stub — node has none.
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

function freshEngine(): GameEngine {
  const e = new GameEngine(false);
  e.state.aiMode = "off"; // deterministic only — no fetch in tests
  return e;
}

/** Run the sim for `days` game days in 100ms ticks at 1×. */
function runDays(e: GameEngine, days: number, each?: (e: GameEngine) => void): void {
  const ticks = days * 600 * 10; // 10 min/day at 1× → 600s → 6000 ticks/day
  for (let i = 0; i < ticks; i++) {
    e.tick(100);
    each?.(e);
  }
}

describe("economic loop", () => {
  it("sells fairly-priced items and collects gold", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    runDays(e, 3);
    expect(e.state.stats.itemsSold).toBeGreaterThan(0);
    expect(e.state.gold).toBeGreaterThan(200);
  });

  it("sells nothing when nothing is priced", () => {
    const e = freshEngine();
    runDays(e, 2);
    expect(e.state.stats.itemsSold).toBe(0);
  });

  it("sells almost nothing at outrageous prices", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, it.baseValue * 4);
    runDays(e, 3);
    expect(e.state.stats.itemsSold).toBe(0);
  });
});

describe("loot loop", () => {
  it("adventures produce outcomes and loot offers get bought", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    let bought = 0;
    runDays(e, 6, (eng) => {
      for (const o of [...eng.state.lootOffers]) {
        if (eng.acceptLootOffer(o.id)) bought++;
      }
    });
    expect(e.state.recentOutcomes.length).toBeGreaterThan(0);
    expect(bought).toBeGreaterThan(0);
  });

  it("ignored offers re-queue rather than strand", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    const offerDays = new Set<number>();
    const seen = new Set<string>();
    runDays(e, 9, (eng) => {
      for (const o of eng.state.lootOffers) {
        if (!seen.has(o.id)) {
          seen.add(o.id);
          offerDays.add(o.day);
        }
      }
    });
    // If anything was looted at all, offers must span more than one day —
    // proof that unsold loot comes back instead of stranding.
    const held = e.state.adventurers.flatMap((a) => a.inventory.filter((i) => i.category === "loot"));
    if (held.length > 0) expect(offerDays.size).toBeGreaterThan(1);
  });
});

describe("wholesale merchant", () => {
  it("appears in the afternoon, sells at base value, leaves at evening", () => {
    const e = freshEngine();
    let sawMerchant = false;
    let boughtAtBase = false;
    runDays(e, 1, (eng) => {
      const s = eng.state;
      if (s.phase === "afternoon" && s.merchant && !boughtAtBase) {
        sawMerchant = true;
        const it = s.merchant.stock[0];
        const goldBefore = s.gold;
        if (eng.buyWholesale(it.id)) {
          boughtAtBase = goldBefore - s.gold === it.baseValue;
        }
      }
      if (s.phase === "evening") expect(s.merchant).toBeNull();
    });
    expect(sawMerchant).toBe(true);
    expect(boughtAtBase).toBe(true);
  });
});

describe("save/load", () => {
  it("round-trips state through localStorage", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, 50);
    runDays(e, 1);
    saveGame(e.state);
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.day).toBe(e.state.day);
    expect(loaded!.gold).toBe(e.state.gold);
    expect(loaded!.adventurers.length).toBe(e.state.adventurers.length);
    expect(loaded!.pricingHistory.length).toBe(e.state.pricingHistory.length);
    expect(loaded!.speed).toBe(1); // never resumes paused/fast
  });

  it("rejects corrupt saves", () => {
    localStorage.setItem("wdsa_save_v1", "{not json");
    expect(loadGame()).toBeNull();
    localStorage.setItem("wdsa_save_v1", JSON.stringify({ hello: "world" }));
    expect(loadGame()).toBeNull();
  });
});

describe("game over", () => {
  it("triggers only when gold AND stock are gone", () => {
    const e = freshEngine();
    e.state.gold = 0;
    e.tick(100);
    expect(e.state.view).not.toBe("gameover"); // still has shelf stock

    e.state.inventory = [];
    e.state.shelves = e.state.shelves.map(() => null);
    e.tick(100);
    expect(e.state.view).toBe("gameover");
    expect(e.state.speed).toBe(0);
  });
});

describe("token budget", () => {
  it("blocks AI calls when exhausted and resets daily", async () => {
    const { canCall, recordCall } = await import("../utils/TokenBudget");
    const e = freshEngine();
    const b = e.state.tokenBudget;
    b.dailyLimitCalls = 2;
    expect(canCall(b)).toBe(true);
    recordCall(b, 100, 50);
    recordCall(b, 100, 50);
    expect(b.budgetExhausted).toBe(true);
    expect(canCall(b)).toBe(false);
    b.lastResetDate = "2000-01-01"; // pretend it's yesterday
    expect(canCall(b)).toBe(true); // midnight reset
    expect(b.callsToday).toBe(0);
  });
});

describe("shop expansion", () => {
  it("charges the tier cost, adds slots, and surfaces stockroom overflow", async () => {
    const { makeItem } = await import("../entities/Item");
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    e.state.gold = 1000;
    e.state.inventory.push(makeItem("iron_sword"), makeItem("rations"));
    expect(e.nextExpansionCost()).toBe(300);
    expect(e.expandShop()).toBe(true);
    expect(e.state.gold).toBe(700);
    expect(e.state.shopLevel).toBe(2);
    expect(e.state.shelves.length).toBe(16);
    // Stockroom overflow moved onto the new shelves
    expect(e.state.inventory.length).toBe(0);
    expect(e.state.shelves.filter(Boolean).length).toBe(14); // 12 starting + 2
  });

  it("refuses when unaffordable and at max level", () => {
    const e = new GameEngine(false);
    e.state.gold = 100;
    expect(e.expandShop()).toBe(false);
    e.state.gold = 10_000;
    expect(e.expandShop()).toBe(true); // → 2
    expect(e.expandShop()).toBe(true); // → 3
    expect(e.expandShop()).toBe(true); // → 4
    expect(e.nextExpansionCost()).toBeNull();
    expect(e.expandShop()).toBe(false); // max
  });
});

describe("stalemate rescue", () => {
  it("a well-disposed adventurer donates junk when the shop is broke", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    e.state.gold = 10;
    e.state.inventory = [];
    e.state.shelves = e.state.shelves.map(() => null);
    // Run a full day so onNewDay fires.
    for (let i = 0; i < 600 * 10 + 50; i++) e.tick(100);
    const stocked =
      e.state.shelves.filter(Boolean).length + e.state.inventory.length;
    expect(stocked).toBeGreaterThan(0); // charity landed
    expect(e.state.messages.some((m) => m.content.includes("Rough patch"))).toBe(true);
  });

  it("no charity while the shop is healthy", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    // Default start: 200g + full shelves → no donations.
    for (let i = 0; i < 600 * 10 + 50; i++) e.tick(100);
    expect(e.state.messages.some((m) => m.content.includes("Rough patch"))).toBe(false);
  });

  it("retireShop routes to the game over screen", () => {
    const e = new GameEngine(false);
    e.retireShop();
    expect(e.state.view).toBe("gameover");
    expect(e.state.speed).toBe(0);
  });
});

describe("trade ledger", () => {
  it("records sales, loss flags, reactions, and rotates at day end", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    // Price half at a loss, half fairly.
    e.state.shelves.forEach((it, i) => {
      if (it) e.setPrice(it.id, i % 2 === 0 ? Math.max(1, it.baseValue - 5) : Math.round(it.baseValue * 1.2));
    });
    for (let i = 0; i < 600 * 10 + 50; i++) e.tick(100);
    const yesterday = e.state.ledgerHistory.at(-1)!;
    expect(yesterday.salesCount).toBeGreaterThan(0);
    expect(yesterday.soldAtLoss).toBeGreaterThan(0); // loss sales detected
    const r = yesterday.reactions;
    expect(r.happy + r.neutral + r.unhappy + r.angry).toBeGreaterThan(0);
    expect(e.state.ledger.day).toBe(e.state.day); // fresh book for the new day
    expect(e.state.ledger.salesCount).toBeLessThanOrEqual(yesterday.salesCount + 5);
  });

  it("bought loot lands on an empty shelf so the player can see and price it", async () => {
    const { makeItem } = await import("../entities/Item");
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    e.state.shelves[0] = null; // make room
    const seller = e.state.adventurers[0];
    const loot = makeItem("echo_crystal");
    seller.inventory.push(loot);
    e.state.lootOffers.push({
      id: "offer-test",
      adventurerId: seller.id,
      adventurerName: seller.name,
      item: loot,
      askPrice: 20,
      day: e.state.day,
    });
    expect(e.acceptLootOffer("offer-test")).toBe(true);
    const shelved = e.state.shelves.at(0); // .at() defeats the null-literal narrowing above
    expect(shelved?.name).toBe("Echo Crystal");
    expect(shelved?.salePrice).toBeNull(); // unpriced, ready to price
  });
});

describe("pricing defaults", () => {
  it("suggestedPrice prefers proven sale prices over merely-set prices", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    const sword = e.state.shelves.find((it) => it?.name === "Iron Sword")!;
    e.setPrice(sword.id, 45); // set but never sold
    expect(e.suggestedPrice("Iron Sword")).toEqual({ price: 45, fromSale: false });
    e.state.lastSalePriceByName["Iron Sword"] = 38; // a sale happened
    expect(e.suggestedPrice("Iron Sword")).toEqual({ price: 38, fromSale: true });
    expect(e.suggestedPrice("Nonexistent Thing")).toBeNull();
  });

  it("sales record their price for future defaults", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    for (let i = 0; i < 600 * 10; i++) e.tick(100);
    if (e.state.stats.itemsSold > 0) {
      expect(Object.keys(e.state.lastSalePriceByName).length).toBeGreaterThan(0);
    }
  });
});

describe("shelveItem", () => {
  it("moves a stockroom item to the first empty shelf", async () => {
    const { makeItem } = await import("../entities/Item");
    const e = new GameEngine(false);
    e.state.shelves[3] = null;
    const item = makeItem("golem_plate");
    e.state.inventory.push(item);
    expect(e.shelveItem(item.id)).toBe(true);
    expect(e.state.shelves.at(3)?.id).toBe(item.id);
    expect(e.state.inventory).toHaveLength(0);
  });

  it("refuses when shelves are full or item unknown", async () => {
    const { makeItem } = await import("../entities/Item");
    const e = new GameEngine(false); // starts with all 12 slots filled
    const item = makeItem("rations");
    e.state.inventory.push(item);
    expect(e.shelveItem(item.id)).toBe(false); // no space
    expect(e.shelveItem("nope")).toBe(false); // unknown id
    expect(e.state.inventory).toHaveLength(1); // untouched
  });
});

// Regression cover for #50: the town moved as one organism — everyone left for
// the shop on the same tick and then converged on a single pixel in the square.
describe("town movement feels like a town (#50)", () => {
  it("opens a new game at dawn, so the player can price before the rush", () => {
    const e = freshEngine();
    expect(e.state.phase).toBe("dawn");
    // The wake-up stagger has a 20s floor, so the first ~15 game-seconds are
    // the player's: nobody has even set off for the shop yet.
    runDays(e, 0.025); // 15 game-seconds
    const moving = e.state.adventurers.filter(
      (a) => a.state === "heading_to_shop" || a.state === "browsing" || a.state === "buying",
    );
    expect(moving).toHaveLength(0);
  });

  it("staggers shop trips instead of marching everyone off at once", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));

    // Sample how many have set off for the shop, early in the morning.
    const departedAt: number[] = [];
    for (let i = 0; i < 6000; i++) {
      e.tick(100);
      if (i % 100 === 0) {
        departedAt.push(
          e.state.adventurers.filter((a) => a.state !== "wandering" && a.state !== "resting").length,
        );
      }
    }
    // They should not all be in transit on the same sample.
    const jumps = departedAt.filter((n, i) => i > 0 && n > departedAt[i - 1]);
    expect(jumps.length).toBeGreaterThan(1);
  });

  it("still gets everyone to the shop on day 1 despite the stagger", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    const visited = new Set<string>();
    runDays(e, 1, (eng) => {
      for (const a of eng.state.adventurers) {
        if (a.state === "browsing" || a.state === "buying") visited.add(a.id);
      }
    });
    expect(visited.size).toBe(e.state.adventurers.length);
  });

  it("scatters adventurers leaving the shop rather than stacking them", () => {
    const e = freshEngine();
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));

    // Measure how spread out the idlers are across the day. The bug collapsed
    // them onto one coordinate, so the bounding box degenerated to ~0. Spread
    // rather than pairwise uniqueness: two adventurers legitimately sharing a
    // doorway for a tick shouldn't fail the run.
    let widestSpread = 0;
    runDays(e, 1, (eng) => {
      const idle = eng.state.adventurers.filter((a) => a.alive && a.state === "wandering");
      if (idle.length < 3) return;
      const xs = idle.map((a) => a.position.x);
      const ys = idle.map((a) => a.position.y);
      const spread = Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys));
      widestSpread = Math.max(widestSpread, spread);
    });
    expect(widestSpread).toBeGreaterThan(100);
  });
});
