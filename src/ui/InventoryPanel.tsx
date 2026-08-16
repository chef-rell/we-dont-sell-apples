// Stockroom (issue #46). Items live in state.inventory when the shelves were
// full at the moment they arrived — loot bought with full shelves, expansion
// overflow. This panel makes that stock visible and lets the player move it
// onto an empty shelf, where it can be priced and sold.
//
// Written by Dev A on the owner's request while Dev B was unavailable, in the
// established corner-panel style (poll-don't-mirror, Esc closes, engine owns
// all mutations). Dev B: restyle freely.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import { drawItemWithRarity, ICON_CELL, rarityNameColor } from "../rendering/ItemRenderer";
import type { Item } from "../types";
import { PALETTE, PX } from "../utils/constants";
import { useRef } from "react";

const ICON_PX = ICON_CELL * PX;

export function InventoryPanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  // Poll so the list and shelf-space state stay honest while the sim runs.
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
  const shelfSpace = s.shelves.filter((slot) => slot === null).length;

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div>
          <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Stockroom</div>
          <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
            {shelfSpace === 0
              ? "no empty shelves — sell something or expand"
              : `${shelfSpace} empty ${shelfSpace === 1 ? "shelf slot" : "shelf slots"}`}
          </div>
        </div>
        <div style={{ color: PALETTE.textDim, fontSize: 13 }}>{s.inventory.length} items</div>
      </div>

      <div style={listStyle}>
        {s.inventory.length === 0 ? (
          <div style={{ color: PALETTE.textDim, fontSize: 12, padding: "8px 2px" }}>
            The back room is empty — everything you own is out on the shelves.
          </div>
        ) : (
          s.inventory.map((item) => (
            <StockRow
              key={item.id}
              item={item}
              canShelve={shelfSpace > 0}
              onShelve={() => engine.shelveItem(item.id)}
            />
          ))
        )}
      </div>

      <div style={footerRow}>
        <span style={{ color: PALETTE.textDim, fontSize: 11 }}>
          shelved items still need a price — click them on the shelf
        </span>
        <button style={smallButton} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function StockRow({
  item,
  canShelve,
  onShelve,
}: {
  item: Item;
  canShelve: boolean;
  onShelve: () => void;
}) {
  return (
    <div style={rowStyle}>
      <RowIcon item={item} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: rarityNameColor(item, PALETTE.textLight), fontSize: 13 }}>
          {item.name}
        </div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
          {item.category} · quality {item.quality}/10
        </div>
      </div>
      <button
        style={{ ...smallButton, ...(canShelve ? {} : disabledButton) }}
        disabled={!canShelve}
        title={canShelve ? "Move onto an empty shelf" : "No empty shelf slots"}
        onClick={onShelve}
      >
        Shelve
      </button>
    </div>
  );
}

function RowIcon({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    drawItemWithRarity(ctx, item, 0, 0);
  }, [item]);
  return <canvas ref={ref} width={ICON_PX} height={ICON_PX} style={{ imageRendering: "pixelated" }} />;
}

// ---- styles (match the other corner panels) ----

const panelStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 12,
  width: 300,
  fontFamily: "monospace",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: 260,
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const footerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const smallButton: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 10px",
  cursor: "pointer",
};

const disabledButton: CSSProperties = {
  opacity: 0.45,
  cursor: "default",
};
