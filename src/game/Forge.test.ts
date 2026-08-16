// Repair math (spec V2.9, issue #90). Pure-function unit tests — no engine,
// no state, per Forge.ts's own constraint (engine wiring is Phase 4b).

import { describe, expect, it } from "vitest";
import { applyRepair, canRepair, prefersRepair, repairCost } from "./Forge";
import { makeItem } from "../entities/Item";
import type { Adventurer, Item } from "../types";

function gear(overrides: Partial<Item> = {}): Item {
  const item = makeItem("iron_sword");
  return { ...item, ...overrides };
}

function adventurer(): Adventurer {
  // prefersRepair's `a` param is unused today (documented judgment call in
  // Forge.ts) — a minimal stub is enough to satisfy the type.
  return {} as Adventurer;
}

describe("repairCost", () => {
  it("is 35% of current baseValue, rounded", () => {
    const item = gear({ baseValue: 100 });
    expect(repairCost(item)).toBe(35);
  });

  it("scales with rarity-inflated baseValue", () => {
    const legendary = makeItem("iron_sword", { rarity: "legendary", origin: "loot" });
    const common = makeItem("iron_sword");
    expect(repairCost(legendary)).toBeGreaterThan(repairCost(common) * 4);
    expect(repairCost(legendary)).toBe(Math.round(0.35 * legendary.baseValue));
  });
});

describe("canRepair", () => {
  it("is true for damaged gear under the repair cap", () => {
    const item = gear({ durability: 10, maxDurability: 40, timesRepaired: 0 });
    expect(canRepair(item)).toBe(true);
  });

  it("is false once timesRepaired hits the cap (3)", () => {
    const item = gear({ durability: 10, maxDurability: 40, timesRepaired: 3 });
    expect(canRepair(item)).toBe(false);
    const overCap = gear({ durability: 10, maxDurability: 40, timesRepaired: 5 });
    expect(canRepair(overCap)).toBe(false);
  });

  it("is false for gear already at full durability", () => {
    const item = gear({ durability: 40, maxDurability: 40, timesRepaired: 0 });
    expect(canRepair(item)).toBe(false);
  });

  it("is false for non-gear (durability/maxDurability null)", () => {
    const potion = makeItem("health_potion");
    expect(canRepair(potion)).toBe(false);
  });

  it("timesRepaired 0, 1, 2 can all repair; 3+ cannot (cap boundary)", () => {
    for (const n of [0, 1, 2]) {
      expect(canRepair(gear({ durability: 5, maxDurability: 40, timesRepaired: n }))).toBe(true);
    }
    for (const n of [3, 4]) {
      expect(canRepair(gear({ durability: 5, maxDurability: 40, timesRepaired: n }))).toBe(false);
    }
  });
});

describe("applyRepair", () => {
  it("restores durability to (a shrunken) full and increments timesRepaired", () => {
    const item = gear({ durability: 5, maxDurability: 40, timesRepaired: 0 });
    const repaired = applyRepair(item);
    expect(repaired.maxDurability).toBe(Math.round(40 * 0.85)); // -15%
    expect(repaired.durability).toBe(repaired.maxDurability);
    expect(repaired.timesRepaired).toBe(1);
  });

  it("does not mutate the input item (pure function)", () => {
    const item = gear({ durability: 5, maxDurability: 40, timesRepaired: 0 });
    const snapshot = { ...item };
    applyRepair(item);
    expect(item).toEqual(snapshot);
  });

  it("maxDurability decays ~15% compounding across repeated repairs", () => {
    let item = gear({ durability: 10, maxDurability: 100, timesRepaired: 0 });
    item = applyRepair(item);
    expect(item.maxDurability).toBe(85);
    item = applyRepair(item);
    expect(item.maxDurability).toBe(Math.round(85 * 0.85)); // 72
    item = applyRepair(item);
    expect(item.timesRepaired).toBe(3);
  });

  it("baseValue is untouched by repair (only Item.ts's applyRarity ever changes it)", () => {
    const item = gear({ baseValue: 123, durability: 5, maxDurability: 40 });
    const repaired = applyRepair(item);
    expect(repaired.baseValue).toBe(123);
  });
});

describe("prefersRepair", () => {
  it("false when no forge is available, even if repair would otherwise be preferred", () => {
    const item = gear({ baseValue: 100, durability: 5, maxDurability: 40, timesRepaired: 0 });
    expect(prefersRepair(adventurer(), item, false)).toBe(false);
  });

  it("true when a forge exists, repair is cheap relative to replacement, and the cap isn't hit", () => {
    const item = gear({ baseValue: 100, durability: 5, maxDurability: 40, timesRepaired: 0 });
    expect(prefersRepair(adventurer(), item, true)).toBe(true);
  });

  it("false once the repair cap is hit, even with a forge available", () => {
    const item = gear({ baseValue: 100, durability: 5, maxDurability: 40, timesRepaired: 3 });
    expect(prefersRepair(adventurer(), item, true)).toBe(false);
  });

  it("false for gear already at full durability (nothing to repair)", () => {
    const item = gear({ baseValue: 100, durability: 40, maxDurability: 40, timesRepaired: 0 });
    expect(prefersRepair(adventurer(), item, true)).toBe(false);
  });

  it("repairCost stays comfortably under the 45% replacement ceiling at every rarity", () => {
    for (const rarity of ["common", "uncommon", "rare", "legendary"] as const) {
      const item = makeItem("iron_sword", { rarity, origin: "loot" });
      item.durability = 1; // force damaged so canRepair passes
      expect(prefersRepair(adventurer(), item, true)).toBe(true);
    }
  });
});
