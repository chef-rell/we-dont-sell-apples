// Combat resolution (spec §8): step one of the two-step design. A
// deterministic-with-bounded-randomness outcome roll using monster stats vs
// adventurer stats. Produces concrete results the AI narrates (step two) and
// the Wilderness View animates. Neither can alter what's decided here.

import type { Adventurer, AdventureOutcome, AdventureScript, AdventureScriptEvent, WildernessArea } from "../types";
import { MONSTERS, encounterFor, type MonsterDef } from "../entities/Monster";
import { DURABILITY_LOSS_MIN, DURABILITY_LOSS_MAX } from "../utils/constants";
import { helperCombatPower } from "../entities/Helper";

/** Adventurer combat power from level + gear (spec §7 death factors). */
export function combatPower(a: Adventurer): number {
  const weapon = (a.equipment.weapon && a.equipment.weapon.durability !== 0) ? a.equipment.weapon.quality : 0;
  const armor = (a.equipment.armor && a.equipment.armor.durability !== 0) ? a.equipment.armor.quality : 0;
  const accessory = a.equipment.accessory?.quality ?? 0;
  return a.level * 3 + weapon * 2 + armor * 1.5 + accessory * 0.5;
}

/** Where an adventurer chooses to go: risk appetite gates the harder area. */
export function chooseArea(a: Adventurer, day: number): WildernessArea {
  if (day < 3) return "forest_edge"; // cave "accessible after a few days" (§8)
  const bold = a.personality.riskTolerance >= 60 || combatPower(a) >= 14;
  return bold ? "shadow_cave" : "forest_edge";
}

/**
 * Resolve one adventure. Randomness is real but bounded — gear and level
 * dominate, dice decide the margins (spec §7: "some randomness").
 *
 * `rng` is injectable (spec V2.5: v2 generates AdventureScripts with a
 * stored seed so any client replays them identically). Defaults to
 * `Math.random` — zero behavior change on the v1 path.
 */
export function resolveAdventure(
  a: Adventurer,
  day: number,
  opts: { night?: boolean } = {},
  rng: () => number = Math.random,
): AdventureOutcome {
  const area = chooseArea(a, day);
  const seed = a.appearance.skin * 17 + a.appearance.hair * 31 + day * 7;
  const monster: MonsterDef = encounterFor(area, seed);

  const power = combatPower(a);
  // Night monsters are tougher (§13): higher threat, higher death risk —
  // balanced by richer loot and gold below.
  const threat = (monster.hp / 4 + monster.damage) * (opts.night ? 1.5 : 1);

  // Win chance: power vs threat, clamped to [0.15, 0.95] so nothing is a
  // guaranteed win or a hopeless massacre.
  const edge = power / (power + threat);
  const winChance = clamp(edge * 1.3, 0.15, 0.95);
  const won = rng() < winChance;

  // Damage taken scales with how outmatched they were; armor blunts it.
  const armorQ = (a.equipment.armor && a.equipment.armor.durability !== 0) ? a.equipment.armor.quality : 0;
  const baseDamage = won ? monster.damage * (0.6 + rng() * 0.6) : monster.damage * (1.2 + rng() * 0.8);
  const damageTaken = Math.max(1, Math.round(baseDamage - armorQ));

  // Death (spec §7): only possible on a loss, when damage would exceed HP.
  const survived = won || damageTaken < a.hp;

  // Loot: winners roll the table; 60% one drop, 40% two. Night runs always
  // get the second roll — the whole point of going out in the dark.
  const lootItemKeys: string[] = [];
  if (won) {
    lootItemKeys.push(monster.lootTable[seed % monster.lootTable.length]);
    if ((opts.night || rng() < 0.4) && monster.lootTable.length > 1) {
      lootItemKeys.push(monster.lootTable[(seed + 1) % monster.lootTable.length]);
    }
  }

  // Gold: the wilderness is the economy's faucet. Without it the town's
  // money supply is fixed and sales stall once adventurers go broke
  // (found via scripts/balance-report.ts). Scales with monster toughness.
  const goldFound = won
    ? Math.round(monster.hp * (0.5 + rng() * 0.5) * (opts.night ? 1.6 : 1))
    : 0;

  // Gear durability loss — adventuring wears equipment down.
  const brokenItems: string[] = [];
  const durLoss = DURABILITY_LOSS_MIN + Math.floor(rng() * (DURABILITY_LOSS_MAX - DURABILITY_LOSS_MIN + 1));
  for (const slot of ["weapon", "armor"] as const) {
    const gear = a.equipment[slot];
    if (gear && gear.durability !== null && gear.durability > 0) {
      gear.durability = Math.max(0, gear.durability - durLoss);
      if (gear.durability === 0) {
        brokenItems.push(gear.name);
        a.equipment[slot] = undefined;
      }
    }
  }

  return {
    adventurerId: a.id,
    area,
    day,
    monsterName: monster.name,
    monsterDefeated: won,
    damageTaken: Math.min(damageTaken, a.hp),
    survived,
    lootItemKeys,
    goldFound,
    narration: null, // AI narration attaches async; fallback leaves it null
    brokenItems,
  };
}

/** Deterministic loot asking price: base value nudged by haggle skill and
 *  relationship — friendly sellers ask fair, hard hagglers ask high (§7 #3). */
export function fallbackAskPrice(a: Adventurer, baseValue: number): number {
  const haggle = a.personality.haggleSkill / 100; // 0..1
  const relationship = a.relationships.shopkeeper / 100; // -1..1
  const markup = 1 + haggle * 0.4 - relationship * 0.15;
  return Math.max(1, Math.round(baseValue * clamp(markup, 0.85, 1.5)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ============================================================
// AdventureScript generation (spec V2.5/V2.6, issue #76 — v2 combat engine)
// ============================================================
//
// v1's resolveAdventure() above stays as-is: it's still the fallback path
// for a straggler whose plan flips to "adventure" after the day's party
// already formed, and it's the shape memberOutcome synthesis below reuses
// (same win-chance curve, same damage/gold/loot formulas, same death rule —
// "damage taken exceeds current HP on a LOSS"). generateAdventureScript()
// is the new multi-encounter, multi-member version of that same math: a
// party marches through 2-6 escalating encounters in one script, with
// per-member HP, gold and loot tracked across the whole afternoon.
//
// Facts are final the moment this function returns — everything in `events`
// is a presentation timestamp for the wilderness strip (issue #78); nothing
// downstream re-decides anything (spec V2.5).

/** v1's threat formula, reused unchanged so a solo party (size 1) plays
 *  identically to resolveAdventure's math. */
function monsterThreat(m: MonsterDef): number {
  return m.hp / 4 + m.damage;
}

/** Party gravitates toward the boldest member's comfort zone — same
 *  cave-unlocks-after-day-3 gate and bold/cautious split as chooseArea(),
 *  applied across the group instead of one adventurer. */
function choosePartyArea(party: Adventurer[], day: number): WildernessArea {
  if (day < 3) return "forest_edge";
  const bold = party.some((a) => a.personality.riskTolerance >= 60 || combatPower(a) >= 14);
  return bold ? "shadow_cave" : "forest_edge";
}

/** Aggregate party power: sum of member combatPower, boosted by a
 *  diversity bonus — +8% per distinct equipped weapon type (icon key,
 *  e.g. sword/bow/staff/dagger) beyond the first. A mono-weapon party of
 *  six swordsmen gets no bonus; a mixed party does (spec V2.6).
 *
 *  `helperSlot` (spec V2.7, issue #83): the adventure-track helper tagging
 *  along counts as its own distinct "weapon type" for this bonus — a
 *  diversity slot of its own — regardless of what the real members carry.
 *  It is never added to `members`, so it can't be picked as a hit target
 *  by pickRandom() below and can never die (spec: "never dies"). */
function diversityBonus(members: Adventurer[], helperSlot: boolean): number {
  const weaponTypes = new Set<string>();
  for (const m of members) {
    const w = m.equipment.weapon;
    if (w && w.durability !== 0) weaponTypes.add(w.icon);
  }
  if (helperSlot) weaponTypes.add("__helper__");
  return weaponTypes.size > 1 ? 1 + 0.08 * (weaponTypes.size - 1) : 1;
}

/** `helperPower` is the flat adventure-track contribution (6 + 3×level,
 *  spec V2.7) added to the summed member power before the diversity
 *  multiplier applies; 0/false by default so a null-or-unassigned helper
 *  produces byte-identical results to pre-#83 code (no rng draws added
 *  either way — this function never calls rng). */
function partyPower(members: Adventurer[], helperPower = 0, helperSlot = false): number {
  if (members.length === 0 && helperPower === 0) return 0;
  const sum = members.reduce((n, m) => n + combatPower(m), 0) + helperPower;
  return sum * diversityBonus(members, helperSlot);
}

/** count encounters, escalating in difficulty, the last always the hardest
 *  monster available in the area (spec: "last one is the hardest monster
 *  available for the area/day" — the monster roster isn't day-gated today,
 *  so "available for the area" is what varies).
 *
 * Balance guardrail (issue #76): "last is hardest" is an escalation rule
 * for a multi-encounter trip — applying it to a single-encounter (solo)
 * script would mean every solo adventurer always fights the area's hardest
 * monster, instead of v1's varied mostly-common/occasionally-rare mix. That
 * was found, via scripts/balance-report.ts, to be the largest single driver
 * of ending gold running well over pre-party main. Solo trips reuse v1's
 * own encounterFor() so their monster odds are unchanged. */
function encounterLineup(area: WildernessArea, count: number, rng: () => number): MonsterDef[] {
  if (count <= 1) {
    return [encounterFor(area, Math.floor(rng() * 1_000_000))];
  }
  const pool = MONSTERS.filter((m) => m.area === area).sort(
    (a, b) => monsterThreat(a) - monsterThreat(b),
  );
  const hardest = pool[pool.length - 1];
  const lineup: MonsterDef[] = [];
  for (let i = 0; i < count - 1; i++) {
    // Escalating: the pool of allowed picks widens as the trip goes on, so
    // early encounters skew easy and late ones skew hard, with rng noise.
    const prefixLen = Math.max(1, Math.min(pool.length, 1 + Math.round((i / Math.max(1, count - 1)) * (pool.length - 1))));
    lineup.push(pool[Math.floor(rng() * prefixLen)]);
  }
  lineup.push(hardest); // final encounter, forced
  return lineup;
}

/** Sample `n` distinct members from `pool` without replacement, rng-chosen
 *  (spec: "damage distributed to 1-2 rng-chosen members per encounter"). */
function pickRandom<T>(pool: T[], n: number, rng: () => number): T[] {
  const copy = [...pool];
  const picked: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    picked.push(copy[idx]);
    copy.splice(idx, 1);
  }
  return picked;
}

/**
 * Generate a whole party's afternoon in one seeded pass (spec V2.5/V2.6).
 * `opts.seed` is stored on the returned script for exact replay; the caller
 * draws it from Math.random() at generation time (liveliness) and must pass
 * a `rng` built from that same seed via makeRng() — the two travel together
 * so callers that only care about outcomes (not the stored seed value) can
 * pass an ad-hoc rng and let seed default to 0.
 *
 * Mutates party members' equipment durability in place (same as
 * resolveAdventure) — gear that breaks mid-script stops contributing to
 * party power for the remainder of THIS script, so a run that chews through
 * weapons gets visibly harder as it goes.
 *
 * `opts.helper` (spec V2.7, issue #83): present exactly when the
 * adventure-track helper is along today. Undefined (the default) leaves
 * every helper-related code path a no-op and every number identical to
 * pre-#83 behavior — confirmed via `scripts/balance-report.ts`, which never
 * passes this field.
 */
export function generateAdventureScript(
  party: Adventurer[],
  day: number,
  opts: { night?: boolean; seed?: number; helper?: { level: number } } = {},
  rng: () => number = Math.random,
): AdventureScript {
  const night = opts.night ?? false;
  const seed = opts.seed ?? 0;
  const helperAlong = opts.helper != null;
  const helperPower = helperAlong ? helperCombatPower(opts.helper!) : 0;
  const area = choosePartyArea(party, day);
  const size = party.length;
  // Balance guardrail (issue #76): the issue's starting formula —
  // clamp(2 + day/5 + size/2, 2, 6) — gives even a solo party (size 1) a
  // floor of 2 encounters, double v1's exactly-one-fight-per-solo-trip.
  // Since most days only a couple of adventurers actually go out (party
  // sizes cluster at 1-2, per scripts/balance-report.ts's wipe/party
  // scenarios), that floor alone was inflating wilderness gold ~2x over
  // pre-party main. Base 1 + size/2 gives a solo party exactly one
  // encounter (v1 parity) and scales up from there as the party grows;
  // day/8 (vs /5) escalates trip length more slowly across a run.
  const numEncounters = clamp(1 + Math.floor(day / 8) + Math.floor(size / 2), 1, 6);
  const lineup = encounterLineup(area, numEncounters, rng);

  const partyIds = party.map((a) => a.id);
  const events: AdventureScriptEvent[] = [{ t: 0, type: "march", value: size }];

  const aliveIds = new Set(partyIds);
  const hp = new Map(party.map((a) => [a.id, a.hp]));
  const goldById = new Map<string, number>(party.map((a) => [a.id, 0]));
  const lootById = new Map<string, string[]>(party.map((a) => [a.id, []]));
  const brokenById = new Map<string, string[]>(party.map((a) => [a.id, []]));
  const damageById = new Map<string, number>(party.map((a) => [a.id, 0]));
  const lastMonsterById = new Map<string, string>();
  const lastWonById = new Map<string, boolean>();
  let finalWon = false;

  for (let i = 0; i < numEncounters; i++) {
    if (aliveIds.size === 0) break; // full wipe — nobody left to send further in
    const monster = lineup[i];
    const encT = clamp((i + 1) / (numEncounters + 1), 0, 0.97);
    let subT = encT;
    const nextT = () => (subT = Math.min(subT + 0.001, encT + 0.02));

    const aliveMembers = party.filter((a) => aliveIds.has(a.id));
    const power = partyPower(aliveMembers, helperPower, helperAlong);
    // Balance guardrail (issue #76): threat scales 1:1 with a solo party
    // (coefficient exactly 1 at size 1 — identical to v1's unscaled
    // monsterThreat) and steeper than power grows per extra member beyond
    // that, so the diversity bonus + linear power summation of a bigger
    // party doesn't snowball into a materially easier win chance than v1's
    // solo trips (found via scripts/balance-report.ts — the original
    // 0.5 + 0.5×size coefficient undershot threat growth and pushed ending
    // gold ~25-50% over pre-party main at the 1.2× markup band).
    const threat =
      monsterThreat(monster) * (1 + 0.65 * (aliveMembers.length - 1)) * (night ? 1.5 : 1);
    const winChance = clamp((power / (power + threat)) * 1.3, 0.15, 0.95);
    const won = rng() < winChance;
    finalWon = won;
    events.push({ t: encT, type: "encounter", monster: monster.name, value: aliveMembers.length });
    events.push({ t: nextT(), type: "hit", monster: monster.name });

    const targetCount = Math.min(aliveMembers.length, rng() < 0.5 ? 1 : 2);
    const targets = pickRandom(aliveMembers, targetCount, rng);
    for (const target of targets) {
      const armorQ =
        target.equipment.armor && target.equipment.armor.durability !== 0
          ? target.equipment.armor.quality
          : 0;
      const baseDamage = won
        ? monster.damage * (0.6 + rng() * 0.6)
        : monster.damage * (1.2 + rng() * 0.8);
      let dmg = Math.max(1, Math.round(baseDamage - armorQ));
      const curHp = hp.get(target.id)!;

      lastMonsterById.set(target.id, monster.name);
      lastWonById.set(target.id, won);

      if (!won && dmg >= curHp) {
        dmg = curHp; // clamp — matches v1's Math.min(damageTaken, a.hp)
        hp.set(target.id, 0);
        aliveIds.delete(target.id);
        damageById.set(target.id, damageById.get(target.id)! + dmg);
        events.push({ t: nextT(), type: "monsterHit", actorId: target.id, monster: monster.name, value: dmg });
        events.push({ t: nextT(), type: "death", actorId: target.id, monster: monster.name });
        continue;
      }

      hp.set(target.id, Math.max(0, curHp - dmg));
      damageById.set(target.id, damageById.get(target.id)! + dmg);
      events.push({ t: nextT(), type: "monsterHit", actorId: target.id, monster: monster.name, value: dmg });

      // Gear durability loss, same range as v1; a break here reduces this
      // member's combatPower for any later encounter in THIS script.
      const durLoss =
        DURABILITY_LOSS_MIN + Math.floor(rng() * (DURABILITY_LOSS_MAX - DURABILITY_LOSS_MIN + 1));
      for (const slot of ["weapon", "armor"] as const) {
        const gear = target.equipment[slot];
        if (gear && gear.durability !== null && gear.durability > 0) {
          gear.durability = Math.max(0, gear.durability - durLoss);
          if (gear.durability === 0) {
            brokenById.get(target.id)!.push(gear.name);
            target.equipment[slot] = undefined;
            events.push({ t: nextT(), type: "gearBreak", actorId: target.id, itemName: gear.name });
          }
        }
      }
    }

    if (won) {
      const survivors = party.filter((a) => aliveIds.has(a.id));
      const goldTotal = Math.round(monster.hp * (0.5 + rng() * 0.5) * (night ? 1.6 : 1));
      if (survivors.length > 0 && goldTotal > 0) {
        const share = Math.floor(goldTotal / survivors.length);
        let remainder = goldTotal - share * survivors.length;
        for (const s of survivors) {
          let amt = share;
          if (remainder > 0) {
            amt += 1;
            remainder -= 1;
          }
          goldById.set(s.id, goldById.get(s.id)! + amt);
        }
        events.push({ t: nextT(), type: "goldDrop", value: goldTotal });
      }
      // Loot: 60% one drop, 40% two; night runs always get the second roll
      // (v1 parity — "the whole point of going out in the dark").
      const rolls = (night || rng() < 0.4) && monster.lootTable.length > 1 ? 2 : 1;
      for (let r = 0; r < rolls && survivors.length > 0; r++) {
        const itemKey = monster.lootTable[Math.floor(rng() * monster.lootTable.length)];
        const recipient = survivors[Math.floor(rng() * survivors.length)];
        lootById.get(recipient.id)!.push(itemKey);
        events.push({ t: nextT(), type: "lootDrop", actorId: recipient.id, itemName: itemKey });
      }
    }
  }

  const wiped = aliveIds.size === 0;
  events.push({ t: clamp(numEncounters / (numEncounters + 1) + 0.015, 0, 0.99), type: wiped ? "defeat" : "victory" });
  if (!wiped) events.push({ t: 1, type: "returnMarch" });

  // Full-wipe beat (spec V2.7, issue #83): on a total loss, `goldById`/
  // `lootById` still hold whatever each fallen member won in an EARLIER
  // encounter before dying in a later one — memberOutcomes below still
  // reports it against their name (unchanged), but nobody survives to
  // actually carry it home. With the helper along, it isn't lost: these
  // events are the delivery instructions GameEngine reads, once, to credit
  // the PLAYER directly (gold to s.gold, items to the shop) instead.
  // Without a helper this trip, the loot is simply gone — same as v1 ever
  // was for a lone adventurer who didn't come back.
  if (wiped && helperAlong) {
    const carryT = clamp(numEncounters / (numEncounters + 1) + 0.02, 0, 0.995);
    let totalGold = 0;
    for (const id of partyIds) totalGold += goldById.get(id) ?? 0;
    if (totalGold > 0) events.push({ t: carryT, type: "helperCarry", value: totalGold });
    for (const id of partyIds) {
      for (const itemKey of lootById.get(id) ?? []) {
        events.push({ t: carryT, type: "helperCarry", itemName: itemKey });
      }
    }
  }

  const memberOutcomes: AdventureOutcome[] = party.map((a) => ({
    adventurerId: a.id,
    area,
    day,
    monsterName: lastMonsterById.get(a.id) ?? lineup[lineup.length - 1].name,
    monsterDefeated: lastWonById.get(a.id) ?? finalWon,
    damageTaken: Math.min(damageById.get(a.id) ?? 0, a.hp),
    survived: aliveIds.has(a.id),
    lootItemKeys: lootById.get(a.id) ?? [],
    goldFound: goldById.get(a.id) ?? 0,
    narration: null,
    brokenItems: brokenById.get(a.id) ?? [],
  }));

  return {
    id: `script-${day}-${night ? "night" : "day"}-${seed}`,
    day,
    seed,
    night,
    partyIds,
    events,
    memberOutcomes,
    helperAlong,
  };
}
