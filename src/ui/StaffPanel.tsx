// Hired-staff panel (spec V2.9, issue #91's UI half, issue #92 phase 4c):
// hire/fire per StaffRole. Mirrors HelperPanel's card-list styling.
//
// No engine method exists to remove a hired staffer (checked GameEngine.ts
// and Property.ts — only buildStructure/hireStaff/forgeOrder and their
// canX() gates are exported). CLAUDE.md forbids adding one from a UI
// package, so the Fire button below is permanently disabled with a
// tooltip explaining the gap; see this file's final report for the flag.

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { GameEngine } from "../game/GameEngine";
import {
  STAFF_CUT,
  STAFF_HIRE_DELAY_DAYS,
  STAFF_HIRE_FEE,
  STAFF_HIRE_REP_THRESHOLD,
  staffHireUnlockDay,
} from "../game/Property";
import type { StaffRole } from "../types";
import { PALETTE } from "../utils/constants";

const ROLES: StaffRole[] = ["garden", "lab", "forge", "shop"];

const LABELS: Record<StaffRole, string> = {
  garden: "Garden hand",
  lab: "Lab hand",
  forge: "Forge hand",
  shop: "Shop hand",
};

export function StaffPanel({ engine, onClose }: { engine: GameEngine; onClose: () => void }) {
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
        <div style={{ color: PALETTE.textLight, fontSize: 15 }}>Staff</div>
        <div style={{ color: PALETTE.gold, fontSize: 15 }}>{s.gold}g</div>
      </div>

      <div style={listStyle}>
        {ROLES.map((role) => {
          const staff = s.staff.find((st) => st.role === role);

          if (staff) {
            return (
              <div key={role} style={card}>
                <div style={{ color: PALETTE.textLight, fontSize: 13 }}>
                  {staff.name} — {LABELS[role]}
                </div>
                <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
                  hired day {staff.hiredDay} · {Math.round(staff.cut * 100)}% cut
                </div>
                <div style={footerRow}>
                  <span style={{ color: PALETTE.textDim, fontSize: 11 }}>
                    not wired to the engine yet
                  </span>
                  <button
                    style={{ ...button, color: PALETTE.textDim, cursor: "not-allowed" }}
                    disabled
                    title="Firing staff isn't wired to the engine yet"
                  >
                    Fire
                  </button>
                </div>
              </div>
            );
          }

          const canHire = engine.canHireStaff(role);
          let reason: string | null = null;
          if (!canHire) {
            if (s.gold < STAFF_HIRE_FEE) {
              reason = `${STAFF_HIRE_FEE - s.gold}g short`;
            } else {
              const unlockDay = staffHireUnlockDay(s, role);
              reason =
                unlockDay === null
                  ? `needs reputation ≥${STAFF_HIRE_REP_THRESHOLD}`
                  : `unlocks day ${unlockDay + STAFF_HIRE_DELAY_DAYS} (or reputation ≥${STAFF_HIRE_REP_THRESHOLD})`;
            }
          }

          return (
            <div key={role} style={card}>
              <div style={{ color: PALETTE.textLight, fontSize: 13 }}>{LABELS[role]}</div>
              <div style={{ color: PALETTE.textDim, fontSize: 11 }}>
                {STAFF_HIRE_FEE}g flat + {Math.round(STAFF_CUT * 100)}% of daily sales
              </div>
              <div style={footerRow}>
                <span style={{ color: canHire ? PALETTE.textDim : "#c0392b", fontSize: 11 }}>
                  {canHire ? "ready to hire" : reason}
                </span>
                <button
                  style={{
                    ...button,
                    color: canHire ? PALETTE.gold : PALETTE.textDim,
                    cursor: canHire ? "pointer" : "not-allowed",
                  }}
                  disabled={!canHire}
                  onClick={() => {
                    engine.hireStaff(role);
                    setTick((t) => t + 1);
                  }}
                >
                  Hire
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button style={{ ...button, alignSelf: "flex-end" }} onClick={onClose}>
        Done
      </button>
    </div>
  );
}

// ---- styles (inline, matching HelperPanel) ----

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

const card: CSSProperties = {
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
