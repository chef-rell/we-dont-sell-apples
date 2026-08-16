// "While You Were Away" (spec §13). The engine simulates the days the player
// missed and leaves the results in `state.offlineSummary`; this reports them
// and clears the field, which is the UI's job per the contract.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { OfflineSummary as Summary } from "../types";
import { PALETTE } from "../utils/constants";

export function OfflineSummary({ engine }: { engine: GameEngine }) {
  const [summary, setSummary] = useState<Summary | null>(engine.state.offlineSummary);

  // It arrives on load, so a short poll is enough to catch it.
  useEffect(() => {
    const id = setInterval(() => setSummary(engine.state.offlineSummary), 250);
    return () => clearInterval(id);
  }, [engine]);

  if (!summary) return null;

  const profit = summary.goldEnd - summary.goldStart;
  const dismiss = () => {
    engine.state.offlineSummary = null; // the contract says the UI clears it
    setSummary(null);
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ color: PALETTE.textLight, fontSize: 20 }}>While you were away</div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
          the shop kept trading for {summary.daysElapsed}{" "}
          {summary.daysElapsed === 1 ? "day" : "days"}
        </div>

        <div style={rowsStyle}>
          <Row
            label="Purse"
            value={`${summary.goldStart}g → ${summary.goldEnd}g`}
            tone={profit >= 0 ? "good" : "bad"}
          />
          <Row label="Items sold" value={summary.itemsSold} tone={summary.itemsSold > 0 ? "good" : "flat"} />
          <Row label="Loot bought in" value={summary.lootBought} tone="flat" />
          {summary.adventurersArrived.length > 0 && (
            <Row label="New in town" value={summary.adventurersArrived.join(", ")} tone="flat" />
          )}
          {summary.adventurersLost.length > 0 && (
            <Row label="Didn't come back" value={summary.adventurersLost.join(", ")} tone="bad" />
          )}
        </div>

        {summary.notableEvents.length > 0 && (
          <div style={eventsStyle}>
            {summary.notableEvents.slice(-5).map((line, i) => (
              <div key={i} style={{ color: PALETTE.textDim, fontSize: 11 }}>
                · {line}
              </div>
            ))}
          </div>
        )}

        <button style={buttonStyle} onClick={dismiss}>
          Back to work
        </button>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "good" | "bad" | "flat";
}) {
  const color = tone === "bad" ? "#c0392b" : tone === "good" ? PALETTE.gold : PALETTE.textLight;
  return (
    <div style={rowStyle}>
      <span style={{ color: PALETTE.textDim, fontSize: 12 }}>{label}</span>
      <span style={{ color, fontSize: 14, textAlign: "right" }}>{value}</span>
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
  zIndex: 6, // above the night summary: this is the first thing on return
  fontFamily: "monospace",
};

const cardStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 20,
  width: 420,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const rowsStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 16,
  borderBottom: "2px solid #22223c",
  paddingBottom: 4,
};

const eventsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  maxHeight: 110,
  overflowY: "auto",
};

const buttonStyle: CSSProperties = {
  alignSelf: "flex-end",
  background: "#2a2a44",
  border: `2px solid ${PALETTE.gold}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 14,
  padding: "6px 14px",
  cursor: "pointer",
};
