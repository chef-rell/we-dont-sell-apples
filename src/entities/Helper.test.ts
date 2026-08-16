// Helper entity: XP/level math, trait aptitude, the shop-track speed seam,
// the adventure-track combat contribution, and the pricing recommendation
// (spec V2.7, issue #83).

import { describe, expect, it } from "vitest";
import {
  LEVEL_THRESHOLDS,
  accrueXp,
  browseSpeedFactor,
  createHelper,
  dailyHelperXp,
  helperCombatPower,
  levelForXp,
  suggestPriceFor,
  traitMatchesTrack,
} from "./Helper";
import { makeItem } from "./Item";
import type { GameState, Helper, PriceRecord } from "../types";

function baseHelper(overrides: Partial<Helper> = {}): Helper {
  return {
    id: "helper-1",
    name: "Robin",
    appearance: { skin: 0, hair: 0 },
    trait: "charming",
    track: "none",
    level: 1,
    xp: 0,
    assignment: "chores",
    assignmentDay: 1,
    ...overrides,
  };
}

describe("createHelper factory", () => {
  it("produces a fresh, unspecialized helper on tutorial chores", () => {
    const h = createHelper("Robin", { skin: 1, hair: 2 }, "brave", 1);
    expect(h.name).toBe("Robin");
    expect(h.appearance).toEqual({ skin: 1, hair: 2 });
    expect(h.trait).toBe("brave");
    expect(h.track).toBe("none");
    expect(h.level).toBe(1);
    expect(h.xp).toBe(0);
    expect(h.assignment).toBe("chores");
    expect(h.assignmentDay).toBe(1);
    expect(typeof h.id).toBe("string");
    expect(h.id.length).toBeGreaterThan(0);
  });
});

describe("levelForXp thresholds (0/30/80/160/280)", () => {
  it("maps xp to the right level at and around every boundary", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(29)).toBe(1);
    expect(levelForXp(30)).toBe(2);
    expect(levelForXp(79)).toBe(2);
    expect(levelForXp(80)).toBe(3);
    expect(levelForXp(159)).toBe(3);
    expect(levelForXp(160)).toBe(4);
    expect(levelForXp(279)).toBe(4);
    expect(levelForXp(280)).toBe(5);
    expect(levelForXp(10_000)).toBe(5); // caps at the top level, no overflow
  });

  it("LEVEL_THRESHOLDS is exactly the spec sequence", () => {
    expect(LEVEL_THRESHOLDS).toEqual([0, 30, 80, 160, 280]);
  });
});

describe("traitMatchesTrack aptitude", () => {
  it("matches curious->craft, brave->adventure, charming->shop and nothing else", () => {
    expect(traitMatchesTrack("curious", "craft")).toBe(true);
    expect(traitMatchesTrack("brave", "adventure")).toBe(true);
    expect(traitMatchesTrack("charming", "shop")).toBe(true);
    expect(traitMatchesTrack("curious", "shop")).toBe(false);
    expect(traitMatchesTrack("brave", "craft")).toBe(false);
    expect(traitMatchesTrack("charming", "adventure")).toBe(false);
    expect(traitMatchesTrack("brave", "none")).toBe(false); // track "none" never matches
  });
});

describe("dailyHelperXp", () => {
  it("gives +4 for chores and +10 for shop/adventure with no trait match", () => {
    expect(dailyHelperXp(baseHelper({ trait: "curious", track: "none", assignment: "chores" }))).toBe(4);
    expect(dailyHelperXp(baseHelper({ trait: "curious", track: "none", assignment: "shop" }))).toBe(10);
    expect(dailyHelperXp(baseHelper({ trait: "curious", track: "none", assignment: "adventure" }))).toBe(10);
  });

  it("applies the x1.5 trait-matches-track multiplier only once the track is committed", () => {
    // Pre-day-10: track is "none" so the trait bonus never applies, even
    // though the trait would match "shop" once chosen.
    const preTrack = baseHelper({ trait: "charming", track: "none", assignment: "shop" });
    expect(dailyHelperXp(preTrack)).toBe(10);

    // Post-day-10, matching track chosen: x1.5.
    const matched = baseHelper({ trait: "charming", track: "shop", assignment: "shop" });
    expect(dailyHelperXp(matched)).toBe(15);

    // Track chosen but doesn't match the trait: no bonus.
    const mismatched = baseHelper({ trait: "curious", track: "shop", assignment: "shop" });
    expect(dailyHelperXp(mismatched)).toBe(10);
  });

  it("doubles adventure-track XP on a wipe day, and only for adventure assignment", () => {
    const adventuring = baseHelper({ trait: "brave", track: "adventure", assignment: "adventure" });
    expect(dailyHelperXp(adventuring, { wipeDay: true })).toBe(30); // 10 * 1.5 * 2
    expect(dailyHelperXp(adventuring, { wipeDay: false })).toBe(15);

    // A wipe flag on a non-adventure assignment day doesn't double anything
    // (the beat only happens when they were actually out with the party).
    // Trait deliberately non-matching here so the x1.5 doesn't interfere
    // with isolating the wipe-doubling behavior.
    const onChores = baseHelper({ trait: "curious", track: "adventure", assignment: "chores" });
    expect(dailyHelperXp(onChores, { wipeDay: true })).toBe(4);
  });
});

describe("accrueXp", () => {
  it("adds a day's xp and recomputes level from the new total", () => {
    const h = baseHelper({ trait: "charming", track: "shop", assignment: "shop", xp: 25 });
    const result = accrueXp(h); // +15 (10 * 1.5) => 40 => level 2
    expect(result.xp).toBe(40);
    expect(result.level).toBe(2);
  });

  it("crossing a threshold exactly bumps the level that day", () => {
    const h = baseHelper({ assignment: "shop", xp: 20 }); // +10 => 30, the L2 floor
    const result = accrueXp(h);
    expect(result.xp).toBe(30);
    expect(result.level).toBe(2);
  });
});

describe("browseSpeedFactor (shop-track wait scaling seam)", () => {
  function stateWithHelper(helper: Helper | null): GameState {
    return { helper } as GameState; // only `.helper` is read by this pure function
  }

  it("is exactly 1 (no-op) when there is no helper", () => {
    expect(browseSpeedFactor(stateWithHelper(null))).toBe(1);
  });

  it("is exactly 1 when the helper exists but isn't on shop duty today", () => {
    const h = baseHelper({ level: 5, assignment: "adventure" });
    expect(browseSpeedFactor(stateWithHelper(h))).toBe(1);
    const chores = baseHelper({ level: 5, assignment: "chores" });
    expect(browseSpeedFactor(stateWithHelper(chores))).toBe(1);
  });

  it("scales down by 1 - 0.06*level while on shop duty, floored at 0.7", () => {
    expect(browseSpeedFactor(stateWithHelper(baseHelper({ level: 1, assignment: "shop" })))).toBeCloseTo(0.94);
    expect(browseSpeedFactor(stateWithHelper(baseHelper({ level: 3, assignment: "shop" })))).toBeCloseTo(0.82);
    expect(browseSpeedFactor(stateWithHelper(baseHelper({ level: 5, assignment: "shop" })))).toBeCloseTo(0.7);
  });
});

describe("helperCombatPower", () => {
  it("is 6 + 3*level", () => {
    expect(helperCombatPower({ level: 1 })).toBe(9);
    expect(helperCombatPower({ level: 3 })).toBe(15);
    expect(helperCombatPower({ level: 5 })).toBe(21);
  });
});

describe("suggestPriceFor", () => {
  it("falls back to the clamp-range midpoint (1.35x) with no history", () => {
    const item = makeItem("iron_sword"); // baseValue 30
    expect(suggestPriceFor([], item)).toBe(Math.round(30 * 1.35));
  });

  it("averages the category's recent markup ratios and clamps to 1.1-1.6x", () => {
    const item = makeItem("steel_sword"); // category weapon, baseValue 60
    const history: PriceRecord[] = [
      { itemCategory: "weapon", itemName: "Iron Sword", priceSet: 30, baseValue: 30, markupRatio: 1.0, daySet: 1 },
      { itemCategory: "weapon", itemName: "Iron Sword", priceSet: 45, baseValue: 30, markupRatio: 1.5, daySet: 2 },
      { itemCategory: "armor", itemName: "Wooden Shield", priceSet: 40, baseValue: 20, markupRatio: 2.0, daySet: 2 },
    ];
    // Only the two weapon records count: avg(1.0, 1.5) = 1.25, clamped
    // in-range already, so 60 * 1.25 = 75.
    expect(suggestPriceFor(history, item)).toBe(75);
  });

  it("clamps an out-of-range average markup to [1.1, 1.6]", () => {
    const item = makeItem("iron_sword");
    const cheap: PriceRecord[] = [
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 0.5, daySet: 1 },
    ];
    expect(suggestPriceFor(cheap, item)).toBe(Math.round(30 * 1.1));

    const steep: PriceRecord[] = [
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 3.0, daySet: 1 },
    ];
    expect(suggestPriceFor(steep, item)).toBe(Math.round(30 * 1.6));
  });

  it("only considers the most recent `recentCount` records for the category", () => {
    const item = makeItem("iron_sword");
    const history: PriceRecord[] = [
      // An old outlier that recentCount should exclude...
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 3.0, daySet: 1 },
      // ...followed by three consistent, in-range recent sets.
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 1.2, daySet: 2 },
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 1.2, daySet: 3 },
      { itemCategory: "weapon", itemName: "x", priceSet: 1, baseValue: 30, markupRatio: 1.2, daySet: 4 },
    ];
    expect(suggestPriceFor(history, item, 3)).toBe(Math.round(30 * 1.2));
  });
});
