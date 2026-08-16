// Game Over (spec §5): gold hit zero with nothing left to sell. The engine
// decides this and pauses the sim; this screen reports the run and offers a
// restart. It reads state only — nothing here can un-end the game.

import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { Adventurer } from "../types";
import { PALETTE, WORLD_H, WORLD_W } from "../utils/constants";

export function GameOverView({
  engine,
  onRestart,
}: {
  engine: GameEngine;
  onRestart: () => void;
}) {
  const s = engine.state;
  const best = bestCustomer(s.adventurers);

  return (
    <div style={screenStyle}>
      <div style={{ color: "#c0392b", fontSize: 40, letterSpacing: 4 }}>SHOP CLOSED</div>
      <div style={{ color: PALETTE.textDim, fontSize: 14, maxWidth: 420, textAlign: "center" }}>
        The coin box is empty and the shelves are bare. Word travels — the
        adventurers will have to outfit themselves somewhere else.
      </div>

      <div style={statsGrid}>
        <Stat label="Days survived" value={s.day} />
        <Stat label="Gold earned" value={`${s.stats.totalGoldEarned}g`} />
        <Stat label="Items sold" value={s.stats.itemsSold} />
        <Stat label="Adventurers served" value={s.stats.adventurersServed} />
        <Stat label="Adventurers lost" value={s.stats.adventurersLost} />
        <Stat label="Best customer" value={best} />
      </div>

      <button style={restartButton} onClick={onRestart}>
        Open a new shop
      </button>
    </div>
  );
}

/** The regular who trusted the shop most — relationship first, then loyalty. */
function bestCustomer(adventurers: Adventurer[]): string {
  const ranked = [...adventurers].sort(
    (a, b) =>
      b.relationships.shopkeeper - a.relationships.shopkeeper || b.loyalty - a.loyalty,
  );
  const top = ranked[0];
  if (!top || top.relationships.shopkeeper <= 0) return "nobody, in the end";
  const bought = Object.keys(top.memory.lastPricePaid).length;
  return bought > 0 ? `${top.name} (${bought} item${bought === 1 ? "" : "s"})` : top.name;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={statCell}>
      <div style={{ color: PALETTE.textDim, fontSize: 11 }}>{label}</div>
      <div style={{ color: PALETTE.gold, fontSize: 20 }}>{value}</div>
    </div>
  );
}

const screenStyle: CSSProperties = {
  width: "100%",
  maxWidth: WORLD_W,
  minHeight: WORLD_H,
  margin: "0 auto",
  background: "#14121a",
  border: `4px solid ${PALETTE.uiBorder}`,
  fontFamily: "monospace",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 24,
  padding: 32,
};

const statsGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(140px, 1fr))",
  gap: 12,
  width: "100%",
  maxWidth: 560,
};

const statCell: CSSProperties = {
  background: PALETTE.uiDark,
  border: `2px solid ${PALETTE.uiBorder}`,
  padding: "10px 12px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const restartButton: CSSProperties = {
  background: PALETTE.uiDark,
  border: `2px solid ${PALETTE.gold}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 16,
  padding: "10px 20px",
  cursor: "pointer",
};
