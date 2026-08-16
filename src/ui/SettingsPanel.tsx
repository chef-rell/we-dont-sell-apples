// Settings (spec §7 budget, §13 auto-pilot). Everything here is a control over
// how much the game leans on the API and how much it runs itself — the game is
// fully playable with the API off, so nothing in here is required reading.
//
// The API key lives in the player's own browser via setApiKeyOverride(); it is
// never rendered back, never logged, and never leaves localStorage.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { getApiKey, setApiKeyOverride } from "../entities/AdventurerAI";
import { describeProfile, inferProfile } from "../game/AutoPilot";
import type { GameEngine } from "../game/GameEngine";
import type { AIMode } from "../types";
import { PALETTE } from "../utils/constants";

const MODES: { mode: AIMode; label: string; blurb: string }[] = [
  { mode: "full", label: "Full", blurb: "chatter, plans and narration from the API" },
  { mode: "light", label: "Light", blurb: "API only for the moments that matter" },
  { mode: "off", label: "Off", blurb: "deterministic only — no calls, no cost" },
];

export function SettingsPanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(getApiKey() !== null);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 500);
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
  const budget = s.tokenBudget;
  const profile = describeProfile(inferProfile(s.pricingHistory));

  return (
    <div style={overlayStyle} onPointerDown={onClose}>
      <div style={cardStyle} onPointerDown={(e) => e.stopPropagation()}>
        <div style={headerRow}>
          <span style={{ color: PALETTE.textLight, fontSize: 18 }}>Settings</span>
          <button style={button} onClick={onClose}>
            Close
          </button>
        </div>

        <section style={sectionStyle}>
          <div style={labelStyle}>Adventurer AI</div>
          <div style={{ display: "flex", gap: 6 }}>
            {MODES.map((m) => (
              <button
                key={m.mode}
                style={{
                  ...button,
                  flex: 1,
                  borderColor: s.aiMode === m.mode ? PALETTE.gold : PALETTE.uiBorder,
                  color: s.aiMode === m.mode ? PALETTE.gold : PALETTE.textLight,
                }}
                onClick={() => {
                  s.aiMode = m.mode;
                  setTick((t) => t + 1);
                }}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div style={hintStyle}>{MODES.find((m) => m.mode === s.aiMode)?.blurb}</div>
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>API key</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="password"
              value={keyDraft}
              placeholder={keySaved ? "key saved — type to replace" : "paste a key to enable AI"}
              onChange={(e) => setKeyDraft(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              style={inputStyle}
            />
            <button
              style={button}
              disabled={keyDraft.trim().length === 0}
              onClick={() => {
                setApiKeyOverride(keyDraft.trim());
                setKeyDraft("");
                setKeySaved(true);
              }}
            >
              Save
            </button>
            <button
              style={button}
              onClick={() => {
                setApiKeyOverride(null);
                setKeyDraft("");
                setKeySaved(getApiKey() !== null); // a build-time key may remain
              }}
            >
              Clear
            </button>
          </div>
          <div style={hintStyle}>
            Stored in this browser only. The game is fully playable with no key —
            adventurers fall back to deterministic behaviour.
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Shopkeeper auto-pilot</div>
          <button
            style={{
              ...button,
              borderColor: s.autoPilotEnabled ? PALETTE.gold : PALETTE.uiBorder,
              color: s.autoPilotEnabled ? PALETTE.gold : PALETTE.textLight,
            }}
            onClick={() => {
              s.autoPilotEnabled = !s.autoPilotEnabled;
              setTick((t) => t + 1);
            }}
          >
            {s.autoPilotEnabled ? "On" : "Off"}
          </button>
          <div style={hintStyle}>{profile}</div>
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Token budget today</div>
          <div style={gridStyle}>
            <Stat label="Calls" value={`${budget.callsToday} / ${budget.dailyLimitCalls}`} />
            <Stat
              label="Tokens"
              value={`${budget.tokensToday.toLocaleString()} / ${budget.dailyLimitTokens.toLocaleString()}`}
            />
            <Stat label="Cost today" value={`$${budget.estimatedCostToday.toFixed(4)}`} />
            <Stat label="Cost all time" value={`$${budget.estimatedCostAllTime.toFixed(4)}`} />
          </div>
          {budget.budgetExhausted && (
            <div style={{ ...hintStyle, color: "#c0392b" }}>
              Budget spent for today — everyone is running on the deterministic
              fallback until it resets.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: PALETTE.textDim, fontSize: 10 }}>{label}</div>
      <div style={{ color: PALETTE.textLight, fontSize: 13 }}>{value}</div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,10,20,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 7,
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

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
};

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#0e0e1c",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 6px",
};

const button: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "5px 10px",
  cursor: "pointer",
};
