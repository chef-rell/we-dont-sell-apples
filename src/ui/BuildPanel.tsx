// Craft-track build chip + panel (spec V2.9, issue #91's UI half, issue
// #92 phase 4c). Mirrors HelperChip/HelperPanel's split-in-one-file
// pattern: a HUD chip that only appears once something is buildable, and a
// panel listing the three craft structures in unlock order.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ITEM_DEFS } from "../entities/Item";
import type { GameEngine } from "../game/GameEngine";
import { CRAFT_BUILD_COST, CRAFT_STAGE_LEVEL, type CraftBuildingKind } from "../game/Property";
import type { Item } from "../types";
import { getBuilding } from "../utils/TownBuildings";
import { PALETTE } from "../utils/constants";

const KINDS: CraftBuildingKind[] = ["garden", "alchemy_lab", "forge"];

const LABELS: Record<CraftBuildingKind, string> = {
  garden: "Garden",
  alchemy_lab: "Alchemy Lab",
  forge: "Forge",
};

/** Mirrors Property.ts's private `countMaterial` — that helper isn't
 *  exported, so the panel keeps its own copy (matching CLAUDE.md's "read
 *  helpers directly, never mutating functions" guidance for this file). */
function countMaterial(items: Item[], defKey: string): number {
  const name = ITEM_DEFS[defKey].name;
  return items.filter((it) => it.name === name).length;
}

/** Compact HUD button — mirrors `HelperChip`'s look and polling. Renders
 *  nothing unless at least one craft structure is currently buildable. */
export function BuildChip({ engine, onOpen }: { engine: GameEngine; onOpen: () => void }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const anyBuildable = KINDS.some((kind) => engine.canBuildStructure(kind));
  if (!anyBuildable) return null;

  return (
    <button style={chipStyle} onClick={onOpen} title="Build">
      🔨 Build
    </button>
  );
}

export function BuildPanel({
  engine,
  onClose,
  onOpenStaff,
}: {
  engine: GameEngine;
  onClose: () => void;
  onOpenStaff?: () => void;
}) {
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

  return (
    <div style={panelStyle} onPointerDown={(e) => e.stopPropagation()}>
      <div style={headerRow}>
        <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Build</div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      <div style={listStyle}>
        {KINDS.map((kind) => {
          const built = getBuilding(s.buildings, kind);
          const cost = CRAFT_BUILD_COST[kind];

          if (built) {
            return (
              <div key={kind} style={rowStyle}>
                <div style={{ color: PALETTE.textLight, fontSize: 13 }}>{LABELS[kind]}</div>
                <div style={{ color: PALETTE.gold, fontSize: 12 }}>built ✓</div>
              </div>
            );
          }

          const canBuild = engine.canBuildStructure(kind);
          let reason: string | null = null;
          if (!canBuild) {
            if (!s.helper || s.helper.track !== "craft") {
              reason = "helper isn't on the craft track";
            } else if (s.helper.level < CRAFT_STAGE_LEVEL[kind]) {
              reason = `needs helper level ${CRAFT_STAGE_LEVEL[kind]}`;
            } else if (s.gold < cost.gold) {
              reason = `${cost.gold - s.gold}g short`;
            } else {
              const missing = cost.materials.find(([key, n]) => countMaterial(s.inventory, key) < n);
              if (missing) {
                const [key, n] = missing;
                const have = countMaterial(s.inventory, key);
                reason = `needs ${n}× ${ITEM_DEFS[key].name} (have ${have})`;
              }
            }
          }

          const materialsLabel = cost.materials
            .map(([key, n]) => `${n}× ${ITEM_DEFS[key].name}`)
            .join(", ");

          return (
            <div key={kind} style={buildCard}>
              <div style={{ color: PALETTE.textLight, fontSize: 13 }}>{LABELS[kind]}</div>
              <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
                {cost.gold}g{materialsLabel ? ` + ${materialsLabel}` : ""}
              </div>
              <div style={footerRow}>
                <span style={{ color: canBuild ? PALETTE.textDim : "#c0392b", fontSize: 11 }}>
                  {canBuild ? "ready to build" : reason}
                </span>
                <button
                  style={{
                    ...button,
                    color: canBuild ? PALETTE.gold : PALETTE.textDim,
                    cursor: canBuild ? "pointer" : "not-allowed",
                  }}
                  disabled={!canBuild}
                  onClick={() => {
                    engine.buildStructure(kind);
                    setTick((t) => t + 1);
                  }}
                >
                  Build
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={footerRow}>
        {onOpenStaff && (
          <button style={button} onClick={onOpenStaff}>
            Manage Staff
          </button>
        )}
        <button style={{ ...button, marginLeft: "auto" }} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---- styles (inline, matching ShopExpansion/HelperPanel) ----

const chipStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textDim,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 8px",
  cursor: "pointer",
};

const panelStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 12,
  width: 310,
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

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxHeight: 320,
  overflowY: "auto",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  background: "#22223c",
  padding: "6px 8px",
};

const buildCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  background: "#22223c",
  padding: "6px 8px",
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
