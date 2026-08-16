// The §6 invariant under test: reactions and verdicts are deterministic,
// band-driven, and personality shifts stay inside ±15%.

import { describe, expect, it } from "vitest";
import type { Adventurer, Item } from "../types";
import { computeReaction, decidesToBuy, toleranceShift, classifyPrice } from "./Economy";
import { REACTION_SHIFT_MAX } from "../utils/constants";

function testAdventurer(overrides: Partial<Adventurer> = {}): Adventurer {
  return {
    id: "test-a",
    name: "Test Subject",
    class: "warrior",
    level: 3,
    gold: 500,
    hp: 30,
    maxHp: 30,
    inventory: [],
    equipment: {},
    personality: {
      traits: [],
      spendingStyle: "careful",
      riskTolerance: 50,
      haggleSkill: 50,
      preferredItems: [],
      quirks: [],
    },
    state: "browsing",
    position: { x: 0, y: 0, facing: "down", moving: false },
    morale: 50,
    loyalty: 50,
    relationships: { shopkeeper: 0 },
    memory: {
      lastPricePaid: {},
      timesOvercharged: 0,
      timesFairlyTreated: 0,
      favoriteItem: null,
      bestAdventureResult: null,
      grudges: false,
      daysInTown: 0,
      lowMoraleDays: 0,
    },
    alive: true,
    daysSinceLastAdventure: 0,
    nightOwl: false,
    browsingItemId: null,
    appearance: { skin: 0, hair: 0 },
    ...overrides,
  };
}

function item(salePrice: number | null, baseValue = 100, quality = 5): Item {
  return {
    id: "test-item",
    name: "Test Sword",
    category: "weapon",
    baseValue,
    salePrice,
    quality,
    icon: "sword",
  };
}

describe("toleranceShift", () => {
  it("stays within ±REACTION_SHIFT_MAX for extreme personalities", () => {
    const scrooge = testAdventurer({
      personality: { ...testAdventurer().personality, spendingStyle: "frugal" },
      loyalty: 0,
      morale: 0,
      relationships: { shopkeeper: -100 },
      gold: 10,
    });
    const patron = testAdventurer({
      personality: { ...testAdventurer().personality, spendingStyle: "generous" },
      loyalty: 100,
      morale: 100,
      relationships: { shopkeeper: 100 },
    });
    for (const a of [scrooge, patron]) {
      const shift = toleranceShift(a, item(130));
      expect(Math.abs(shift)).toBeLessThanOrEqual(REACTION_SHIFT_MAX);
    }
  });

  it("is deterministic: same adventurer + item → same shift", () => {
    const a = testAdventurer();
    const it1 = item(150);
    expect(toleranceShift(a, it1)).toBe(toleranceShift(a, it1));
  });
});

describe("computeReaction", () => {
  it("follows the §5 bands, shifted by exactly toleranceShift", () => {
    // No personality is a true zero-shift (every spending style nudges the
    // thresholds — that's §6 working), so assert the bands relative to the
    // adventurer's computed shift: boundaries sit at band × (1 + shift).
    const a = testAdventurer({ equipment: { weapon: item(null, 100, 4) } });
    const eps = 0.5; // half a gold: just inside / just outside a boundary
    for (const [band, below, above] of [
      [1.3, "happy", "neutral"],
      [1.8, "neutral", "unhappy"],
      [2.5, "unhappy", "angry"],
    ] as const) {
      const priceAt = (markup: number) => {
        const probe = item(Math.round(markup * 100));
        const m = 1 + toleranceShift(a, probe);
        return item(Math.round(band * m * 100 + (markup > band ? eps * 2 : -eps)));
      };
      expect(computeReaction(a, priceAt(band - 0.01))).toBe(below);
      expect(computeReaction(a, priceAt(band + 0.01))).toBe(above);
    }
    expect(computeReaction(a, item(100))).toBe("happy"); // 1.0× is always a deal
  });

  it("treats unpriced items as neutral", () => {
    expect(computeReaction(testAdventurer(), item(null))).toBe("neutral");
  });

  it("gives loyal generous buyers more slack than hostile frugal ones", () => {
    const price = item(185); // 1.85× — right at the unhappy boundary
    const generous = testAdventurer({
      personality: { ...testAdventurer().personality, spendingStyle: "generous" },
      loyalty: 100,
      relationships: { shopkeeper: 80 },
      morale: 90,
    });
    const frugal = testAdventurer({
      personality: { ...testAdventurer().personality, spendingStyle: "frugal" },
      loyalty: 0,
      relationships: { shopkeeper: -80 },
      morale: 10,
    });
    const gRank = rank(computeReaction(generous, price));
    const fRank = rank(computeReaction(frugal, price));
    expect(gRank).toBeLessThanOrEqual(fRank); // generous never reacts worse
    expect(gRank).toBeLessThan(fRank); // and here the gap should be visible
  });
});

describe("decidesToBuy", () => {
  it("never buys what it cannot afford", () => {
    const broke = testAdventurer({ gold: 50 });
    expect(decidesToBuy(broke, item(100))).toBe(false);
  });

  it("never buys at angry prices", () => {
    const rich = testAdventurer({ gold: 100_000 });
    expect(decidesToBuy(rich, item(400))).toBe(false); // 4× markup
  });

  it("buys a needed upgrade at a happy price", () => {
    const needy = testAdventurer(); // empty equipment, quality 5 sword on offer
    expect(decidesToBuy(needy, item(110))).toBe(true);
  });
});

describe("classifyPrice", () => {
  it("maps markup bands to fairness", () => {
    expect(classifyPrice(item(120))).toBe("fair");
    expect(classifyPrice(item(160))).toBe("steep");
    expect(classifyPrice(item(300))).toBe("ripoff");
  });
});

function rank(r: string): number {
  return ["happy", "neutral", "unhappy", "angry"].indexOf(r);
}
