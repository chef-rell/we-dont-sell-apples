// Helper assignment/progress HUD chip + panel (spec V2.7, issue #83's UI
// half, issue #84). The helper always exists once CharacterCreation.tsx has
// run once per save; both components are defensive about a null helper
// anyway (a parent might mount the chip a tick early).
//
// Own 250ms poll on both components, same convention as DayClock/
// SettingsPanel: staying live without forcing App.tsx to re-render every
// tick.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { LEVEL_THRESHOLDS, MAX_HELPER_LEVEL, traitMatchesTrack } from "../entities/Helper";
import type { GameEngine } from "../game/GameEngine";
import type { HelperAssignment, HelperTrack, HelperTrait } from "../types";
import { PALETTE } from "../utils/constants";

const ASSIGNMENTS: { assignment: HelperAssignment; label: string; blurb: string }[] = [
  {
    assignment: "chores",
    label: "Chores",
    blurb: "Sweeping & errands — small steady growth, no effect on the shop or the road.",
  },
  {
    assignment: "shop",
    label: "Shop",
    blurb: "Helps behind the counter — customers browse and decide faster.",
  },
  {
    assignment: "adventure",
    label: "Adventure",
    blurb: "Tags along with the party — adds fighting strength. Never in danger of dying.",
  },
];

const TRAITS: Record<HelperTrait, { label: string; blurb: string }> = {
  curious: { label: "Curious", blurb: "a knack for making things" },
  brave: { label: "Brave", blurb: "wants to see the wilderness" },
  charming: { label: "Charming", blurb: "could sell water to a river" },
};

const TRACKS: { track: HelperTrack; label: string; locked?: boolean }[] = [
  { track: "shop", label: "Shop" },
  { track: "adventure", label: "Adventure" },
  { track: "craft", label: "Craft", locked: true },
];

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Compact HUD button — mirrors `.hud-controls button` styling. Renders
 *  nothing while no helper exists yet. */
export function HelperChip({ engine, onOpen }: { engine: GameEngine; onOpen: () => void }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const helper = engine.state.helper;
  if (!helper) return null;

  return (
    <button style={chipStyle} onClick={onOpen} title="Helper">
      {helper.name}: {capitalize(helper.assignment)}
    </button>
  );
}

export function HelperPanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = engine.state;
  const helper = s.helper;
  if (!helper) return null;

  // The day's party (and whether the helper tags along) locks in the instant
  // phase crosses into "afternoon" — this game's "noon" (spec V2.7).
  const assignmentsLocked = s.phase !== "dawn" && s.phase !== "morning";

  const level = helper.level;
  const floor = LEVEL_THRESHOLDS[level - 1];
  const nextFloor = level < MAX_HELPER_LEVEL ? LEVEL_THRESHOLDS[level] : undefined;
  const progress = nextFloor !== undefined ? (helper.xp - floor) / (nextFloor - floor) : 1;

  const traitInfo = TRAITS[helper.trait];
  const matchesTrack = traitMatchesTrack(helper.trait, helper.track);

  return (
    <div style={overlayStyle} onPointerDown={onClose}>
      <div style={cardStyle} onPointerDown={(e) => e.stopPropagation()}>
        <div style={headerRow}>
          <span style={{ color: PALETTE.textLight, fontSize: 18 }}>{helper.name}</span>
          <button style={button} onClick={onClose}>
            Close
          </button>
        </div>

        <section style={sectionStyle}>
          <div style={labelStyle}>Today&apos;s job</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {ASSIGNMENTS.map((a) => {
              const active = helper.assignment === a.assignment;
              return (
                <button
                  key={a.assignment}
                  disabled={assignmentsLocked}
                  style={{
                    ...assignmentCard,
                    borderColor: active ? PALETTE.gold : PALETTE.uiBorder,
                    color: active ? PALETTE.gold : PALETTE.textLight,
                    cursor: assignmentsLocked ? "not-allowed" : "pointer",
                    opacity: assignmentsLocked && !active ? 0.5 : 1,
                  }}
                  onClick={() => {
                    if (assignmentsLocked || active) return;
                    engine.setHelperAssignment(a.assignment);
                    setTick((t) => t + 1);
                  }}
                >
                  <div style={{ fontSize: 13 }}>{a.label}</div>
                  <div style={{ color: PALETTE.textDim, fontSize: 11, lineHeight: 1.4 }}>{a.blurb}</div>
                </button>
              );
            })}
          </div>
          {assignmentsLocked && (
            <div style={hintStyle}>today&apos;s party has already formed — this locks in again at dawn.</div>
          )}
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Level &amp; trait</div>
          {nextFloor !== undefined ? (
            <>
              <div style={barOutline}>
                <div style={{ ...barFill, width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
              </div>
              <div style={hintStyle}>
                Level {level} · {helper.xp - floor}/{nextFloor - floor} xp to level {level + 1}
              </div>
            </>
          ) : (
            <div style={hintStyle}>Max level</div>
          )}
          <div style={{ color: PALETTE.textLight, fontSize: 13 }}>
            {traitInfo.label} — <span style={{ color: PALETTE.textDim }}>{traitInfo.blurb}</span>
          </div>
          {matchesTrack && <div style={{ color: PALETTE.gold, fontSize: 11 }}>+50% XP (trait match)</div>}
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Track</div>
          {helper.track !== "none" ? (
            <div style={{ color: PALETTE.textLight, fontSize: 13 }}>
              Committed track: {capitalize(helper.track)}
            </div>
          ) : s.day < 10 ? (
            <div style={hintStyle}>Track choice unlocks on day 10.</div>
          ) : (
            <>
              <div style={{ color: "#c0392b", fontSize: 11 }}>this choice is forever</div>
              <div style={{ display: "flex", gap: 6 }}>
                {TRACKS.map((t) => (
                  <button
                    key={t.track}
                    disabled={t.locked}
                    style={{
                      ...trackCard,
                      opacity: t.locked ? 0.5 : 1,
                      cursor: t.locked ? "not-allowed" : "pointer",
                    }}
                    onClick={() => {
                      if (t.locked) return;
                      engine.chooseTrack(t.track);
                      setTick((tick) => tick + 1);
                    }}
                  >
                    <div style={{ fontSize: 13 }}>{t.label}</div>
                    {t.locked && <div style={{ color: PALETTE.textDim, fontSize: 10 }}>the forge comes later</div>}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- styles (inline: the app has no CSS module setup) ----

const chipStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textDim,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,10,20,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 8,
  fontFamily: "monospace",
};

const cardStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 20,
  width: 460,
  maxHeight: "90%",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

const labelStyle: CSSProperties = { color: PALETTE.gold, fontSize: 12 };

const hintStyle: CSSProperties = { color: PALETTE.textDim, fontSize: 11, lineHeight: 1.5 };

const button: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "5px 10px",
  cursor: "pointer",
};

const assignmentCard: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  fontFamily: "monospace",
  padding: 8,
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const barOutline: CSSProperties = {
  width: "100%",
  height: 10,
  border: `2px solid ${PALETTE.uiBorder}`,
  background: "#0e0e1c",
};

const barFill: CSSProperties = {
  height: "100%",
  background: PALETTE.gold,
};

const trackCard: CSSProperties = {
  flex: 1,
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: 8,
  textAlign: "left",
};
