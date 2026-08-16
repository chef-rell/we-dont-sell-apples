// Offline simulation engine (spec §13). When the game loads and real time has
// passed since the last save, elapsed game-days are simulated by running the
// REAL engine headlessly — same state machine, same economy, no Haiku calls —
// with the auto-pilot pricing shelves and trading loot the way the player
// would. One simulation loop, not a parallel approximation that can drift.

import type { GameEngine } from "./GameEngine";
import type { OfflineSummary } from "../types";
import { inferProfile, autoPriceShelves, type AutoPilotProfile } from "./AutoPilot";

const REAL_MINUTES_PER_DAY = 10; // §4/§13: real minutes ÷ 10 = game days
export const MAX_OFFLINE_DAYS = 30;

/** Auto-pilot earns at 65% of live rate (§13 damping): active play must
 *  always beat leaving the tab closed. Applied to net gold GAIN only. */
const OFFLINE_EARNINGS_FACTOR = 0.65;

const TICK_MS = 1000; // coarse offline ticks; behavior is time-based, not frame-based

export function elapsedOfflineDays(lastSavedAt: number | null, now: number): number {
  if (!lastSavedAt) return 0;
  const minutes = (now - lastSavedAt) / 60_000;
  return Math.min(MAX_OFFLINE_DAYS, Math.floor(minutes / REAL_MINUTES_PER_DAY));
}

/**
 * Simulate `days` game days on the live engine state. AI mode is forced off
 * for the duration (§13: no Haiku for offline days). Returns the summary and
 * stores it on state.offlineSummary for the "While You Were Away" overlay.
 */
export function runOfflineSim(engine: GameEngine, days: number): OfflineSummary {
  const s = engine.state;
  const aiModeBefore = s.aiMode;
  const speedBefore = s.speed;
  s.aiMode = "off";
  s.speed = 2; // fastest sanctioned speed; fewer ticks to simulate

  const goldStart = s.gold;
  const soldStart = s.stats.itemsSold;
  const namesBefore = new Set(s.adventurers.map((a) => a.name));
  const aliveBefore = new Set(s.adventurers.filter((a) => a.alive).map((a) => a.name));
  const notable: string[] = [];
  let lootBought = 0;

  const profile: AutoPilotProfile = inferProfile(s.pricingHistory);
  const targetDay = s.day + days;

  // Guard: at 2× speed a game day is 5 real minutes = 300 ticks of 1s.
  const maxTicks = days * 400 * 2;
  let ticks = 0;
  while (s.day < targetDay && ticks++ < maxTicks && s.view !== "gameover") {
    engine.tick(TICK_MS);

    // Auto-pilot duties, evaluated coarsely each tick:
    autoPriceShelves(s, profile);
    if (s.merchant && s.gold > 150) {
      // Restock conservatively: keep a cash cushion, cheapest first.
      const affordable = [...s.merchant.stock].sort((a, b) => a.baseValue - b.baseValue);
      for (const it of affordable) {
        if (s.gold - it.baseValue < 150) break;
        engine.buyWholesale(it.id);
      }
    }
    for (const offer of [...s.lootOffers]) {
      // Buy loot when the ask is close to fair; pass on gouging.
      if (offer.askPrice <= offer.item.baseValue * 1.15 && s.gold - offer.askPrice > 60) {
        if (engine.acceptLootOffer(offer.id)) lootBought++;
      }
    }
  }

  // Damping: claw back 35% of any net gain (missed sales, worse deals — the
  // shopkeeper isn't as sharp without you around).
  const gain = s.gold - goldStart;
  if (gain > 0) {
    s.gold = goldStart + Math.round(gain * OFFLINE_EARNINGS_FACTOR);
  }

  const lost = [...aliveBefore].filter(
    (name) => !s.adventurers.some((a) => a.name === name && a.alive),
  );
  const arrived = s.adventurers.map((a) => a.name).filter((n) => !namesBefore.has(n));
  if (s.view === "gameover") notable.push("The shop went under while you were away.");
  for (const n of lost) notable.push(`${n} did not come back from the wilderness.`);
  for (const n of arrived) notable.push(`${n} arrived in town.`);

  const summary: OfflineSummary = {
    daysElapsed: days,
    goldStart,
    goldEnd: s.gold,
    itemsSold: s.stats.itemsSold - soldStart,
    lootBought,
    adventurersLost: lost,
    adventurersArrived: arrived,
    notableEvents: notable,
  };

  s.aiMode = aiModeBefore;
  s.speed = s.view === "gameover" ? 0 : speedBefore;
  s.offlineSummary = summary;
  return summary;
}
