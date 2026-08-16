// The Helper entity (spec V2.7, issue #83): XP/level math, trait aptitude,
// the shop-track queue-speed seam, the adventure-track combat contribution,
// the L3+ pricing recommendation, and the creation factory. All pure
// functions — GameEngine wires these into daily rollover, party formation,
// and the pricing panel surface; the behavior state machine
// (AdventurerBehavior.ts) calls exactly one of these (browseSpeedFactor)
// and otherwise stays entirely unaware a helper exists (issue #83's seam
// requirement).

import type { GameState, Helper, HelperAssignment, HelperTrack, HelperTrait, Item, PriceRecord } from "../types";

/** XP required to REACH each level; index 0 = level 1's floor (0xp).
 *  Level 1: 0-29, Level 2: 30-79, Level 3: 80-159, Level 4: 160-279,
 *  Level 5: 280+ (spec V2.7, issue #83). */
export const LEVEL_THRESHOLDS = [0, 30, 80, 160, 280] as const;
export const MAX_HELPER_LEVEL = LEVEL_THRESHOLDS.length; // 5

/** Level for a given XP total — monotonic, never decreases as xp grows. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  return level;
}

/** Creation-trait aptitude (spec V2.7): curious→craft, brave→adventure,
 *  charming→shop. Checked against the PERMANENT track, not today's daily
 *  assignment — before day 10 track is "none" and never matches, so the
 *  bonus only starts once the player commits at the day-10 gate. */
export function traitMatchesTrack(trait: HelperTrait, track: HelperTrack): boolean {
  return (
    (trait === "curious" && track === "craft") ||
    (trait === "brave" && track === "adventure") ||
    (trait === "charming" && track === "shop")
  );
}

/** One day's XP for the helper's CURRENT assignment (issue #83): +10/day
 *  for shop/adventure, +4/day for chores (tutorial flavor, still building
 *  toward the same level curve). ×1.5 when the creation trait matches the
 *  permanent track. Doubled on a day the adventure-track helper dragged
 *  the party's loot home from a full wipe ("they grew up fast"). */
export function dailyHelperXp(helper: Helper, opts: { wipeDay?: boolean } = {}): number {
  const base = helper.assignment === "chores" ? 4 : 10;
  const traitMultiplier = traitMatchesTrack(helper.trait, helper.track) ? 1.5 : 1;
  const wipeMultiplier = opts.wipeDay && helper.assignment === "adventure" ? 2 : 1;
  return Math.round(base * traitMultiplier * wipeMultiplier);
}

/** Apply a day's XP; returns the new {xp, level} for the caller to assign
 *  (GameEngine.onNewDay — spec V2.7's "handled at day rollover"). */
export function accrueXp(helper: Helper, opts: { wipeDay?: boolean } = {}): { xp: number; level: number } {
  const xp = helper.xp + dailyHelperXp(helper, opts);
  return { xp, level: levelForXp(xp) };
}

/** Shop-track queue speed-up (issue #83): browsing/decision waits scale by
 *  1 - 0.06×level, floored at 0.7 (30% faster at max level). Exactly zero
 *  effect unless a helper exists AND is on shop duty today — this is the
 *  ONE function the behavior machine calls; it never inspects
 *  `GameState.helper` itself. */
export function browseSpeedFactor(s: GameState): number {
  const h = s.helper;
  if (!h || h.assignment !== "shop") return 1;
  return Math.max(0.7, 1 - 0.06 * h.level);
}

/** Adventure-track combat contribution (issue #83): a flat power add, only
 *  while today's assignment is "adventure". Threaded into Combat.ts's
 *  party power/diversity math via generateAdventureScript's `helper` opt —
 *  the helper is never added to `party`/`partyIds`, so it can't be
 *  targeted or die by construction (spec V2.7: "never dies"). Takes just
 *  `{ level }` (not the full Helper) so Combat.ts's opts stay minimal and
 *  don't need to import the whole entity shape. */
export function helperCombatPower(helper: { level: number }): number {
  return 6 + 3 * helper.level;
}

/** Deterministic pricing recommendation (issue #83, L3+ shop track only):
 *  category-average markup ratio across recent `pricingHistory` entries,
 *  clamped to 1.1-1.6x THIS item's baseValue. A recommendation surface for
 *  the pricing panel — never an Economy.ts §6 input. */
export function suggestPriceFor(history: PriceRecord[], item: Item, recentCount = 20): number {
  const relevant = history.filter((r) => r.itemCategory === item.category).slice(-recentCount);
  const avgRatio =
    relevant.length > 0
      ? relevant.reduce((sum, r) => sum + r.markupRatio, 0) / relevant.length
      : 1.35; // no history yet: midpoint of the clamp range
  const clampedRatio = Math.max(1.1, Math.min(1.6, avgRatio));
  return Math.max(1, Math.round(item.baseValue * clampedRatio));
}

/** Whether `assignment` may be chosen right now — currently unconditional
 *  (see PR body: the "days 1-10" tutorial window gates the PERMANENT track
 *  choice, not which daily job is available). Exists as a seam so a future
 *  phase can add a real gate without touching GameEngine's call site. */
export function canAssign(_helper: Helper, _assignment: HelperAssignment): boolean {
  return true;
}

/** Factory: a freshly created helper (issue #83). Character creation
 *  itself is the UI's job (issue #84); this is the deterministic entity
 *  its picks produce. */
export function createHelper(
  name: string,
  appearance: { skin: number; hair: number },
  trait: HelperTrait,
  day: number,
): Helper {
  return {
    id: crypto.randomUUID(),
    name,
    appearance,
    trait,
    track: "none",
    level: 1,
    xp: 0,
    assignment: "chores",
    assignmentDay: day,
    trackChosenDay: null,
  };
}
