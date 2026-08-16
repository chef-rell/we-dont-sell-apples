// Rarity, enchantment, and durability-split math (spec V2.9, issue #90).
// Statistical distribution tests use a FIXED seed loop (makeRng), never
// Math.random — this repo has killed three flaky tests already (see
// CLAUDE.md); wide tolerance bands keep these robust to rng-tuning.

import { describe, expect, it } from "vitest";
import {
  ALL_ENCHANTMENTS,
  applyRarity,
  ITEM_DEFS,
  makeItem,
  rarityWeightsForDay,
  rollLootEnchantments,
  rollLootRarity,
} from "./Item";
import { makeRng } from "../utils/rng";
import type { Enchantment, Item, ItemRarity } from "../types";

function freshItem(baseValue = 100): Item {
  return {
    id: "test",
    name: "Test Item",
    category: "weapon",
    baseValue,
    salePrice: null,
    quality: 3,
    icon: "sword",
    durability: null,
    maxDurability: null,
    timesRepaired: 0,
    rarity: "common",
    enchantments: [],
    origin: "stock",
  };
}

describe("makeItem defaults (byte-for-byte preserved)", () => {
  it("produces today's exact baseValue/durability with no opts passed", () => {
    const sword = makeItem("iron_sword");
    expect(sword.baseValue).toBe(ITEM_DEFS.iron_sword.baseValue); // 30, unmultiplied
    expect(sword.maxDurability).toBe(20 + 3 * 5); // BASE_DURABILITY + quality*SCALE, unmultiplied
    expect(sword.durability).toBe(sword.maxDurability);
    expect(sword.rarity).toBe("common");
    expect(sword.enchantments).toEqual([]);
    expect(sword.origin).toBe("stock");
  });

  it("non-gear items stay durability: null regardless of origin", () => {
    const potion = makeItem("health_potion", { origin: "loot" });
    expect(potion.durability).toBeNull();
    expect(potion.maxDurability).toBeNull();
  });
});

describe("applyRarity — the single baseValue multiplier site (CLAUDE.md rule 1)", () => {
  it("common is a ×1 no-op", () => {
    const item = applyRarity(freshItem(100), "common");
    expect(item.baseValue).toBe(100);
  });

  it.each([
    ["uncommon", 1.6],
    ["rare", 2.8],
    ["legendary", 5],
  ] as const)("%s multiplies baseValue by %s", (rarity, mult) => {
    const item = applyRarity(freshItem(100), rarity);
    expect(item.baseValue).toBe(Math.round(100 * mult));
  });

  it("each enchantment adds +25% baseValue, additive (not compounding)", () => {
    const one = applyRarity(freshItem(100), "common", ["flame"]);
    const two = applyRarity(freshItem(100), "common", ["flame", "warding"]);
    expect(one.baseValue).toBe(125); // 100 * 1.25
    expect(two.baseValue).toBe(150); // 100 * (1 + 0.25*2) = 150, NOT 100*1.25*1.25=156
  });

  it("rarity and enchantment multipliers combine multiplicatively", () => {
    const item = applyRarity(freshItem(100), "rare", ["flame", "lifesteal"]);
    // 2.8 (rare) * (1 + 0.25*2) = 2.8 * 1.5 = 4.2
    expect(item.baseValue).toBe(Math.round(100 * 2.8 * 1.5));
  });

  it("sets rarity and enchantments on the item", () => {
    const item = applyRarity(freshItem(), "legendary", ["vigor"]);
    expect(item.rarity).toBe("legendary");
    expect(item.enchantments).toEqual(["vigor"]);
  });
});

describe("makeItem with rarity/enchantment opts", () => {
  it("threads rarity/enchantments through applyRarity", () => {
    const sword = makeItem("iron_sword", { rarity: "rare", enchantments: ["flame"] });
    const base = ITEM_DEFS.iron_sword.baseValue;
    expect(sword.baseValue).toBe(Math.round(base * 2.8 * 1.25));
    expect(sword.rarity).toBe("rare");
    expect(sword.enchantments).toEqual(["flame"]);
  });
});

describe("durability split by origin (spec V2.9)", () => {
  it("loot origin gear gets ×0.7 maxDurability", () => {
    const stock = makeItem("iron_sword", { origin: "stock" });
    const loot = makeItem("iron_sword", { origin: "loot" });
    expect(loot.maxDurability).toBe(Math.round(stock.maxDurability! * 0.7));
    expect(loot.durability).toBe(loot.maxDurability);
  });

  it("forged origin gear gets ×1.3 maxDurability", () => {
    const stock = makeItem("iron_sword", { origin: "stock" });
    const forged = makeItem("iron_sword", { origin: "forged" });
    expect(forged.maxDurability).toBe(Math.round(stock.maxDurability! * 1.3));
  });

  it("stock origin is unchanged from today's numbers", () => {
    const stock = makeItem("leather_armor", { origin: "stock" });
    const noOpts = makeItem("leather_armor");
    expect(stock.maxDurability).toBe(noOpts.maxDurability);
  });
});

describe("rarityWeightsForDay", () => {
  it("matches the base 60/30/9/1 split at day 0", () => {
    const w = rarityWeightsForDay(0);
    expect(w).toEqual({ common: 60, uncommon: 30, rare: 9, legendary: 1 });
  });

  it("shifts 5% out of common per 5 elapsed days, floored at 25%", () => {
    expect(rarityWeightsForDay(5).common).toBe(55);
    expect(rarityWeightsForDay(10).common).toBe(50);
    expect(rarityWeightsForDay(25).common).toBe(35);
    expect(rarityWeightsForDay(35).common).toBe(25); // floor hit (60-35=25)
    expect(rarityWeightsForDay(100).common).toBe(25); // stays at the floor
  });

  it("weights always sum to 100, at every day", () => {
    for (const day of [0, 1, 4, 5, 9, 10, 30, 50, 200]) {
      const w = rarityWeightsForDay(day);
      expect(w.common + w.uncommon + w.rare + w.legendary).toBeCloseTo(100, 9);
    }
  });

  it("redistributes the shift proportionally, preserving the day-0 ratio among non-common tiers", () => {
    const w = rarityWeightsForDay(35); // fully floored: 35 points shifted out of common
    // day-0 ratio uncommon:rare:legendary = 30:9:1
    expect(w.uncommon / w.rare).toBeCloseTo(30 / 9, 6);
    expect(w.rare / w.legendary).toBeCloseTo(9 / 1, 6);
  });
});

describe("rollLootRarity distribution (fixed seed, wide tolerance)", () => {
  it("day-0 rolls land close to 60/30/9/1 over 500 fixed-seed draws", () => {
    const rng = makeRng(42);
    const counts: Record<ItemRarity, number> = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
    const trials = 500;
    for (let i = 0; i < trials; i++) counts[rollLootRarity(0, rng)]++;
    // Wide tolerance bands — this is a statistical check, not an exact one.
    expect(counts.common / trials).toBeGreaterThan(0.5);
    expect(counts.common / trials).toBeLessThan(0.7);
    expect(counts.uncommon / trials).toBeGreaterThan(0.2);
    expect(counts.uncommon / trials).toBeLessThan(0.4);
    expect(counts.rare + counts.legendary).toBeGreaterThan(0); // rare tiers do occur
    expect((counts.rare + counts.legendary) / trials).toBeLessThan(0.2);
  });

  it("late-game rolls (day 100+, floor hit) skew away from common vs day 0", () => {
    const rngEarly = makeRng(7);
    const rngLate = makeRng(7);
    const trials = 500;
    let earlyCommon = 0;
    let lateCommon = 0;
    for (let i = 0; i < trials; i++) {
      if (rollLootRarity(0, rngEarly) === "common") earlyCommon++;
      if (rollLootRarity(200, rngLate) === "common") lateCommon++;
    }
    expect(lateCommon).toBeLessThan(earlyCommon);
  });

  it("is deterministic given the same seeded rng sequence", () => {
    const seq1 = Array.from({ length: 50 }, () => rollLootRarity(10, makeRng(99)));
    const seq2 = Array.from({ length: 50 }, () => rollLootRarity(10, makeRng(99)));
    expect(seq1).toEqual(seq2);
  });
});

describe("rollLootEnchantments distribution (fixed seed, wide tolerance)", () => {
  it("common rarity never enchants", () => {
    const rng = makeRng(1);
    for (let i = 0; i < 200; i++) {
      expect(rollLootEnchantments("common", rng)).toEqual([]);
    }
  });

  it("uncommon rolls an enchantment roughly 40% of the time, never more than one", () => {
    const rng = makeRng(2);
    const trials = 500;
    let withEnchant = 0;
    for (let i = 0; i < trials; i++) {
      const e = rollLootEnchantments("uncommon", rng);
      expect(e.length).toBeLessThanOrEqual(1);
      if (e.length > 0) withEnchant++;
    }
    expect(withEnchant / trials).toBeGreaterThan(0.3);
    expect(withEnchant / trials).toBeLessThan(0.5);
  });

  it("rare rolls a first enchant ~70% of the time and a second only nested within that, ~20% of those", () => {
    const rng = makeRng(3);
    const trials = 500;
    let withFirst = 0;
    let withSecond = 0;
    for (let i = 0; i < trials; i++) {
      const e = rollLootEnchantments("rare", rng);
      expect(e.length).toBeLessThanOrEqual(2);
      if (e.length >= 1) withFirst++;
      if (e.length === 2) withSecond++;
    }
    expect(withFirst / trials).toBeGreaterThan(0.6);
    expect(withFirst / trials).toBeLessThan(0.8);
    // second only ever fires on top of a first landing, so it's a fraction
    // of the whole (~0.7*0.2=0.14), not 20% of all trials.
    expect(withSecond / trials).toBeGreaterThan(0.08);
    expect(withSecond / trials).toBeLessThan(0.22);
  });

  it("legendary always gets at least one enchant, a second ~60% of the time", () => {
    const rng = makeRng(4);
    const trials = 500;
    let withSecond = 0;
    for (let i = 0; i < trials; i++) {
      const e = rollLootEnchantments("legendary", rng);
      expect(e.length).toBeGreaterThanOrEqual(1);
      expect(e.length).toBeLessThanOrEqual(2);
      if (e.length === 2) withSecond++;
    }
    expect(withSecond / trials).toBeGreaterThan(0.5);
    expect(withSecond / trials).toBeLessThan(0.7);
  });

  it("never rolls the same enchantment twice on one item", () => {
    const rng = makeRng(5);
    for (let i = 0; i < 500; i++) {
      const e = rollLootEnchantments("legendary", rng);
      expect(new Set(e).size).toBe(e.length);
      for (const ench of e) expect(ALL_ENCHANTMENTS).toContain(ench as Enchantment);
    }
  });
});

describe("legendary-vs-forged value ratio sanity", () => {
  it("a legendary loot drop is worth substantially more than the same item forged/stock", () => {
    const forged = makeItem("steel_sword", { origin: "forged" }); // forge ceiling is uncommon; forged never rolls legendary in practice
    const legendaryLoot = makeItem("steel_sword", { rarity: "legendary", origin: "loot" });
    expect(legendaryLoot.baseValue).toBeGreaterThan(forged.baseValue * 4);
  });

  it("legendary + double enchant meaningfully outvalues a bare rare of the same item", () => {
    const rare = makeItem("steel_sword", { rarity: "rare", origin: "loot" });
    const legendary = makeItem("steel_sword", { rarity: "legendary", enchantments: ["flame", "vigor"], origin: "loot" });
    expect(legendary.baseValue).toBeGreaterThan(rare.baseValue * 2);
  });
});
