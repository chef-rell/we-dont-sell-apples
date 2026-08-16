// Buy-from-adventurer UI (spec §3b, §8). Adventurers back from the wilderness
// queue up at the counter offering loot at their own ask price; the player buys
// it into the stockroom to price and resell, or passes.
//
// The ask price is all the player gets to go on — no baseValue is shown, so
// judging a haul stays the same learned skill as pricing (§6). Accepting or
// declining goes through the engine, which handles gold, inventory and the
// seller's memory of how they were treated (§14).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import { drawItemWithRarity, ICON_CELL, rarityNameColor } from "../rendering/ItemRenderer";
import type { LootOffer } from "../types";
import { PALETTE, PX } from "../utils/constants";

const ICON_PX = ICON_CELL * PX;

export function LootOfferPanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
  // Offers come and go with the sim (they expire at nightfall), so read them
  // from the engine on a poll rather than mirroring them into React state.
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
  const offers = s.lootOffers;

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div>
          <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Selling to you</div>
          <div style={{ color: PALETTE.textDim, fontSize: 11 }}>offers expire at nightfall</div>
        </div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      <div style={listStyle}>
        {offers.length === 0 ?
          <div style={{ color: PALETTE.textDim, fontSize: 12, padding: "8px 2px" }}>
            Nobody's selling right now.
          </div>
        : offers.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              gold={s.gold}
              onAccept={() => {
                engine.acceptLootOffer(offer.id);
                setTick((t) => t + 1);
              }}
              onDecline={() => {
                engine.declineLootOffer(offer.id);
                setTick((t) => t + 1);
              }}
            />
          ))
        }
      </div>

      <div style={footerRow}>
        <span style={{ color: PALETTE.textDim, fontSize: 11 }}>bought loot lands in the stockroom</span>
        <button style={{ ...smallButton, color: PALETTE.gold }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

function OfferRow({
  offer,
  gold,
  onAccept,
  onDecline,
}: {
  offer: LootOffer;
  gold: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const affordable = gold >= offer.askPrice;
  return (
    <div style={rowStyle}>
      <ItemIcon offer={offer} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: rarityNameColor(offer.item, PALETTE.textLight), fontSize: 13 }}>
          {offer.item.name}
        </div>
        <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
          {offer.adventurerName} asks {offer.askPrice}g
        </div>
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          style={{
            ...smallButton,
            color: affordable ? PALETTE.gold : PALETTE.textDim,
            cursor: affordable ? "pointer" : "not-allowed",
          }}
          disabled={!affordable}
          title={affordable ? "Buy this loot" : "Not enough gold"}
          onClick={onAccept}
        >
          Buy
        </button>
        <button style={smallButton} title="Turn the offer down" onClick={onDecline}>
          Pass
        </button>
      </div>
    </div>
  );
}

function ItemIcon({ offer }: { offer: LootOffer }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    drawItemWithRarity(ctx, offer.item, 0, 0);
  }, [offer]);
  return <canvas ref={ref} width={ICON_PX} height={ICON_PX} style={{ imageRendering: "pixelated" }} />;
}

// ---- styles (inline, matching PricingPanel / WholesalePanel) ----

const panelStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 12,
  width: 320,
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
