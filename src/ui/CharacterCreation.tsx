// One-time character creation modal (spec V2.7, issue #84). Shown once per
// save, before the shopkeeper or helper exist: `GameState.shopkeeperAppearance`
// and `GameState.helper` both start null, and this is the only place either
// gets filled in. Mandatory — App.tsx gates this component's existence on
// `state.helper === null`, so unlike SettingsPanel there is no dismiss path
// other than Confirm (no onClose, no outside-click, no Escape).

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { CHILD_SPRITE_H, drawCharacter } from "../rendering/CharacterRenderer";
import type { GameEngine } from "../game/GameEngine";
import type { HelperTrait } from "../types";
import { PALETTE, PX } from "../utils/constants";

const DEFAULT_HELPER_NAME = "Wren";

const TRAITS: { trait: HelperTrait; label: string; blurb: string }[] = [
  { trait: "curious", label: "Curious", blurb: "a knack for making things" },
  { trait: "brave", label: "Brave", blurb: "wants to see the wilderness" },
  { trait: "charming", label: "Charming", blurb: "could sell water to a river" },
];

const SHOPKEEPER_CANVAS = 80;
const HELPER_CANVAS = 64;

export function CharacterCreation({ engine, onCreated }: { engine: GameEngine; onCreated: () => void }) {
  const [shopkeeperSkin, setShopkeeperSkin] = useState(0);
  const [shopkeeperHair, setShopkeeperHair] = useState(0);

  const [helperName, setHelperName] = useState(DEFAULT_HELPER_NAME);

  // Until the player touches the helper's own swatches, its preview tracks
  // the shopkeeper's live selection ("defaults inherit shopkeeper's" — the
  // more polished reading, so the helper never looks like a stale mismatch
  // while the player is still deciding the shopkeeper's look). The first
  // click on a HELPER swatch flips this and the helper's own state takes
  // over from whatever it was seeded at.
  const [helperTouched, setHelperTouched] = useState(false);
  const [helperSkin, setHelperSkin] = useState(0);
  const [helperHair, setHelperHair] = useState(0);
  const effectiveHelperSkin = helperTouched ? helperSkin : shopkeeperSkin;
  const effectiveHelperHair = helperTouched ? helperHair : shopkeeperHair;

  const [trait, setTrait] = useState<HelperTrait>("curious");

  const shopkeeperCanvasRef = useRef<HTMLCanvasElement>(null);
  const helperCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = shopkeeperCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, SHOPKEEPER_CANVAS, SHOPKEEPER_CANVAS);
    const spriteW = 10 * PX;
    const spriteH = 16 * PX;
    const x = (SHOPKEEPER_CANVAS - spriteW) / 2;
    const y = SHOPKEEPER_CANVAS - spriteH - 4;
    drawCharacter(
      ctx,
      { class: "veteran", appearance: { skin: shopkeeperSkin, hair: shopkeeperHair }, equipment: {} },
      x,
      y,
      0,
      "down",
    );
  }, [shopkeeperSkin, shopkeeperHair]);

  useEffect(() => {
    const ctx = helperCanvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, HELPER_CANVAS, HELPER_CANVAS);
    const spriteW = 10 * PX;
    const x = (HELPER_CANVAS - spriteW) / 2;
    const y = HELPER_CANVAS - CHILD_SPRITE_H - 4;
    drawCharacter(
      ctx,
      { appearance: { skin: effectiveHelperSkin, hair: effectiveHelperHair } },
      x,
      y,
      0,
      "down",
      "child",
    );
  }, [effectiveHelperSkin, effectiveHelperHair]);

  const confirm = () => {
    const trimmedName = helperName.trim() || DEFAULT_HELPER_NAME;
    engine.createCharacters(
      { skin: shopkeeperSkin, hair: shopkeeperHair },
      trimmedName,
      { skin: effectiveHelperSkin, hair: effectiveHelperHair },
      trait,
    );
    onCreated();
  };

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ color: PALETTE.textLight, fontSize: 18 }}>Meet your shop</div>

        <section style={sectionStyle}>
          <div style={labelStyle}>Shopkeeper</div>
          <div style={rowStyle}>
            <canvas
              ref={shopkeeperCanvasRef}
              width={SHOPKEEPER_CANVAS}
              height={SHOPKEEPER_CANVAS}
              style={{ imageRendering: "pixelated", background: "#0e0e1c", flexShrink: 0 }}
            />
            <div style={swatchColumnStyle}>
              <SwatchGrid colors={PALETTE.skins} selected={shopkeeperSkin} onPick={setShopkeeperSkin} />
              <SwatchGrid colors={PALETTE.hair} selected={shopkeeperHair} onPick={setShopkeeperHair} />
            </div>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Helper</div>
          <input
            value={helperName}
            onChange={(e) => setHelperName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={DEFAULT_HELPER_NAME}
            style={inputStyle}
          />
          <div style={rowStyle}>
            <canvas
              ref={helperCanvasRef}
              width={HELPER_CANVAS}
              height={HELPER_CANVAS}
              style={{ imageRendering: "pixelated", background: "#0e0e1c", flexShrink: 0 }}
            />
            <div style={swatchColumnStyle}>
              <SwatchGrid
                colors={PALETTE.skins}
                selected={effectiveHelperSkin}
                onPick={(i) => {
                  setHelperTouched(true);
                  setHelperSkin(i);
                }}
              />
              <SwatchGrid
                colors={PALETTE.hair}
                selected={effectiveHelperHair}
                onPick={(i) => {
                  setHelperTouched(true);
                  setHelperHair(i);
                }}
              />
            </div>
          </div>
        </section>

        <section style={sectionStyle}>
          <div style={labelStyle}>Trait</div>
          <div style={traitRowStyle}>
            {TRAITS.map((t) => (
              <button
                key={t.trait}
                style={{
                  ...traitCard,
                  borderColor: trait === t.trait ? PALETTE.gold : PALETTE.uiBorder,
                }}
                onClick={() => setTrait(t.trait)}
              >
                <div style={{ color: trait === t.trait ? PALETTE.gold : PALETTE.textLight, fontSize: 13 }}>
                  {t.label}
                </div>
                <div style={{ color: PALETTE.textDim, fontSize: 11, lineHeight: 1.4 }}>{t.blurb}</div>
              </button>
            ))}
          </div>
        </section>

        <button style={confirmButton} onClick={confirm}>
          Confirm
        </button>
      </div>
    </div>
  );
}

function SwatchGrid({
  colors,
  selected,
  onPick,
}: {
  colors: readonly string[];
  selected: number;
  onPick: (index: number) => void;
}) {
  return (
    <div style={swatchGridStyle}>
      {colors.map((color, i) => (
        <button
          key={i}
          onClick={() => onPick(i)}
          title={color}
          style={{
            ...swatchStyle,
            background: color,
            borderColor: selected === i ? PALETTE.gold : PALETTE.uiBorder,
            borderWidth: selected === i ? 3 : 2,
          }}
        />
      ))}
    </div>
  );
}

// ---- styles (inline: the app has no CSS module setup) ----

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "rgba(10,10,20,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9,
  fontFamily: "monospace",
};

const cardStyle: CSSProperties = {
  background: PALETTE.uiDark,
  border: `4px solid ${PALETTE.uiBorder}`,
  padding: 20,
  width: 660,
  maxHeight: "90%",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  boxShadow: "0 6px 0 rgba(0,0,0,0.45)",
};

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };

const labelStyle: CSSProperties = { color: PALETTE.gold, fontSize: 12 };

const rowStyle: CSSProperties = { display: "flex", gap: 16, alignItems: "flex-start" };

const swatchColumnStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, flex: 1 };

const swatchGridStyle: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6 };

const swatchStyle: CSSProperties = {
  width: 26,
  height: 26,
  border: `2px solid ${PALETTE.uiBorder}`,
  cursor: "pointer",
  padding: 0,
};

const inputStyle: CSSProperties = {
  background: "#0e0e1c",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  fontSize: 12,
  padding: "4px 6px",
};

const traitRowStyle: CSSProperties = { display: "flex", gap: 8 };

const traitCard: CSSProperties = {
  flex: 1,
  background: "#2a2a44",
  border: `2px solid ${PALETTE.uiBorder}`,
  color: PALETTE.textLight,
  fontFamily: "monospace",
  padding: 10,
  cursor: "pointer",
  textAlign: "left",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const confirmButton: CSSProperties = {
  background: "#2a2a44",
  border: `2px solid ${PALETTE.gold}`,
  color: PALETTE.gold,
  fontFamily: "monospace",
  fontSize: 14,
  padding: "8px 12px",
  cursor: "pointer",
  alignSelf: "flex-end",
};
