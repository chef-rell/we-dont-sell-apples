// Night summary overlay (spec §4). Night fast-forwards at 3×, so instead of
// watching an empty town for forty seconds the player gets the day's ledger:
// what they earned, what they sold, who didn't come back.
//
// The engine's stats are cumulative, so the day's numbers are deltas against a
// snapshot taken when the day rolled over. That bookkeeping lives here in the
// UI — the sim doesn't need to know the player is reading a summary.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import { ledgerInsights } from "../game/Ledger";
import type { GameState } from "../types";
import { PALETTE } from "../utils/constants";

interface DaySnapshot {
  day: number;
  gold: number;
  totalGoldEarned: number;
  itemsSold: number;
  adventurersServed: number;
  adventurersLost: number;
}

function snapshot(s: GameState): DaySnapshot {
  return {
    day: s.day,
    gold: s.gold,
    totalGoldEarned: s.stats.totalGoldEarned,
    itemsSold: s.stats.itemsSold,
    adventurersServed: s.stats.adventurersServed,
    adventurersLost: s.stats.adventurersLost,
  };
}

export function NightSummary({ engine }: { engine: GameEngine }) {
  const dayStart = useRef<DaySnapshot>(snapshot(engine.state));
  const [showing, setShowing] = useState(false);
  const [dismissedDay, setDismissedDay] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const s = engine.state;
      // New day: the previous day's baseline is no longer useful.
      if (s.day !== dayStart.current.day) {
        dayStart.current = snapshot(s);
        setDismissedDay(null);
      }
      setShowing(s.phase === "night" && s.view !== "gameover");
      setTick((t) => t + 1);
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  const s = engine.state;
  if (!showing || dismissedDay === s.day) return null;

  const base = dayStart.current;
  const earned = s.stats.totalGoldEarned - base.totalGoldEarned;
  const sold = s.stats.itemsSold - base.itemsSold;
  const served = s.stats.adventurersServed - base.adventurersServed;
  const lost = s.stats.adventurersLost - base.adventurersLost;
  const purse = s.gold - base.gold; // earnings minus restocking and loot buys

  // The day's own notable lines, most recent last, trimmed to fit.
  const events = s.messages.filter((m) => m.day === s.day && m.type === "system").slice(-4);
  const insights = ledgerInsights(s.ledger);

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ color: PALETTE.textLight, fontSize: 20 }}>Day {s.day} · closing up</div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>the town sleeps; night passes quickly</div>

        <div style={rowsStyle}>
          <Row label="Gold taken in" value={`${earned}g`} good={earned > 0} />
          <Row label="Items sold" value={sold} good={sold > 0} />
          <Row label="Adventurers served" value={served} good={served > 0} />
          <Row
            label="Purse, start to end"
            value={`${purse >= 0 ? "+" : ""}${purse}g`}
            good={purse >= 0}
            bad={purse < 0}
          />
          <Row label="Adventurers lost" value={lost} bad={lost > 0} />
        </div>

        <Reactions ledger={s.ledger} />

        {insights.length > 0 && (
          <div style={insightsStyle}>
            {insights.map((line) => (
              <div
                key={line}
                style={{
                  color: line.startsWith("⚠") ? "#e07030" : PALETTE.textLight,
                  fontSize: 12,
                }}
              >
                {line}
              </div>
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div style={eventsStyle}>
            {events.map((m) => (
              <div key={m.id} style={{ color: PALETTE.textDim, fontSize: 11 }}>
                · {m.content}
              </div>
            ))}
          </div>
        )}

        <button style={buttonStyle} onClick={() => setDismissedDay(s.day)}>
          Turn in
        </button>
      </div>
    </div>
  );
}

/** Today's reaction tally — the §17 learning signal, made countable. */
function Reactions({ ledger }: { ledger: GameState["ledger"] }) {
  const r = ledger.reactions;
  const total = r.happy + r.neutral + r.unhappy + r.angry;
  if (total === 0) return null;
  return (
    <div style={reactionsStyle}>
      <span style={{ color: "#5bbf5b" }}>🙂 {r.happy}</span>
      <span style={{ color: "#d9b93a" }}>😐 {r.neutral}</span>
      <span style={{ color: "#d98a3a" }}>🙁 {r.unhappy}</span>
      <span style={{ color: "#c0392b" }}>😠 {r.angry}</span>
      <span style={{ color: PALETTE.textDim, fontSize: 11 }}>reactions today</span>
    </div>
  );
}

function Row({
  label,
  value,
  good,
  bad,
}: {
  label: string;
  value: string | number;
  good?: boolean;
  bad?: boolean;
}) {
  return (
    <div style={rowStyle}>
      <span style={{ color: PALETTE.textDim, fontSize: 12 }}>{label}</span>
      <span
        style={{
          color: bad ? "#c0392b" : good ? PALETTE.gold : PALETTE.textLight,
          fontSize: 15,
        }}
      >
        {value}
      </span>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,10,20,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 5,
  fontFamily: "monospace",
};

const cardStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 20,
  width: 380,
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
  gap: 12,
  borderBottom: `2px solid #22223c`,
  paddingBottom: 4,
};

const reactionsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "baseline",
  fontSize: 14,
};

const insightsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  borderLeft: `4px solid ${PALETTE.uiBorder}`,
  paddingLeft: 8,
};

const eventsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  maxHeight: 90,
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
