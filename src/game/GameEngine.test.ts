// Integration tests over the headless engine: the full economic loop,
// loot re-queue, merchant cycle, save/load round-trip, and game over.
// These formalize the ad-hoc sims used in PR verification.

import { beforeEach, describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { loadGame, saveGame, SAVE_KEY } from "./GameStatePersistence";
import { makeItem } from "../entities/Item";
import { resolveAdventure, generateAdventureScript } from "./Combat";
import { makeRng } from "../utils/rng";
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
    // Deep pockets: this test is about the loot loop's plumbing, not
    // affordability — with starting gold, a run of pricey early offers
    // could block every accept and flake (~1/12 under the party system).
    e.state.gold = 5000;
    for (const it of e.state.shelves) if (it) e.setPrice(it.id, Math.round(it.baseValue * 1.2));
    let bought = 0;
    runDays(e, 8, (eng) => {
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

  // ---------- spec V2.9, issue #90: rarity/enchantments/origin/lootRolls ----------

  it("defaults rarity/enchantments/origin on items for a save written before #90", () => {
    const e = freshEngine();
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    for (const it of raw.shelves) {
      if (!it) continue;
      delete it.rarity;
      delete it.enchantments;
      delete it.origin;
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    for (const it of loaded!.shelves) {
      if (!it) continue;
      expect(it.rarity).toBe("common");
      expect(it.enchantments).toEqual([]);
      expect(it.origin).toBe("stock");
    }
  });

  it("defaults lootRolls on recentOutcomes for a save written before #90, mapped from lootItemKeys", () => {
    const e = freshEngine();
    e.state.recentOutcomes.push({
      adventurerId: e.state.adventurers[0].id,
      area: "forest_edge",
      day: 1,
      monsterName: "Goblin Scavenger",
      monsterDefeated: true,
      damageTaken: 3,
      survived: true,
      lootItemKeys: ["stolen_trinket", "rusty_dagger"],
      goldFound: 5,
      narration: null,
      brokenItems: [],
      lootRolls: [
        { key: "stolen_trinket", rarity: "rare", enchantments: ["flame"] },
        { key: "rusty_dagger", rarity: "common", enchantments: [] },
      ],
    });
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    delete raw.recentOutcomes[0].lootRolls; // simulate a pre-#90 save
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    expect(loaded!.recentOutcomes[0].lootRolls).toEqual([
      { key: "stolen_trinket", rarity: "common", enchantments: [] },
      { key: "rusty_dagger", rarity: "common", enchantments: [] },
    ]);
  });

  it("defaults lootRolls on a mid-script currentScript's memberOutcomes for a save written before #90", () => {
    const e = freshEngine();
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
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    for (const o of raw.currentScript.memberOutcomes) delete o.lootRolls;
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    for (const o of loaded!.currentScript!.memberOutcomes) {
      expect(o.lootRolls).toEqual(o.lootItemKeys.map((key) => ({ key, rarity: "common", enchantments: [] })));
    }
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
    // Deterministic: drive the death bookkeeping through the engine's real
    // handleOutcome path instead of hoping a 20-day unseeded sim happens to
    // produce a same-day multi-death (the original form flaked ~1/8 runs).
    const e = new GameEngine(false);
    e.state.aiMode = "off";
    for (const a of e.state.adventurers.slice(0, 3)) {
      a.alive = false;
      a.state = "dead";
      e["handleOutcome"](a, {
        adventurerId: a.id,
        day: e.state.day,
        area: "forest_edge",
        monsterName: "Goblin",
        monsterDefeated: false,
        damageTaken: 99,
        survived: false,
        lootItemKeys: [],
        goldFound: 0,
        brokenItems: [],
        narration: null,
        lootRolls: [],
      });
    }
    e["replacementDueDay"] = e.state.day + 1; // wave due at the next rollover
    const aliveBefore = e.state.adventurers.filter((x) => x.alive).length;
    e.state.timeOfDay = 0.999;
    e.tick(1000); // crosses the day boundary -> onNewDay -> replacement wave
    const aliveAfter = e.state.adventurers.filter((x) => x.alive).length;
    // 3 deaths -> waveSize = min(deficit 3, ceil(3/2)) = 2: scales with the
    // death count instead of trickling in exactly one newcomer.
    expect(aliveAfter - aliveBefore).toBe(2);
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

// ---------- The Helper (spec V2.7, issue #83) ----------

describe("helper creation and daily assignment (#83)", () => {
  it("createCharacters sets both the shopkeeper appearance and a fresh helper, once", () => {
    const e = freshEngine();
    expect(e.state.helper).toBeNull();
    expect(e.state.shopkeeperAppearance).toBeNull();
    const ok = e.createCharacters({ skin: 1, hair: 2 }, "Robin", { skin: 3, hair: 0 }, "brave");
    expect(ok).toBe(true);
    expect(e.state.shopkeeperAppearance).toEqual({ skin: 1, hair: 2 });
    expect(e.state.helper).not.toBeNull();
    expect(e.state.helper!.name).toBe("Robin");
    expect(e.state.helper!.appearance).toEqual({ skin: 3, hair: 0 });
    expect(e.state.helper!.trait).toBe("brave");
    expect(e.state.helper!.track).toBe("none");
    expect(e.state.helper!.level).toBe(1);
    expect(e.state.helper!.assignment).toBe("chores");

    // Creation only ever happens once per save.
    const again = e.createCharacters({ skin: 0, hair: 0 }, "Someone Else", { skin: 0, hair: 0 }, "curious");
    expect(again).toBe(false);
    expect(e.state.helper!.name).toBe("Robin"); // unchanged
  });

  it("setHelperAssignment fails with no helper, then sets a sticky daily job", () => {
    const e = freshEngine();
    expect(e.setHelperAssignment("shop")).toBe(false);
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "charming");
    e.state.day = 4;
    expect(e.setHelperAssignment("shop")).toBe(true);
    expect(e.state.helper!.assignment).toBe("shop");
    expect(e.state.helper!.assignmentDay).toBe(4);

    // Sticky: unrelated ticks don't revert it on their own.
    e.state.aiMode = "off";
    for (let i = 0; i < 100; i++) e.tick(100);
    expect(e.state.helper!.assignment).toBe("shop");

    // Changing it again updates both fields.
    e.state.day = 5;
    expect(e.setHelperAssignment("adventure")).toBe(true);
    expect(e.state.helper!.assignment).toBe("adventure");
    expect(e.state.helper!.assignmentDay).toBe(5);
  });
});

describe("chooseTrack permanence and the day-10 gate (#83)", () => {
  it("rejects before day 10, and rejects with no helper at all", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "brave");
    e.state.day = 9;
    expect(e.chooseTrack("adventure")).toBe(false);
    expect(e.state.helper!.track).toBe("none");

    const noHelper = freshEngine();
    noHelper.state.day = 20;
    expect(noHelper.chooseTrack("adventure")).toBe(false);
  });

  it("rejects craft (Phase 4 stub) and the sentinel 'none' value", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "curious");
    e.state.day = 10;
    expect(e.chooseTrack("craft")).toBe(false);
    expect(e.chooseTrack("none")).toBe(false);
    expect(e.state.helper!.track).toBe("none"); // still unset — neither call took
  });

  it("succeeds once day 10+ is reached and is permanent (one-way)", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "charming");
    e.state.day = 10;
    expect(e.chooseTrack("shop")).toBe(true);
    expect(e.state.helper!.track).toBe("shop");

    // One-way: a later attempt to switch is rejected, even to a different value.
    expect(e.chooseTrack("adventure")).toBe(false);
    expect(e.state.helper!.track).toBe("shop");
  });
});

describe("helper XP accrual at day rollover (#83)", () => {
  it("adds a day's xp for the current assignment, x1.5 once the track matches the trait", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "charming");
    e.setHelperAssignment("shop");
    for (let i = 0; i < 600 * 10 + 50; i++) e.tick(100); // one day rollover
    expect(e.state.helper!.xp).toBe(10); // no track chosen yet — no trait bonus

    e.state.day = 10;
    expect(e.chooseTrack("shop")).toBe(true); // matches the "charming" trait
    for (let i = 0; i < 600 * 10 + 50; i++) e.tick(100);
    expect(e.state.helper!.xp).toBe(10 + 15); // +10 * 1.5
  });

  it("suggestPrice stays null until level 3, shop-assigned", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "charming");
    const item = makeItem("iron_sword");
    expect(e.suggestPrice(item)).toBeNull(); // not on shop duty
    e.setHelperAssignment("shop");
    expect(e.suggestPrice(item)).toBeNull(); // level 1, below the L3 gate
    e.state.helper!.level = 3;
    expect(e.suggestPrice(item)).not.toBeNull();
    e.setHelperAssignment("adventure");
    expect(e.suggestPrice(item)).toBeNull(); // L3+ but not on shop duty today
  });
});

describe("shop-track wait scaling touches the behavior timer (#83)", () => {
  it("a level-5 shop-duty helper shortens the browsing wait; no helper leaves it unchanged", async () => {
    const { freshContext, stepAdventurer } = await import("../entities/AdventurerBehavior");
    const e = freshEngine();
    e.state.phase = "morning";
    const a = e.state.adventurers[0];
    a.personality.spendingStyle = "careful"; // base browseTime = 8s (largest base, easiest to see scaling)

    // No helper: full, unscaled wait.
    a.state = "heading_to_shop";
    const bcPlain = freshContext(); // target: null — walkToward resolves the arrival instantly
    stepAdventurer(a, bcPlain, e.state, 0.1);
    expect(a.state).toBe("browsing");
    expect(bcPlain.timer).toBeCloseTo(8, 5);

    // Level-5 shop-duty helper: 8 * (1 - 0.06*5) = 8 * 0.7 = 5.6s.
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "charming");
    e.state.helper!.assignment = "shop";
    e.state.helper!.level = 5;
    a.state = "heading_to_shop";
    const bcHelped = freshContext();
    stepAdventurer(a, bcHelped, e.state, 0.1);
    expect(a.state).toBe("browsing");
    expect(bcHelped.timer).toBeCloseTo(8 * 0.7, 5);
  });
});

describe("full-wipe helper-carry beat delivers to the player (#83)", () => {
  it("credits gold and items to the player and announces the beat when a full-wipe script has helperAlong", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 0, hair: 0 }, "Robin", { skin: 0, hair: 0 }, "brave");
    e.setHelperAssignment("adventure");
    // Neutralize every real adventurer this tick so nothing but the
    // helper-carry beat can change gold/inventory — isolates the assertion
    // to exactly the mechanism under test.
    for (const a of e.state.adventurers) a.alive = false;

    // A deterministic hopeless party (structuredClone keeps the same ids as
    // partyIds so the beat's bookkeeping lines up with real adventurers,
    // though those adventurers are inert this tick per above).
    const buildParty = () =>
      e.state.adventurers.map((a) => {
        const clone = structuredClone(a);
        clone.alive = true; // Combat.ts doesn't care, but keep it sane
        clone.level = 1;
        clone.hp = 5;
        clone.maxHp = 5;
        clone.equipment = {};
        return clone;
      });

    let script: ReturnType<typeof generateAdventureScript> | null = null;
    for (let seed = 0; seed < 200 && !script; seed++) {
      const candidate = generateAdventureScript(buildParty(), 20, { seed, helper: { level: 4 } }, makeRng(seed));
      const wiped = candidate.memberOutcomes.every((o) => !o.survived);
      const hasGoldCarry = candidate.events.some((ev) => ev.type === "helperCarry" && (ev.value ?? 0) > 0);
      if (wiped && hasGoldCarry) script = candidate;
    }
    expect(script).not.toBeNull();
    const carryEvents = script!.events.filter((ev) => ev.type === "helperCarry");
    const expectedGold = carryEvents.reduce((n, ev) => n + (ev.value ?? 0), 0);
    const expectedItemCount = carryEvents.filter((ev) => ev.itemName).length;

    const goldBefore = e.state.gold;
    const itemCountBefore = e.state.shelves.filter(Boolean).length + e.state.inventory.length;

    e.state.currentScript = script;
    e.state.phase = "afternoon";
    e.state.timeOfDay = 0.59; // PHASE_BOUNDS.afternoon = [0.35, 0.6)
    e.state.speed = 1;
    e.tick(10_000); // crosses into evening ([0.6, 0.8)) in one step

    expect(e.state.phase).toBe("evening");
    expect(e.state.gold).toBe(goldBefore + expectedGold);
    const itemCountAfter = e.state.shelves.filter(Boolean).length + e.state.inventory.length;
    expect(itemCountAfter - itemCountBefore).toBe(expectedItemCount);
    expect(e.state.messages.some((m) => m.content.includes("didn't make it back"))).toBe(true);
  });

  it("without a helper along, a full-wipe script never emits helperCarry or credits the player", () => {
    const e = freshEngine();
    // No createCharacters call — s.helper stays null throughout.
    for (const a of e.state.adventurers) a.alive = false;
    const buildParty = () =>
      e.state.adventurers.map((a) => {
        const clone = structuredClone(a);
        clone.level = 1;
        clone.hp = 5;
        clone.maxHp = 5;
        clone.equipment = {};
        return clone;
      });
    let script: ReturnType<typeof generateAdventureScript> | null = null;
    for (let seed = 0; seed < 100 && !script; seed++) {
      const candidate = generateAdventureScript(buildParty(), 20, { seed }, makeRng(seed));
      if (candidate.memberOutcomes.every((o) => !o.survived)) script = candidate;
    }
    expect(script).not.toBeNull();
    expect(script!.events.some((ev) => ev.type === "helperCarry")).toBe(false);

    const goldBefore = e.state.gold;
    e.state.currentScript = script;
    e.state.phase = "afternoon";
    e.state.timeOfDay = 0.59;
    e.state.speed = 1;
    e.tick(10_000);

    expect(e.state.gold).toBe(goldBefore);
    expect(e.state.messages.some((m) => m.content.includes("didn't make it back"))).toBe(false);
  });
});

describe("helper save/load round-trip (#83)", () => {
  it("round-trips helper, shopkeeperAppearance, and currentScript.helperAlong", () => {
    const e = freshEngine();
    e.createCharacters({ skin: 2, hair: 1 }, "Robin", { skin: 1, hair: 4 }, "curious");
    e.setHelperAssignment("adventure");
    e.state.day = 10;
    e.chooseTrack("adventure");
    e.state.helper!.xp = 123;
    e.state.helper!.level = 3;
    e.state.currentScript = generateAdventureScript(
      e.state.adventurers,
      e.state.day,
      { seed: 1, helper: { level: 3 } },
      makeRng(1),
    );
    saveGame(e.state);
    const loaded = loadGame();
    expect(loaded).not.toBeNull();
    expect(loaded!.helper).toEqual(e.state.helper);
    expect(loaded!.shopkeeperAppearance).toEqual({ skin: 2, hair: 1 });
    expect(loaded!.currentScript!.helperAlong).toBe(true);
  });

  it("defaults helper/shopkeeperAppearance to null and old scripts' helperAlong to false", () => {
    const e = freshEngine();
    e.state.currentScript = generateAdventureScript(e.state.adventurers, 1, { seed: 2 }, makeRng(2));
    saveGame(e.state);
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY)!);
    delete raw.helper;
    delete raw.shopkeeperAppearance;
    delete raw.currentScript.helperAlong; // pre-#83 script shape
    localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
    const loaded = loadGame();
    expect(loaded!.helper).toBeNull();
    expect(loaded!.shopkeeperAppearance).toBeNull();
    expect(loaded!.currentScript!.helperAlong).toBe(false);
  });
});
