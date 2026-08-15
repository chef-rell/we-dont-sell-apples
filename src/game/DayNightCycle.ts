// Day/night timing (spec §4). Pure functions over timeOfDay ∈ [0, 1).

import type { DayPhase } from "../types";
import { DAY_LENGTH_MS, NIGHT_SPEED_MULT, PHASE_BOUNDS } from "../utils/constants";

export function phaseFor(timeOfDay: number): DayPhase {
  for (const [phase, [lo, hi]] of Object.entries(PHASE_BOUNDS)) {
    if (timeOfDay >= lo && timeOfDay < hi) return phase as DayPhase;
  }
  return "night";
}

/**
 * Advance timeOfDay by a real-time delta at the given speed.
 * Night fast-forwards at 3× (spec §4). Returns new timeOfDay; a value
 * >= 1 means the day rolled over (caller wraps and increments day).
 */
export function advanceTime(timeOfDay: number, deltaMs: number, speed: number): number {
  if (speed === 0) return timeOfDay;
  const nightMult = phaseFor(timeOfDay) === "night" ? NIGHT_SPEED_MULT : 1;
  return timeOfDay + (deltaMs * speed * nightMult) / DAY_LENGTH_MS;
}

/** Sky tint for the current time, used to modulate the town backdrop. */
export function skyTint(timeOfDay: number): { color: string; alpha: number } {
  const phase = phaseFor(timeOfDay);
  switch (phase) {
    case "dawn":
      return { color: "#ff9a5c", alpha: 0.12 };
    case "morning":
      return { color: "#ffffff", alpha: 0 };
    case "afternoon":
      return { color: "#ffe9b0", alpha: 0.06 };
    case "evening":
      return { color: "#5c3a7a", alpha: 0.18 };
    case "night":
      return { color: "#0a0a2e", alpha: 0.45 };
  }
}
