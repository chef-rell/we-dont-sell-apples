// Wholesale restocking (spec §5, §15 Phase 2). A traveling cart parks outside
// every afternoon selling basics at cost; the player buys stock here and marks
// it up on the shelves. This is the economy's drain — the gold sink that makes
// failure possible — and the thing to do during the afternoon lull (§4).
//
// Prices here are the item's baseValue, which is fine to show: the player is
// paying it. What stays hidden is what adventurers think it's worth (§6).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import { drawItemWithRarity, ICON_CELL, rarityNameColor } from "../rendering/ItemRenderer";
import type { Item } from "../types";
import { PALETTE, PX } from "../utils/constants";

const ICON_PX = ICON_CELL * PX; // 1× — the rows are compact

export function WholesalePanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  // The engine owns the cart and the purse; poll so the list, the gold count
  // and the sold-out state stay honest while the sim keeps running.
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
  const stock = s.merchant?.stock ?? [];
  const shelfSpace = s.shelves.some((slot) => slot === null);

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div>
          <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Traveling Merchant</div>
          <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
            packs up when the afternoon ends
          </div>
        </div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      <div style={listStyle}>
        {stock.length === 0 ?
          <div style={{ color: PALETTE.textDim, fontSize: 12, padding: "8px 2px" }}>
            The cart is picked clean. Come back tomorrow.
          </div>
        : stock.map((item) => (
            <StockRow
              key={item.id}
              item={item}
              gold={s.gold}
              onBuy={() => {
                engine.buyWholesale(item.id);
                setTick((t) => t + 1); // reflect the purchase immediately
              }}
            />
          ))
        }
      </div>

      <div style={footerRow}>
        <span style={{ color: PALETTE.textDim, fontSize: 11 }}>
          {shelfSpace ? "goes to the first empty shelf" : "shelves full — goes to the stockroom"}
        </span>
        <button style={{ ...smallButton, color: PALETTE.gold }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function StockRow({ item, gold, onBuy }: { item: Item; gold: number; onBuy: () => void }) {
  const affordable = gold >= item.baseValue;
  return (
    <div style={rowStyle}>
      <ItemIcon item={item} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: rarityNameColor(item, PALETTE.textLight), fontSize: 13 }}>
          {item.name}
        </div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
          {item.category} · quality {item.quality}/10
        </div>
      </div>
      <button
        style={{
          ...smallButton,
          color: affordable ? PALETTE.gold : PALETTE.textDim,
          cursor: affordable ? "pointer" : "not-allowed",
        }}
        disabled={!affordable}
        title={affordable ? `Buy at cost` : `Not enough gold`}
        onClick={onBuy}
      >
        {item.baseValue}g
      </button>
    </div>
  );
}

function ItemIcon({ item }: { item: Item }) {
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

// ---- styles (inline, matching PricingPanel) ----

const panelStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 12,
  width: 300,
  fontFamily: "monospace",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const headerRow: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
};

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 260,
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "#22223c",
  padding: "4px 6px",
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
  padding: "4px 8px",
  cursor: "pointer",
};
