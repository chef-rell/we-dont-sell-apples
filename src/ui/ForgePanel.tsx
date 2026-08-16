// Forge panel (spec V2.9, issue #91's UI half, issue #92 phase 4c): the
// player-triggered craft-order picker plus today's repair log. Mirrors
// WholesalePanel's list-of-rows-with-buttons pattern and its ItemIcon
// canvas helper verbatim.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ITEM_DEFS } from "../entities/Item";
import type { GameEngine } from "../game/GameEngine";
import { craftWorkerFor, FORGE_ORDER_MATERIAL_COUNT, isCraftMaterial } from "../game/Property";
import { drawItemIcon, ICON_CELL } from "../rendering/ItemRenderer";
import { getBuilding } from "../utils/TownBuildings";
import { PALETTE, PX } from "../utils/constants";

const ICON_PX = ICON_CELL * PX;

/** ITEM_DEFS entries the forge can craft: every weapon/armor def, in the
 *  same insertion order as ITEM_DEFS itself. */
const FORGEABLE_KEYS = Object.keys(ITEM_DEFS).filter((key) => {
  const cat = ITEM_DEFS[key].category;
  return cat === "weapon" || cat === "armor";
});

export function ForgePanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
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
  const forge = getBuilding(s.buildings, "forge");

  const repairs = s.messages.filter(
    (m) => m.day === s.day && m.type === "system" && m.content.includes("repaired at the forge"),
  );

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Forge</div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      {!forge ? (
        <div style={{ color: PALETTE.textDim, fontSize: 12 }}>the forge isn&apos;t built yet</div>
      ) : (
        <>
          <div style={sectionLabel}>Craft an order</div>
          <div style={listStyle}>
            {FORGEABLE_KEYS.map((defKey) => (
              <ForgeRow
                key={defKey}
                defKey={defKey}
                engine={engine}
                onForge={() => {
                  engine.forgeOrder(defKey);
                  setTick((t) => t + 1);
                }}
              />
            ))}
          </div>

          <div style={sectionLabel}>Today&apos;s repairs</div>
          {repairs.length === 0 ? (
            <div style={{ color: PALETTE.textDim, fontSize: 11 }}>no repairs yet today</div>
          ) : (
            <div style={eventsStyle}>
              {repairs.map((m) => (
                <div key={m.id} style={{ color: PALETTE.textDim, fontSize: 11 }}>
                  · {m.content}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <button style={{ ...button, alignSelf: "flex-end" }} onClick={onClose}>
        Done
      </button>
    </div>
  );
}

function ForgeRow({
  defKey,
  engine,
  onForge,
}: {
  defKey: string;
  engine: GameEngine;
  onForge: () => void;
}) {
  const s = engine.state;
  const def = ITEM_DEFS[defKey];
  const cost = Math.round(def.baseValue / 2);
  const canForge = engine.canForgeOrder(defKey);

  let reason: string | null = null;
  if (!canForge) {
    const forge = getBuilding(s.buildings, "forge");
    if (forge?.lastProducedDay === s.day) {
      reason = "already forged today";
    } else if (craftWorkerFor(s, "forge") !== "helper") {
      reason = "helper isn't on forge duty today";
    } else if (s.gold < cost) {
      reason = `${cost - s.gold}g short`;
    } else if (s.inventory.filter(isCraftMaterial).length < FORGE_ORDER_MATERIAL_COUNT) {
      reason = `needs ${FORGE_ORDER_MATERIAL_COUNT} materials`;
    } else {
      reason = "not available";
    }
  }

  return (
    <div style={rowStyle}>
      <ItemIcon defKey={defKey} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: PALETTE.textLight, fontSize: 13 }}>{def.name}</div>
        <div style={{ color: canForge ? PALETTE.textDim : "#c0392b", fontSize: 11 }}>
          {canForge ? `${FORGE_ORDER_MATERIAL_COUNT} materials` : reason}
        </div>
      </div>
      <button
        style={{
          ...smallButton,
          color: canForge ? PALETTE.gold : PALETTE.textDim,
          cursor: canForge ? "pointer" : "not-allowed",
        }}
        disabled={!canForge}
        title={canForge ? "Forge" : (reason ?? undefined)}
        onClick={onForge}
      >
        Forge · {cost}g
      </button>
    </div>
  );
}

function ItemIcon({ defKey }: { defKey: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON_PX, ICON_PX);
    const def = ITEM_DEFS[defKey];
    // drawItemIcon only reads icon/category off the item (Pick<Item, "icon"
    // | "category">); the ITEM_DEF itself satisfies that directly — no need
    // for a full Item instance since nothing has been forged yet.
    drawItemIcon(ctx, def, 0, 0);
  }, [defKey]);
  return <canvas ref={ref} width={ICON_PX} height={ICON_PX} style={{ imageRendering: "pixelated" }} />;
}

// ---- styles (inline, matching WholesalePanel/NightSummary) ----

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

const sectionLabel: CSSProperties = { color: PALETTE.gold, fontSize: 12 };

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  maxHeight: 220,
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "#22223c",
  padding: "4px 6px",
};

const eventsStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  maxHeight: 90,
  overflowY: "auto",
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

const button: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};
