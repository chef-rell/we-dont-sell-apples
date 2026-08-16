// Integration tests over the headless engine: the full economic loop,
// loot re-queue, merchant cycle, save/load round-trip, and game over.
// These formalize the ad-hoc sims used in PR verification.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { loadGame, saveGame, SAVE_KEY } from "./GameStatePersistence";
import { makeItem } from "../entities/Item";
import { resolveAdventure } from "./Combat";
import type { Adventurer } from "../types";

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

  it("round-trips saveVersion (#57, v2 key since #71)", () => {
    const e = freshEngine();
    expect(e.state.saveVersion).toBe(2);
    saveGame(e.state);
    const loaded = loadGame();
    expect(loaded!.saveVersion).toBe(2);
  });

  it("defaults saveVersion to 2 for a save written without it (#57/#71)", () => {
    const e = freshEngine();
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    delete raw.saveVersion;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    expect(loaded!.saveVersion).toBe(2);
  });

  it("never reads or touches the v1 save key (#71, spec V2.11)", () => {
    localStorage.setItem("wdsa_save_v1", '{"day":9,"legacy":"v1 save — must survive untouched"}');
    const e = freshEngine();
    saveGame(e.state); // writes wdsa_save_v2 only
    expect(SAVE_KEY).toBe("wdsa_save_v2");
    expect(loadGame()!.day).toBe(e.state.day); // loads from v2, not the day-9 v1 blob
    expect(localStorage.getItem("wdsa_save_v1")).toBe('{"day":9,"legacy":"v1 save — must survive untouched"}');
  });

  it("rejects corrupt saves", () => {
    localStorage.setItem(SAVE_KEY, "{not json");
    expect(loadGame()).toBeNull();
    localStorage.setItem(SAVE_KEY, JSON.stringify({ hello: "world" }));
    expect(loadGame()).toBeNull();
  });

  it("round-trips the building registry (#56)", () => {
    const e = freshEngine();
    expect(e.state.buildings.length).toBeGreaterThan(0);
    saveGame(e.state);
    const loaded = loadGame();
    expect(loaded!.buildings).toEqual(e.state.buildings);
  });

  it("round-trips currentScript (#76)", () => {
    const e = freshEngine();
    // Force everyone to want to adventure today (fallbackMorningPlan shops
    // first whenever gearScore < 4 and gold >= 25 — zero gold routes
    // starting adventurers past that branch into "adventure" instead).
    for (const a of e.state.adventurers) {
      a.daysSinceLastAdventure = 99;
      a.gold = 0;
    }
    let sawScript = false;
    for (let i = 0; i < 6000 && !sawScript; i++) {
      e.tick(100);
      if (e.state.currentScript) sawScript = true;
    }
    expect(sawScript).toBe(true);
    saveGame(e.state);
    const loaded = loadGame();
    expect(loaded!.currentScript).toEqual(e.state.currentScript);
  });

  it("defaults currentScript to null for a save written before it existed (#76)", () => {
    const e = freshEngine();
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    delete raw.currentScript;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    expect(loaded!.currentScript).toBeNull();
  });

  it("defaults buildings for a save written before the registry existed (#56)", () => {
    const e = freshEngine();
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    delete raw.buildings;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    expect(loaded!.buildings.length).toBeGreaterThan(0);
    expect(loaded!.buildings.some((b) => b.id === "shop")).toBe(true);
    expect(loaded!.buildings.some((b) => b.id === "gate")).toBe(true);
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

describe("gear durability", () => {
  it("new weapons and armor have durability; loot does not", () => {
    const sword = makeItem("iron_sword");
    const armor = makeItem("leather_armor");
    const loot = makeItem("crude_hide");
    expect(sword.durability).toBeGreaterThan(0);
    expect(sword.maxDurability).toBe(sword.durability);
    expect(armor.durability).toBeGreaterThan(0);
    expect(loot.durability).toBeNull();
  });

  it("combat reduces gear durability", () => {
    const e = freshEngine();
    const a = e.state.adventurers[0];
    // Give adventurer gear with known durability
    a.equipment.weapon = makeItem("iron_sword");
    a.equipment.armor = makeItem("leather_armor");
    const startWeaponDur = a.equipment.weapon!.durability!;
    const startArmorDur = a.equipment.armor!.durability!;
    resolveAdventure(a, 1);
    // Durability should decrease (or gear broke and was unequipped)
    const weaponDur = a.equipment.weapon?.durability ?? 0;
    const armorDur = a.equipment.armor?.durability ?? 0;
    expect(weaponDur).toBeLessThan(startWeaponDur);
    expect(armorDur).toBeLessThan(startArmorDur);
  });

  it("broken gear is unequipped", () => {
    const e = freshEngine();
    const a = e.state.adventurers[0];
    const sword = makeItem("iron_sword");
    sword.durability = 1; // about to break
    a.equipment.weapon = sword;
    resolveAdventure(a, 1);
    // Weapon should be gone (durability was 1, loss is at least 1)
    expect(a.equipment.weapon).toBeUndefined();
  });
});

// ---------- AdventureScript + parties (spec V2.5/V2.6, issue #76) ----------

// fallbackMorningPlan shops first whenever gearScore < 4 and gold >= 25;
// starting adventurers begin with empty equipment, so zeroing gold is what
// routes them into "adventure" instead (restlessness then clears the >=90
// bar easily with daysSinceLastAdventure this high).
function forceAdventurePlan(a: Adventurer): void {
  a.daysSinceLastAdventure = 99;
  a.gold = 0;
}

describe("party formation (#76)", () => {
  it("groups the day's adventuring party into one script rather than one script per member", () => {
    const e = freshEngine();
    // Restlessness (fallbackMorningPlan) drives multiple starting adventurers
    // toward "adventure" on the same day when they've all been idle a while.
    for (const a of e.state.adventurers) forceAdventurePlan(a);
    let maxPartySize = 0;
    runDays(e, 3, () => {
      if (e.state.currentScript) {
        maxPartySize = Math.max(maxPartySize, e.state.currentScript.partyIds.length);
      }
    });
    expect(maxPartySize).toBeGreaterThanOrEqual(2);
  });

  it("a party member's applied outcome matches their slice of the script that formed", () => {
    const e = freshEngine();
    for (const a of e.state.adventurers) forceAdventurePlan(a);
    let capturedScript: NonNullable<typeof e.state.currentScript> | null = null;
    runDays(e, 2, () => {
      if (!capturedScript && e.state.currentScript && e.state.currentScript.partyIds.length >= 2) {
        capturedScript = structuredClone(e.state.currentScript);
      }
    });
    expect(capturedScript).not.toBeNull();
    const script = capturedScript!;
    for (const memberOutcome of script.memberOutcomes) {
      const applied = e.state.recentOutcomes.find(
        (o) => o.adventurerId === memberOutcome.adventurerId && o.day === script.day,
      );
      expect(applied).toBeDefined();
      expect(applied).toEqual(memberOutcome);
    }
  });

  it("clears currentScript at day rollover", () => {
    const e = freshEngine();
    for (const a of e.state.adventurers) forceAdventurePlan(a);
    let sawScript = false;
    runDays(e, 1, () => {
      if (e.state.currentScript) sawScript = true;
    });
    expect(sawScript).toBe(true);
    expect(e.state.currentScript).toBeNull(); // a day has rolled over by here
  });

  it("nobody adventuring today leaves currentScript null", () => {
    const e = freshEngine();
    // Freshly rested, well-off adventurers with no restlessness lean shop/rest.
    for (const a of e.state.adventurers) {
      a.daysSinceLastAdventure = 0;
      a.hp = a.maxHp;
    }
    let sawAfternoon = false;
    let sawScript = false;
    runDays(e, 1, () => {
      if (e.state.phase === "afternoon") {
        sawAfternoon = true;
        if (e.state.currentScript) sawScript = true;
      }
    });
    expect(sawAfternoon).toBe(true);
    expect(sawScript).toBe(false);
  });
});

describe("wipe stabilizer (#76, spec V2.6)", () => {
  /** A weak-but-willing adventurer: full (small) hp so fallbackMorningPlan
   *  doesn't send them to rest, zero gold so it doesn't send them shopping,
   *  bare level/gear so combat math is unfavorable. */
  function makeFragile(a: Adventurer): void {
    forceAdventurePlan(a);
    a.maxHp = 3;
    a.hp = 3;
    a.level = 1;
    a.equipment = {};
    a.personality.riskTolerance = 90; // keeps restlessness clearing the "adventure" bar even after a day off
  }

  it("a same-day multi-death wipe spawns more than one newcomer in a single wave", () => {
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    for (const a of e.state.adventurers) makeFragile(a);
    const arrivalWaveSizes: number[] = [];
    let prevCount = e.state.adventurers.length;
    for (let i = 0; i < 6000 * 20; i++) {
      e.tick(100);
      if (e.state.adventurers.length > prevCount) {
        arrivalWaveSizes.push(e.state.adventurers.length - prevCount);
      }
      prevCount = e.state.adventurers.length;
    }
    // Proof the wave size scales with the death count instead of always
    // trickling in exactly one newcomer per rollover.
    expect(arrivalWaveSizes.some((size) => size > 1)).toBe(true);
  });

  it("more deaths in a wave pull the next replacement in sooner than a lone death would", () => {
    const singleDeath = new GameEngine(false);
    singleDeath.state.aiMode = "off";
    const soleVictim = singleDeath.state.adventurers[0];
    makeFragile(soleVictim);
    for (const a of singleDeath.state.adventurers.slice(1)) {
      a.hp = a.maxHp; // keep everyone else safely out of danger
      a.daysSinceLastAdventure = 0;
      a.gold = 999; // stays shopping, never joins the party
    }
    let singleDeathDay = -1;
    for (let i = 0; i < 6000 * 15 && singleDeathDay === -1; i++) {
      singleDeath.tick(100);
      if (!soleVictim.alive) singleDeathDay = singleDeath.state.day;
    }
    expect(singleDeathDay).toBeGreaterThan(0);

    const wipe = new GameEngine(false);
    wipe.state.aiMode = "off";
    for (const a of wipe.state.adventurers) makeFragile(a);
    let wipeDay = -1;
    let sawMultiDeath = false;
    let deadCountAtStart = wipe.state.adventurers.filter((a) => !a.alive).length;
    for (let i = 0; i < 6000 * 20 && !sawMultiDeath; i++) {
      wipe.tick(100);
      const deadNow = wipe.state.adventurers.filter((a) => !a.alive).length;
      // A meaningful wipe event: 3+ deaths accumulated without a
      // replacement wave landing in between (a hard week, not just attrition).
      if (deadNow - deadCountAtStart >= 3) {
        wipeDay = wipe.state.day;
        sawMultiDeath = true;
      }
    }
    expect(sawMultiDeath).toBe(true);

    // From each death day, count days until the FIRST replacement arrives.
    let daysToFirstArrivalSingle = -1;
    for (let d = 1; d <= 10 && daysToFirstArrivalSingle === -1; d++) {
      for (let i = 0; i < 6000 && singleDeath.state.adventurers.length === 6; i++) singleDeath.tick(100);
      if (singleDeath.state.adventurers.length > 6) daysToFirstArrivalSingle = singleDeath.state.day - singleDeathDay;
    }
    let daysToFirstArrivalWipe = -1;
    for (let d = 1; d <= 10 && daysToFirstArrivalWipe === -1; d++) {
      for (let i = 0; i < 6000 && wipe.state.adventurers.length === 6; i++) wipe.tick(100);
      if (wipe.state.adventurers.length > 6) daysToFirstArrivalWipe = wipe.state.day - wipeDay;
    }
    expect(daysToFirstArrivalWipe).toBeGreaterThanOrEqual(0);
    expect(daysToFirstArrivalSingle).toBeGreaterThanOrEqual(0);
    expect(daysToFirstArrivalWipe).toBeLessThanOrEqual(daysToFirstArrivalSingle);
  });
});
