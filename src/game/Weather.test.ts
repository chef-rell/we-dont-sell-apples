// Weather (spec V2.9, issue #94): rolled once at rollover, stored, then read
// deterministically everywhere else. Pure-function unit tests — no engine
// cycling (Property.ts/Forge.ts's own precedent). No unseeded randomness:
// every test drives `rollWeather` with a fixed stub rng, per CLAUDE.md's
// determinism discipline.

import { describe, expect, it } from "vitest";
import { nextWeatherStreak, rollWeather, weatherThreatMultiplier } from "./Weather";
import type { WeatherKind } from "../types";

/** A stub rng that always returns the same value — the bands are cumulative
 *  in clear/rain/fog/storm order (0.55/0.20/0.15/0.10), so a fixed draw
 *  picks a fixed kind. */
function fixedRng(v: number): () => number {
  return () => v;
}

describe("rollWeather", () => {
  it("draws clear for a roll in the bottom 55% band", () => {
    expect(rollWeather("clear", fixedRng(0.1))).toBe("clear");
    expect(rollWeather("clear", fixedRng(0.549))).toBe("clear");
  });

  it("draws rain for a roll in the next 20% band", () => {
    expect(rollWeather("clear", fixedRng(0.55))).toBe("rain");
    expect(rollWeather("clear", fixedRng(0.74))).toBe("rain");
  });

  it("draws fog for a roll in the next 15% band", () => {
    expect(rollWeather("clear", fixedRng(0.75))).toBe("fog");
    expect(rollWeather("clear", fixedRng(0.89))).toBe("fog");
  });

  it("draws storm for a roll in the top 10% band, when yesterday wasn't storm", () => {
    expect(rollWeather("clear", fixedRng(0.9))).toBe("storm");
    expect(rollWeather("rain", fixedRng(0.999))).toBe("storm");
  });

  it("faucet guard: re-rolls a would-be storm to clear when yesterday WAS storm", () => {
    // Never two consecutive storm days (spec V2.9's hard rule) — even
    // though the draw itself lands in the storm band, the guard forces it
    // to "clear" instead of drawing again.
    expect(rollWeather("storm", fixedRng(0.95))).toBe("clear");
    expect(rollWeather("storm", fixedRng(0.999))).toBe("clear");
  });

  it("a non-storm draw the day after a storm is unaffected by the guard", () => {
    expect(rollWeather("storm", fixedRng(0.1))).toBe("clear");
    expect(rollWeather("storm", fixedRng(0.6))).toBe("rain");
  });
});

describe("nextWeatherStreak", () => {
  it("increments when the kind repeats", () => {
    expect(nextWeatherStreak("rain", "rain", 3)).toBe(4);
  });

  it("resets to 1 the moment the kind changes", () => {
    expect(nextWeatherStreak("fog", "rain", 5)).toBe(1);
  });
});

describe("weatherThreatMultiplier", () => {
  it("rain is ×1.15, fog is ×1.25, clear/storm are a ×1 no-op", () => {
    const expected: Record<WeatherKind, number> = { clear: 1, rain: 1.15, fog: 1.25, storm: 1 };
    for (const [kind, mult] of Object.entries(expected)) {
      expect(weatherThreatMultiplier(kind as WeatherKind)).toBeCloseTo(mult);
    }
  });
});
