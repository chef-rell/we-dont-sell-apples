// Shared weather presentation helpers (spec V2.9/V2.10, issue #95). Both the
// iso town view (src/views/TownView.tsx) and the adventure strip
// (AdventureStripRenderer.ts) read `state.weather` and need the same "how
// does this look right now" answers so the two panels read as one storm
// rather than two independently-drifting ones — same reasoning as
// game/DayNightCycle.ts's `skyTint` being shared by the HUD clock and the
// time column. Weather itself is an engine fact (game/Weather.ts, rolled
// once at rollover, §6-adjacent but not a verdict) — nothing in this module
// is ever read back by game logic; it only decides how a committed kind
// LOOKS moment to moment.

import type { WeatherKind } from "../types";
import { hash2d } from "./PixelRenderer";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.substring(0, 2), 16), parseInt(n.substring(2, 4), 16), parseInt(n.substring(4, 6), 16)];
}

function toHex(c: number): string {
  return Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0");
}

/** Blend two "#rrggbb" colors: t=0 -> a, t=1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const k = clamp01(t);
  return `#${toHex(ar + (br - ar) * k)}${toHex(ag + (bg - ag) * k)}${toHex(ab + (bb - ab) * k)}`;
}

const FOG_WASH = "#c3c9cc";
const RAIN_TINT = "#3c4a5e";
const STORM_TINT = "#101018";

/** Recolor a base sky/scene tone for today's committed weather — the same
 *  formula both panels call so a rainy town and a rainy strip read as the
 *  same rain (spec: "strip tints to match"). */
export function weatherTint(base: string, weather: WeatherKind): string {
  switch (weather) {
    case "rain":
      return mix(base, RAIN_TINT, 0.4);
    case "fog":
      return mix(base, FOG_WASH, 0.5);
    case "storm":
      return mix(base, STORM_TINT, 0.55);
    default:
      return base;
  }
}

/** Extra full-panel darkening alpha for storm days, layered on top of the
 *  tint above (spec: "storm darkening"). 0 for every other weather. */
export function weatherDarkenAlpha(weather: WeatherKind): number {
  return weather === "storm" ? 0.22 : 0;
}

const FLASH_PERIOD_MS = 7000; // one flash roughly every 7s of storm, jittered
const FLASH_DUR_MS = 110;

/**
 * Occasional lightning flash for storm days: 0 (no flash) to 1 (peak
 * brightness this instant). A pure function of `now` rather than shared
 * mutable schedule state — the town view and the strip each run their own
 * independent rAF loop, and both call this every frame with (nearly) the
 * same wall-clock `now`, so a pure hash-jittered schedule keeps them
 * flashing together without either loop racing the other to advance a
 * shared "next flash" timer. Not a §6/determinism concern (CLAUDE.md's
 * determinism-vs-liveliness gotcha only binds verdicts and combat math) —
 * this is exactly as "random" as Math.random() would read to a player,
 * just collision-free across two callers.
 */
export function lightningFlash(weather: WeatherKind, now: number): number {
  if (weather !== "storm") return 0;
  const bucket = Math.floor(now / FLASH_PERIOD_MS);
  const jitter = hash2d(bucket, 41) * (FLASH_PERIOD_MS - FLASH_DUR_MS * 2);
  const local = now - bucket * FLASH_PERIOD_MS;
  if (local < jitter || local >= jitter + FLASH_DUR_MS) return 0;
  return 1 - (local - jitter) / FLASH_DUR_MS;
}

/** Time column readout (spec: "time column gains the weather icon for
 *  today"). */
export const WEATHER_ICON: Record<WeatherKind, string> = {
  clear: "🌤️",
  rain: "🌧️",
  fog: "🌫️",
  storm: "⛈️",
};
