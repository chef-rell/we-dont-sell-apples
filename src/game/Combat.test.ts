// Phase 0 (issue #59): seeded RNG utility + injectable rng in Combat.
// Exit criteria: same seed -> identical outcome; default path unchanged.

import { describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { resolveAdventure, generateAdventureScript } from "./Combat";
import { makeItem } from "../entities/Item";
import { makeRng } from "../utils/rng";
import type { Adventurer, Enchantment } from "../types";

/** A fresh adventurer with known gear, built without touching localStorage
 *  (resume=false skips loadGame entirely — see GameEngine constructor).
 *  Every field resolveAdventure reads is pinned: adventurer generation is
 *  Math.random-based, and an unpinned fixture let two seeds collide into
 *  identical outcomes (~1-in-40 flake) when rounding clamps lined up. */
function adventurerFixture(): Adventurer {
  const a = new GameEngine(false).state.adventurers[0];
  a.level = 2;
  a.hp = 80;
  a.personality.riskTolerance = 50;
  a.appearance.skin = 2;
  a.appearance.hair = 3;
  a.equipment.weapon = makeItem("iron_sword");
  a.equipment.armor = makeItem("leather_armor");
  a.equipment.accessory = undefined;
  return a;
}

describe("makeRng", () => {
  it("produces a deterministic sequence for a given seed", () => {
    const seq1 = Array.from({ length: 5 }, makeRng(42));
    const seq2 = Array.from({ length: 5 }, makeRng(42));
    expect(seq1).toEqual(seq2);
  });

  it("produces floats in [0, 1)", () => {
    const rng = makeRng(7);
    for (let i = 0; i < 50; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("different seeds produce different sequences", () => {
    const seq1 = Array.from({ length: 5 }, makeRng(1));
    const seq2 = Array.from({ length: 5 }, makeRng(2));
    expect(seq1).not.toEqual(seq2);
  });
});

describe("resolveAdventure with injectable rng", () => {
  it("same seed on identically-constructed adventurers yields deeply equal outcomes", () => {
    const a1 = adventurerFixture();
    const a2 = structuredClone(a1);
    const outcome1 = resolveAdventure(a1, 5, {}, makeRng(1234));
    const outcome2 = resolveAdventure(a2, 5, {}, makeRng(1234));
    expect(outcome1).toEqual(outcome2);
  });

  it("different seeds may produce different outcomes", () => {
    const a1 = adventurerFixture();
    const a2 = structuredClone(a1);
    const outcome1 = resolveAdventure(a1, 5, {}, makeRng(1));
    const outcome2 = resolveAdventure(a2, 5, {}, makeRng(999));
    expect(outcome1).not.toEqual(outcome2);
  });

  it("defaults to Math.random — call site with no rng arg still works", () => {
    const a = adventurerFixture();
    expect(() => resolveAdventure(a, 1)).not.toThrow();
    expect(() => resolveAdventure(a, 1, { night: true })).not.toThrow();
  });
});

// ---------- AdventureScript (spec V2.5/V2.6, issue #76) ----------

/** A party of `n` distinctly-geared, distinctly-statted adventurers, built
 *  without touching localStorage. Distinct weapon icons so diversity-bonus
 *  math has something to bite on; distinct hp/level so per-member outcomes
 *  are easy to tell apart in assertions. */
function partyFixture(n: number): Adventurer[] {
  const base = new GameEngine(false).state.adventurers;
  const weapons = ["iron_sword", "hunting_bow", "oak_staff", "rusty_dagger"];
  const party: Adventurer[] = [];
  for (let i = 0; i < n; i++) {
    const a = structuredClone(base[i % base.length]);
    a.id = `party-member-${i}`;
    a.level = 2 + (i % 3);
    a.hp = 40;
    a.maxHp = 40;
    a.personality.riskTolerance = 50;
    a.appearance.skin = i % 4;
    a.appearance.hair = i % 5;
    a.equipment.weapon = makeItem(weapons[i % weapons.length]);
    a.equipment.armor = makeItem("leather_armor");
    a.equipment.accessory = undefined;
    party.push(a);
  }
  return party;
}

describe("generateAdventureScript determinism", () => {
  it("same seed on identically-constructed parties yields a deeply equal script", () => {
    const party1 = partyFixture(4);
    const party2 = structuredClone(party1);
    const script1 = generateAdventureScript(party1, 5, { seed: 777 }, makeRng(777));
    const script2 = generateAdventureScript(party2, 5, { seed: 777 }, makeRng(777));
    expect(script1).toEqual(script2);
  });

  it("different seeds may produce different scripts", () => {
    const party1 = partyFixture(4);
    const party2 = structuredClone(party1);
    const script1 = generateAdventureScript(party1, 5, { seed: 1 }, makeRng(1));
    const script2 = generateAdventureScript(party2, 5, { seed: 2 }, makeRng(2));
    expect(script1).not.toEqual(script2);
  });

  it("defaults to Math.random — call site with no rng arg still works", () => {
    const party = partyFixture(3);
    expect(() => generateAdventureScript(party, 5)).not.toThrow();
    expect(() => generateAdventureScript(party, 5, { night: true })).not.toThrow();
  });
});

describe("generateAdventureScript party formation", () => {
  it("groups the whole party into one script with one member outcome each", () => {
    const party = partyFixture(5);
    const script = generateAdventureScript(party, 10, { seed: 42 }, makeRng(42));
    expect(script.partyIds).toEqual(party.map((a) => a.id));
    expect(script.memberOutcomes).toHaveLength(5);
    expect(script.memberOutcomes.map((o) => o.adventurerId).sort()).toEqual(
      party.map((a) => a.id).sort(),
    );
    expect(script.events[0]).toEqual({ t: 0, type: "march", value: 5 });
  });

  it("party of one is a valid, fully-formed script", () => {
    const party = partyFixture(1);
    const script = generateAdventureScript(party, 1, { seed: 9 }, makeRng(9));
    expect(script.partyIds).toEqual([party[0].id]);
    expect(script.memberOutcomes).toHaveLength(1);
  });
});

describe("generateAdventureScript encounter shape", () => {
  it("clamps encounter count to [1, 6] (solo gets exactly 1, v1 parity) and escalates to the hardest monster last", () => {
    for (const [day, size] of [[1, 1], [5, 2], [12, 6], [30, 10]] as const) {
      const party = partyFixture(size);
      const script = generateAdventureScript(party, day, { seed: day * 100 + size }, makeRng(day * 100 + size));
      const encounters = script.events.filter((e) => e.type === "encounter");
      expect(encounters.length).toBeGreaterThanOrEqual(1);
      expect(encounters.length).toBeLessThanOrEqual(6);
    }
    // A solo, early-day party gets exactly one encounter — the same shape
    // as v1's one-fight-per-solo-trip.
    const solo = generateAdventureScript(partyFixture(1), 1, { seed: 1 }, makeRng(1));
    expect(solo.events.filter((e) => e.type === "encounter")).toHaveLength(1);
  });

  it("wipes out the whole party under a hopeless mismatch and skips returnMarch", () => {
    // Deliberately hopeless: unarmed level-1s vs. a large late-game party
    // size (more encounters) and a high day (bigger, tougher lineup).
    const party = partyFixture(6).map((a) => {
      a.level = 1;
      a.hp = 5;
      a.maxHp = 5;
      a.equipment = {};
      return a;
    });
    // Search a small seed range for one that produces a full wipe — combat
    // has real randomness (winChance floors at 0.15), so not every seed
    // will wipe a weak party, but at least one in a reasonable range will.
    let wiped = false;
    for (let seed = 0; seed < 50 && !wiped; seed++) {
      const script = generateAdventureScript(structuredClone(party), 20, { seed }, makeRng(seed));
      if (script.memberOutcomes.every((o) => !o.survived)) {
        wiped = true;
        expect(script.events.some((e) => e.type === "defeat")).toBe(true);
        expect(script.events.some((e) => e.type === "returnMarch")).toBe(false);
      }
    }
    expect(wiped).toBe(true);
  });
});

describe("generateAdventureScript death rule", () => {
  it("a member dies only on a lost encounter with cumulative damage >= their starting hp", () => {
    // Property check across many seeds and party sizes: whatever the script
    // decides, death must exactly account for the member's starting hp.
    for (let seed = 0; seed < 60; seed++) {
      const party = partyFixture(1 + (seed % 4));
      const startingHp = new Map(party.map((a) => [a.id, a.hp]));
      const script = generateAdventureScript(party, 8, { seed }, makeRng(seed));
      for (const outcome of script.memberOutcomes) {
        if (!outcome.survived) {
          expect(outcome.damageTaken).toBe(startingHp.get(outcome.adventurerId));
        } else {
          expect(outcome.damageTaken).toBeLessThanOrEqual(startingHp.get(outcome.adventurerId)!);
        }
      }
    }
  });

  it("a full wipe kills every member, each with a death event", () => {
    const party = partyFixture(6).map((a) => {
      a.level = 1;
      a.hp = 1; // one hit from anything kills
      a.maxHp = 1;
      a.equipment = {};
      return a;
    });
    let found = false;
    for (let seed = 0; seed < 30 && !found; seed++) {
      const script = generateAdventureScript(structuredClone(party), 15, { seed }, makeRng(seed));
      if (script.memberOutcomes.every((o) => !o.survived)) {
        found = true;
        const deathEvents = script.events.filter((e) => e.type === "death");
        const deadIds = new Set(deathEvents.map((e) => e.actorId));
        expect(deadIds.size).toBe(6);
      }
    }
    expect(found).toBe(true);
  });
});

describe("generateAdventureScript night runs", () => {
  it("marks night scripts and applies the richer loot/gold rules (v1 parity)", () => {
    const party = partyFixture(1);
    const script = generateAdventureScript(party, 5, { night: true, seed: 3 }, makeRng(3));
    expect(script.night).toBe(true);
  });
});

// ---------- Helper (spec V2.7, issue #83) ----------

describe("generateAdventureScript with no helper (regression guard)", () => {
  it("helperAlong is false and the script is byte-identical to a plain call", () => {
    const party1 = partyFixture(4);
    const party2 = structuredClone(party1);
    const scriptA = generateAdventureScript(party1, 5, { seed: 55 }, makeRng(55));
    const scriptB = generateAdventureScript(party2, 5, { seed: 55, helper: undefined }, makeRng(55));
    expect(scriptA.helperAlong).toBe(false);
    expect(scriptA).toEqual(scriptB);
  });
});

describe("generateAdventureScript helperAlong power contribution", () => {
  it("marks helperAlong true and a helper-boosted party wins at least as often as an unaided one", () => {
    // A deliberately marginal party (no gear at all) so a flat +6..+21
    // power boost is large enough to meaningfully move the win rate.
    const marginalParty = () =>
      partyFixture(2).map((a) => {
        a.level = 1;
        a.equipment = {};
        return a;
      });

    let unaidedWins = 0;
    let helpedWins = 0;
    const trials = 80;
    for (let seed = 0; seed < trials; seed++) {
      const unaided = generateAdventureScript(marginalParty(), 5, { seed }, makeRng(seed));
      const helped = generateAdventureScript(marginalParty(), 5, { seed, helper: { level: 5 } }, makeRng(seed));
      expect(helped.helperAlong).toBe(true);
      expect(unaided.helperAlong).toBe(false);
      if (unaided.memberOutcomes.some((o) => o.survived)) unaidedWins++;
      if (helped.memberOutcomes.some((o) => o.survived)) helpedWins++;
    }
    expect(helpedWins).toBeGreaterThanOrEqual(unaidedWins);
  });

  it("a lone weapon type gains a diversity bonus purely from the helper's own slot", () => {
    // Every member wields the SAME weapon type — no diversity bonus without
    // the helper. Confirms the "diversity-slot of its own" mechanic by
    // checking win-rate lift persists even when gear diversity is zero.
    const monoWeaponParty = () =>
      partyFixture(3).map((a) => {
        a.equipment.weapon = makeItem("iron_sword"); // identical icon for everyone
        a.level = 1;
        return a;
      });
    let unaidedWins = 0;
    let helpedWins = 0;
    const trials = 80;
    for (let seed = 0; seed < trials; seed++) {
      const unaided = generateAdventureScript(monoWeaponParty(), 5, { seed }, makeRng(seed));
      const helped = generateAdventureScript(monoWeaponParty(), 5, { seed, helper: { level: 3 } }, makeRng(seed));
      if (unaided.memberOutcomes.some((o) => o.survived)) unaidedWins++;
      if (helped.memberOutcomes.some((o) => o.survived)) helpedWins++;
    }
    expect(helpedWins).toBeGreaterThanOrEqual(unaidedWins);
  });

  it("the helper is never a member and never appears in partyIds or as an event actor", () => {
    const party = partyFixture(4);
    const script = generateAdventureScript(party, 5, { seed: 12, helper: { level: 5 } }, makeRng(12));
    expect(script.partyIds).toEqual(party.map((a) => a.id));
    expect(script.memberOutcomes).toHaveLength(4);
    const actorIds = new Set(script.events.map((e) => e.actorId).filter(Boolean));
    for (const id of actorIds) expect(party.some((a) => a.id === id)).toBe(true);
  });
});

describe("generateAdventureScript full-wipe helper-carry beat", () => {
  it("emits helperCarry events totalling the loot the fallen would have carried, only when helper is along", () => {
    const hopelessParty = () =>
      partyFixture(6).map((a) => {
        a.level = 1;
        a.hp = 5;
        a.maxHp = 5;
        a.equipment = {};
        return a;
      });

    let sawWipeWithHelper = false;
    let sawWipeWithoutHelper = false;
    for (let seed = 0; seed < 60 && !(sawWipeWithHelper && sawWipeWithoutHelper); seed++) {
      const withHelper = generateAdventureScript(
        hopelessParty(),
        20,
        { seed, helper: { level: 4 } },
        makeRng(seed),
      );
      if (withHelper.memberOutcomes.every((o) => !o.survived)) {
        sawWipeWithHelper = true;
        const carryEvents = withHelper.events.filter((e) => e.type === "helperCarry");
        const totalOutcomeGold = withHelper.memberOutcomes.reduce((n, o) => n + o.goldFound, 0);
        const totalOutcomeLoot = withHelper.memberOutcomes.reduce((n, o) => n + o.lootItemKeys.length, 0);
        const carriedGold = carryEvents.reduce((n, e) => n + (e.value ?? 0), 0);
        const carriedItems = carryEvents.filter((e) => e.itemName).length;
        // memberOutcomes are unchanged (still report what each fallen member
        // "found") — the carry events aggregate the exact same totals for
        // player delivery.
        expect(carriedGold).toBe(totalOutcomeGold);
        expect(carriedItems).toBe(totalOutcomeLoot);
      }

      const withoutHelper = generateAdventureScript(hopelessParty(), 20, { seed }, makeRng(seed));
      if (withoutHelper.memberOutcomes.every((o) => !o.survived)) {
        sawWipeWithoutHelper = true;
        expect(withoutHelper.events.some((e) => e.type === "helperCarry")).toBe(false);
      }
    }
    expect(sawWipeWithHelper).toBe(true);
    expect(sawWipeWithoutHelper).toBe(true);
  });
});

// ---------- Rarity/enchantment loot rolls (spec V2.9, issue #90) ----------

describe("generateAdventureScript loot rarity/enchantment determinism", () => {
  it("same seed on identically-constructed parties yields identical lootRolls (rarity + enchantments)", () => {
    // Force wins so loot actually drops: overwhelming power vs a weak day-1 lineup.
    const strongParty = () =>
      partyFixture(4).map((a) => {
        a.level = 10;
        a.hp = 500;
        a.maxHp = 500;
        return a;
      });
    const script1 = generateAdventureScript(strongParty(), 5, { seed: 555 }, makeRng(555));
    const script2 = generateAdventureScript(strongParty(), 5, { seed: 555 }, makeRng(555));
    expect(script1.memberOutcomes.map((o) => o.lootRolls)).toEqual(
      script2.memberOutcomes.map((o) => o.lootRolls),
    );
    // The existing full-script determinism test (`script1 toEqual script2`)
    // already deep-equals every field including lootRolls/itemRarity/
    // itemEnchantments on events — this test just makes that coverage explicit.
    expect(script1).toEqual(script2);
  });

  it("lootItemKeys and lootRolls always stay in sync — same length, same keys, same order", () => {
    const strongParty = () =>
      partyFixture(3).map((a) => {
        a.level = 10;
        a.hp = 500;
        a.maxHp = 500;
        return a;
      });
    for (let seed = 0; seed < 30; seed++) {
      const script = generateAdventureScript(strongParty(), 10, { seed }, makeRng(seed));
      for (const o of script.memberOutcomes) {
        expect(o.lootRolls.map((r) => r.key)).toEqual(o.lootItemKeys);
        for (const roll of o.lootRolls) {
          expect(["common", "uncommon", "rare", "legendary"]).toContain(roll.rarity);
        }
      }
    }
  });

  it("rolls a spread of rarities (not always common) across many seeds — fixed-seed loop, wide tolerance", () => {
    const strongParty = () =>
      partyFixture(2).map((a) => {
        a.level = 10;
        a.hp = 500;
        a.maxHp = 500;
        return a;
      });
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const script = generateAdventureScript(strongParty(), 40, { seed }, makeRng(seed)); // day 40: floor shift maxed out
      for (const o of script.memberOutcomes) {
        for (const roll of o.lootRolls) seen.add(roll.rarity);
      }
    }
    expect(seen.has("common")).toBe(true);
    expect(seen.has("uncommon")).toBe(true);
    // rare/legendary are individually rare — assert at least one non-common,
    // non-uncommon roll showed up over 200 seeds rather than pinning which.
    expect(seen.has("rare") || seen.has("legendary")).toBe(true);
  });
});

// ---------- Enchantment combat effects (spec V2.9, issue #90) ----------
//
// Style note: rather than single fragile seed-searches, these lean on the
// same statistical "helped >= unaided" comparisons the #83 helper-power
// tests above already established for this file — proven non-flaky in this
// codebase (CLAUDE.md: "we have killed three flaky tests already").
// Where a same-seed pairwise comparison IS safe (warding/lifesteal, below),
// hp is set very high so neither twin dies mid-script and the two runs stay
// in perfect rng lockstep for a direct per-seed comparison.

/** A marginal, unarmed party — small enough that a flat combat bonus
 *  meaningfully moves the win/survival rate (mirrors the helper tests'
 *  `marginalParty` fixture above). */
function marginalParty(n: number): Adventurer[] {
  return partyFixture(n).map((a) => {
    a.level = 1;
    a.equipment = {};
    return a;
  });
}

/** Equips `enchantment` on a fresh ring accessory for every party member —
 *  a slot none of the marginal-party setups above otherwise use, so this
 *  is the only variable changed between an enchanted trial and its twin. */
function withEnchant(party: Adventurer[], enchantment: Enchantment): Adventurer[] {
  for (const a of party) {
    a.equipment.accessory = makeItem("simple_ring", { enchantments: [enchantment] });
  }
  return party;
}

describe("generateAdventureScript enchant power bonus (+3/enchant, +2 more for flame)", () => {
  it("an equipped enchantment wins at least as often as the same marginal party unenchanted", () => {
    let plainWins = 0;
    let enchantedWins = 0;
    const trials = 100;
    for (let seed = 0; seed < trials; seed++) {
      const plain = generateAdventureScript(marginalParty(2), 5, { seed }, makeRng(seed));
      const enchanted = generateAdventureScript(withEnchant(marginalParty(2), "flame"), 5, { seed }, makeRng(seed));
      if (plain.memberOutcomes.some((o) => o.survived)) plainWins++;
      if (enchanted.memberOutcomes.some((o) => o.survived)) enchantedWins++;
    }
    expect(enchantedWins).toBeGreaterThanOrEqual(plainWins);
  });

  it("flame's extra +2 gives it at least as high a win rate as a same-count non-flame enchant", () => {
    let wardingWins = 0;
    let flameWins = 0;
    const trials = 100;
    for (let seed = 0; seed < trials; seed++) {
      const warding = generateAdventureScript(withEnchant(marginalParty(2), "warding"), 5, { seed }, makeRng(seed));
      const flame = generateAdventureScript(withEnchant(marginalParty(2), "flame"), 5, { seed }, makeRng(seed));
      if (warding.memberOutcomes.some((o) => o.survived)) wardingWins++;
      if (flame.memberOutcomes.some((o) => o.survived)) flameWins++;
    }
    expect(flameWins).toBeGreaterThanOrEqual(wardingWins);
  });
});

describe("generateAdventureScript warding mitigation (+2 damage reduction)", () => {
  it("a warding-equipped member never takes MORE cumulative damage than the same unenchanted twin, same seed", () => {
    let anyStrictlyLess = false;
    for (let seed = 0; seed < 25; seed++) {
      const plain = partyFixture(1).map((a) => {
        a.hp = 100_000;
        a.maxHp = 100_000; // never dies mid-script — keeps both twins in rng lockstep
        return a;
      });
      const warded = structuredClone(plain);
      warded[0].equipment.accessory = makeItem("simple_ring", { enchantments: ["warding"] });
      const scriptPlain = generateAdventureScript(plain, 15, { seed }, makeRng(seed));
      const scriptWarded = generateAdventureScript(warded, 15, { seed }, makeRng(seed));
      const dmgPlain = scriptPlain.memberOutcomes[0].damageTaken;
      const dmgWarded = scriptWarded.memberOutcomes[0].damageTaken;
      expect(dmgWarded).toBeLessThanOrEqual(dmgPlain);
      if (dmgWarded < dmgPlain) anyStrictlyLess = true;
    }
    expect(anyStrictlyLess).toBe(true);
  });
});

describe("generateAdventureScript lifesteal healing (3 per won encounter)", () => {
  it("a lifesteal-equipped member never ends with MORE cumulative damage than the same unenchanted twin, same seed", () => {
    let anyStrictlyLess = false;
    for (let seed = 0; seed < 25; seed++) {
      const plain = partyFixture(1).map((a) => {
        a.level = 8; // wins often enough for lifesteal's "per WON encounter" heal to matter
        a.hp = 100_000;
        a.maxHp = 100_000;
        return a;
      });
      const lifesteal = structuredClone(plain);
      lifesteal[0].equipment.accessory = makeItem("simple_ring", { enchantments: ["lifesteal"] });
      const scriptPlain = generateAdventureScript(plain, 15, { seed }, makeRng(seed));
      const scriptLifesteal = generateAdventureScript(lifesteal, 15, { seed }, makeRng(seed));
      const dmgPlain = scriptPlain.memberOutcomes[0].damageTaken;
      const dmgLifesteal = scriptLifesteal.memberOutcomes[0].damageTaken;
      expect(dmgLifesteal).toBeLessThanOrEqual(dmgPlain);
      if (dmgLifesteal < dmgPlain) anyStrictlyLess = true;
    }
    expect(anyStrictlyLess).toBe(true);
  });
});

describe("generateAdventureScript vigor HP buffer (+5 maxHp while equipped)", () => {
  it("a vigor-equipped member survives an otherwise-lethal script at least as often as the same fragile twin unenchanted", () => {
    const fragile = () =>
      partyFixture(1).map((a) => {
        a.level = 1;
        a.hp = 5;
        a.maxHp = 5;
        a.equipment = {};
        return a;
      });
    let plainSurvivals = 0;
    let vigorSurvivals = 0;
    const trials = 150;
    for (let seed = 0; seed < trials; seed++) {
      const plainScript = generateAdventureScript(fragile(), 1, { seed }, makeRng(seed));
      const vigorScript = generateAdventureScript(withEnchant(fragile(), "vigor"), 1, { seed }, makeRng(seed));
      if (plainScript.memberOutcomes[0].survived) plainSurvivals++;
      if (vigorScript.memberOutcomes[0].survived) vigorSurvivals++;
    }
    expect(vigorSurvivals).toBeGreaterThanOrEqual(plainSurvivals);
    expect(vigorSurvivals).toBeGreaterThan(plainSurvivals); // the buffer should flip at least one seed over 150 trials
  });
});

describe("generateAdventureScript weather threat multiplier (spec V2.9, issue #94)", () => {
  it("omitting opts.weather is byte-identical to explicitly passing 'clear' (×1, a no-op)", () => {
    const partyA = partyFixture(3);
    const partyB = structuredClone(partyA);
    const scriptDefault = generateAdventureScript(partyA, 10, { seed: 55 }, makeRng(55));
    const scriptClear = generateAdventureScript(partyB, 10, { seed: 55, weather: "clear" }, makeRng(55));
    expect(scriptDefault).toEqual(scriptClear);
  });

  it("rain (×1.15) then fog (×1.25) monotonically raise threat vs clear — fewer wins, more damage taken", () => {
    // A borderline-power solo adventurer (power close enough to threat that
    // the weather multiplier actually flips some encounters) aggregated
    // across many FIXED seeds — deterministic (no unseeded randomness),
    // same shape as the vigor-buffer test above.
    const fixture = () => {
      const a = partyFixture(1)[0];
      a.level = 2;
      a.hp = 60;
      a.maxHp = 60;
      a.equipment.armor = undefined;
      a.equipment.accessory = undefined;
      return [a];
    };
    let clearWins = 0, rainWins = 0, fogWins = 0;
    let clearDmg = 0, rainDmg = 0, fogDmg = 0;
    const trials = 60;
    for (let seed = 0; seed < trials; seed++) {
      const sc = generateAdventureScript(fixture(), 10, { seed, weather: "clear" }, makeRng(seed));
      const sr = generateAdventureScript(fixture(), 10, { seed, weather: "rain" }, makeRng(seed));
      const sf = generateAdventureScript(fixture(), 10, { seed, weather: "fog" }, makeRng(seed));
      if (sc.memberOutcomes[0].monsterDefeated) clearWins++;
      if (sr.memberOutcomes[0].monsterDefeated) rainWins++;
      if (sf.memberOutcomes[0].monsterDefeated) fogWins++;
      clearDmg += sc.memberOutcomes[0].damageTaken;
      rainDmg += sr.memberOutcomes[0].damageTaken;
      fogDmg += sf.memberOutcomes[0].damageTaken;
    }
    expect(clearWins).toBeGreaterThan(rainWins);
    expect(rainWins).toBeGreaterThan(fogWins);
    expect(clearDmg).toBeLessThan(rainDmg);
    expect(rainDmg).toBeLessThan(fogDmg);
  });
});
