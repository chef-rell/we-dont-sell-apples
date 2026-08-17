// Weather (spec V2.9, issue #94): rolled ONCE at each day rollover and
// stored on GameState — every downstream reader (Combat.ts's threat calc,
// GameEngine's party formation and merchant behavior) reads the stored
// value only. `rng` defaults to Math.random (liveliness is fine here — once
// the result is stored it's a committed fact, exactly like the party
// script's seed); tests pass a fixed rng or set `state.weather` directly
// per CLAUDE.md's determinism discipline.

import type { WeatherKind } from "../types";
import { WEATHER_THREAT_MULT, WEATHER_WEIGHTS } from "../utils/constants";

/** Cumulative-band order the weights are drawn in; a plain array (not
 *  `Object.entries` on the constants record) so the draw order is explicit
 *  and stable regardless of how `WEATHER_WEIGHTS` is declared. */
const WEATHER_ORDER: WeatherKind[] = ["clear", "rain", "fog", "storm"];

/**
 * Roll today's weather: clear 55% / rain 20% / fog 15% / storm 10%
 * (WEATHER_WEIGHTS). Faucet guard (spec V2.9's hard rule): storm can never
 * follow storm — a would-be second consecutive storm re-rolls to "clear"
 * rather than drawing again, so the distribution stays simple to reason
 * about and the guard is airtight (no chance of a rare double re-roll still
 * landing on storm).
 */
export function rollWeather(previous: WeatherKind, rng: () => number = Math.random): WeatherKind {
  const r = rng();
  let acc = 0;
  let picked: WeatherKind = "clear";
  for (const kind of WEATHER_ORDER) {
    acc += WEATHER_WEIGHTS[kind];
    if (r < acc) {
      picked = kind;
      break;
    }
  }
  if (picked === "storm" && previous === "storm") return "clear";
  return picked;
}

/** Consecutive-day streak at the current weather kind (including today);
 *  resets to 1 the moment the kind changes. Pure — GameEngine.onNewDay()
 *  calls this right alongside rollWeather(). */
export function nextWeatherStreak(next: WeatherKind, previous: WeatherKind, previousStreak: number): number {
  return next === previous ? previousStreak + 1 : 1;
}

/** Threat multiplier read into Combat.ts's generateAdventureScript (issue
 *  #94, scoped exactly like #90's rarity rolls — the v1 resolveAdventure()
 *  fallback path is untouched). Storm never reaches this in practice (no
 *  party forms on a storm day), so it's defined as a no-op 1× rather than
 *  left unhandled. */
export function weatherThreatMultiplier(weather: WeatherKind): number {
  return WEATHER_THREAT_MULT[weather];
}
