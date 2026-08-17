// Time column (spec V2.3, issue #77): the triptych's right panel. Grows the
// #52 day clock into a full-height vertical strip — same astronomy (phase,
// day progress, sun-vs-moon, shared via game/DayNightCycle.ts and the
// DAY_SKY palette), now read as "where in the day am I" from across the
// room instead of a compact HUD glance.
//
// Read-only, same contract as DayClock: renders engine.state and nothing
// else. Polls at 250ms like every other DOM overlay in App.tsx — no rAF loop
// of its own (that stays engine-side, in App's single tick loop).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { dayProgress, isNightSky } from "../game/DayNightCycle";
import type { GameEngine } from "../game/GameEngine";
import { WEATHER_ICON } from "../rendering/WeatherFX";
import type { DayPhase } from "../types";
import { DAY_SKY, PALETTE, PHASE_BOUNDS } from "../utils/constants";

const PHASES: DayPhase[] = ["dawn", "morning", "afternoon", "evening", "night"];

// One beat per phase the player should recognise without reading anything:
// morning is when the town shops, afternoon opens with the march out the
// gate, night is when the risk goes up. Positioned at each phase's start —
// the exact moment the beat begins, not "sometime during."
const EVENTS: Partial<Record<DayPhase, string>> = {
  morning: "⚔️",
  afternoon: "👢",
  night: "💀",
};

// Marker travel range, as a percent of the column's full height — inset so
// the sun/moon never clips at dawn or midnight (same idea as DayClock's
// EDGE, just read top-to-bottom instead of left-to-right).
const MARKER_TOP_PCT = 6;
const MARKER_RANGE_PCT = 88;

const SKY_GRADIENT = buildSkyGradient();

export function TimeColumn({ engine }: { engine: GameEngine }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const s = engine.state;
  const t = dayProgress(s.timeOfDay);
  const night = isNightSky(s.phase);
  const markerTop = MARKER_TOP_PCT + t * MARKER_RANGE_PCT;

  return (
    <div style={columnStyle} title="Time of day">
      <div style={{ ...gradientLayerStyle, background: SKY_GRADIENT }} />

      {PHASES.map((phase) => {
        const [lo, hi] = PHASE_BOUNDS[phase];
        const mid = (lo + hi) / 2;
        const active = phase === s.phase;
        return (
          <div key={phase} style={{ ...labelStyle, top: `${mid * 100}%` }}>
            <span
              style={{
                color: active ? PALETTE.gold : PALETTE.textLight,
                opacity: active ? 1 : 0.55,
                fontWeight: active ? 700 : 400,
                textShadow:
                  active ?
                    "0 0 6px rgba(230,195,92,0.7), 0 1px 2px rgba(0,0,0,0.7)"
                  : "0 1px 2px rgba(0,0,0,0.7)",
              }}
            >
              {phase}
            </span>
          </div>
        );
      })}

      {(Object.entries(EVENTS) as [DayPhase, string][]).map(([phase, glyph]) => {
        const [lo] = PHASE_BOUNDS[phase];
        return (
          <div key={phase} style={{ ...eventStyle, top: `${lo * 100}%` }}>
            {glyph}
          </div>
        );
      })}

      <div style={{ ...markerStyle, top: `${markerTop}%` }}>{night ? "🌙" : "☀️"}</div>

      {/* Today's weather (spec V2.9, issue #95) — a fixed corner badge
          rather than another band on the phase gradient, since it's a
          once-a-day fact (rolled at rollover, game/Weather.ts) not a
          moment-to-moment one like the phase labels below it. */}
      <div style={weatherBadgeStyle} title={`Weather: ${s.weather}`}>
        {WEATHER_ICON[s.weather]}
      </div>
    </div>
  );
}

/** Blend each phase's DayClock sky tone at its band midpoint so the column
 *  reads as one continuous dawn-to-night gradient rather than hard bands —
 *  the same palette as the HUD's day clock, just read top-to-bottom instead
 *  of left-to-right. */
function buildSkyGradient(): string {
  const stops = PHASES.map((phase) => {
    const [lo, hi] = PHASE_BOUNDS[phase];
    const mid = ((lo + hi) / 2) * 100;
    return `${DAY_SKY[phase]} ${mid}%`;
  });
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

const columnStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  fontFamily: "monospace",
  fontSize: 11,
  textTransform: "capitalize",
};

const gradientLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 0,
};

const labelStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  transform: "translateY(-50%)",
  textAlign: "center",
  zIndex: 1,
  pointerEvents: "none",
};

const eventStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  transform: "translateY(-50%)",
  textAlign: "center",
  fontSize: 14,
  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  zIndex: 1,
  pointerEvents: "none",
};

const markerStyle: CSSProperties = {
  position: "absolute",
  left: "50%",
  transform: "translate(-50%, -50%)",
  fontSize: 18,
  textShadow: "0 0 8px rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.8)",
  zIndex: 2,
  pointerEvents: "none",
};

const weatherBadgeStyle: CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  fontSize: 14,
  lineHeight: 1,
  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
  zIndex: 2,
  pointerEvents: "none",
};
