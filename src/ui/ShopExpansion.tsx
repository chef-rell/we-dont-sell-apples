// Shop expansion (spec §5): the gold sink that turns a good week into more
// shelf space. The engine owns the money and the shelves — this panel shows
// what the next tier costs and calls `engine.expandShop()`.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import { PALETTE, SHOP_SLOTS_BY_LEVEL } from "../utils/constants";

export function ShopExpansion({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
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
  const cost = engine.nextExpansionCost();
  const slotsNow = s.shelves.length;
  const slotsNext = SHOP_SLOTS_BY_LEVEL[s.shopLevel] ?? slotsNow;
  const affordable = cost !== null && s.gold >= cost;

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div>
          <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Shop, level {s.shopLevel}</div>
          <div style={{ color: PALETTE.textDim, fontSize: 11 }}>{slotsNow} display slots</div>
        </div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      {cost === null ?
        <div style={{ color: PALETTE.textDim, fontSize: 12 }}>
          Biggest shop in the frontier. Nowhere left to build.
        </div>
      : <>
          <div style={{ color: PALETTE.textLight, fontSize: 12, lineHeight: 1.5 }}>
            Knock through to level {s.shopLevel + 1}: <b>{slotsNext} slots</b>, {slotsNext - slotsNow}{" "}
            more than now. Anything waiting in the stockroom moves onto the new shelves.
          </div>
          <div style={footerRow}>
            <span style={{ color: affordable ? PALETTE.textDim : "#c0392b", fontSize: 11 }}>
              {affordable ? "the builders want paying up front" : `${cost - s.gold}g short`}
            </span>
            <button
              style={{
                ...button,
                color: affordable ? PALETTE.gold : PALETTE.textDim,
                cursor: affordable ? "pointer" : "not-allowed",
              }}
              disabled={!affordable}
              onClick={() => engine.expandShop()}
            >
              Expand · {cost}g
            </button>
          </div>
        </>
      }

      <button style={{ ...button, alignSelf: "flex-end" }} onClick={onClose}>
        Done
      </button>
    </div>
  );
}

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
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 8,
};

const footerRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const button: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};
