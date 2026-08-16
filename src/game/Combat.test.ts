// Phase 0 (issue #59): seeded RNG utility + injectable rng in Combat.
// Exit criteria: same seed -> identical outcome; default path unchanged.

import { describe, expect, it } from "vitest";
import { GameEngine } from "./GameEngine";
import { resolveAdventure } from "./Combat";
import { makeItem } from "../entities/Item";
import { makeRng } from "../utils/rng";
import type { Adventurer } from "../types";

/** A fresh adventurer with known gear, built without touching localStorage
 *  (resume=false skips loadGame entirely — see GameEngine constructor). */
function adventurerFixture(): Adventurer {
  const a = new GameEngine(false).state.adventurers[0];
  a.equipment.weapon = makeItem("iron_sword");
  a.equipment.armor = makeItem("leather_armor");
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
