// Root component: HUD + the triptych stage (spec V2.3, issue #77). The
// center panel routes town/shop/wilderness/gameover by the same `view`
// state as always; the time column and adventure-strip panels are constant
// chrome around it, not part of that ternary.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { sound } from "./audio/SoundManager";
import { useGameAudio } from "./audio/useGameAudio";
import { GameEngine } from "./game/GameEngine";
import { clearSave } from "./game/GameStatePersistence";
import { ChatPanel } from "./ui/ChatPanel";
import { DayClock } from "./ui/DayClock";
import { NightSummary } from "./ui/NightSummary";
import { OfflineSummary } from "./ui/OfflineSummary";
import { SettingsPanel } from "./ui/SettingsPanel";
import { TimeColumn } from "./ui/TimeColumn";
import { Toasts } from "./ui/Toasts";
import { AdventureStripPanel } from "./views/AdventureStripPanel";
import { GameOverView } from "./views/GameOverView";
import { TownView } from "./views/TownView";
import { ShopView } from "./views/ShopView";
import { WildernessView } from "./views/WildernessView";
import type { GameSpeed, GameView } from "./types";
import { PALETTE, STRIP_H, TIME_COLUMN_W, WORLD_H, WORLD_W } from "./utils/constants";

const SPEEDS: GameSpeed[] = [1, 1.5, 2];

export default function App() {
  const engineRef = useRef<GameEngine | null>(null);
  if (!engineRef.current) engineRef.current = new GameEngine();
  // Bumped on restart to swap in a fresh engine and remount the views with it.
  const [run, setRun] = useState(0);
  const engine = engineRef.current;

  // HUD state mirrors the engine at a low refresh rate (canvas runs its own rAF)
  const [hud, setHud] = useState({ day: 1, phase: "morning", gold: 200, speed: 1 as GameSpeed });
  const [view, setView] = useState<GameView>(engine.state.view);
  useEffect(() => {
    const id = setInterval(() => {
      const s = engine.state;
      setHud({ day: s.day, phase: s.phase, gold: s.gold, speed: s.speed });
      setView(s.view); // stay in sync if the engine changes the view itself
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  // Single tick owner (issue #55): views used to each run their own rAF loop
  // and call engine.tick themselves, which would triple-tick the engine once
  // the v2 triptych shows all three panels at once. This is the only place
  // that calls engine.tick — views keep their own rAF strictly for drawing.
  // The 100ms clamp lives here (not inside tick itself) because OfflineSim
  // and the balance harness call tick directly with large, intentional steps
  // that must not be clamped.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const delta = Math.min(now - last, 100); // clamp tab-switch spikes
      last = now;
      // Mirrors the old per-view behavior: no ticking view was ever mounted
      // once the engine ends the run, so replicate that here rather than
      // relying solely on the engine's own speed===0 guard (the speed
      // controls stay clickable on the game-over screen).
      if (engine.state.view !== "gameover") engine.tick(delta);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  // Start over after a game over: drop the save so the new engine can't resume
  // the run that just ended (§5, §12).
  const restart = () => {
    clearSave();
    engineRef.current = new GameEngine(false);
    setView(engineRef.current.state.view);
    setRun((n) => n + 1);
  };

  // Dev-only handle: the sim is driven by rAF, which browsers suspend in a
  // background tab, so driving time by hand is the only reliable way to test
  // multi-day behaviour. Stripped from production builds.
  if (import.meta.env.DEV) {
    (window as unknown as { engine: GameEngine }).engine = engine;
  }

  useGameAudio(engine);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [muted, setMuted] = useState(sound.isMuted);
  const toggleMute = () => {
    const next = !muted;
    sound.setMuted(next);
    setMuted(next);
  };

  const setSpeed = (speed: GameSpeed) => {
    engine.state.speed = speed;
  };

  // Navigate views; write through to engine state so it survives the next poll.
  const go = (next: GameView) => {
    engine.state.view = next;
    setView(next);
  };

  return (
    <div className="app">
      <header className="hud">
        <div className="hud-gold">
          <span className="coin" /> {hud.gold}g
        </div>
        <div className="hud-time">
          <DayClock engine={engine} />
          <span>
            Day {hud.day} · {hud.phase}
          </span>
        </div>
        <div className="hud-controls">
          <button
            onClick={() => {
              // Player-initiated end of run: confirm, then route through the
              // normal Game Over screen (stats + restart button).
              if (window.confirm("Retire this shop? You'll see your run's stats and can start a new one.")) {
                engine.retireShop();
                setView("gameover");
              }
            }}
            title="Retire this shop and start over"
          >
            🏳
          </button>
          <button onClick={() => setSettingsOpen(true)} title="Settings">
            ⚙
          </button>
          <button
            className={muted ? "" : "active"}
            onClick={toggleMute}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            className={hud.speed === 0 ? "active" : ""}
            onClick={() => setSpeed(hud.speed === 0 ? 1 : 0)}
          >
            {hud.speed === 0 ? "▶" : "⏸"}
          </button>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              className={hud.speed === sp ? "active" : ""}
              onClick={() => setSpeed(sp)}
            >
              {sp}×
            </button>
          ))}
        </div>
      </header>
      {/* The stage is a triptych grid (spec V2.3, issue #77): center — the
          existing 960x640 view canvas, right — the time column, bottom —
          the adventure-strip panel. Locked to the combined aspect ratio so
          the whole thing scales to fit the window as one unit, same as the
          single-panel stage did before. */}
      <main key={run}>
        {/* The center cell is exactly the canvas box — same width AND the
            same 3:2 shape the single-panel stage used to be — so overlays
            (night summary, chat, toasts) keep anchoring to the game rather
            than to the triptych's other two panels or the leftover viewport
            around it (main is a full-height centring flex box). */}
        <div style={stageStyle}>
          <div style={centerCellStyle}>
            {settingsOpen && <SettingsPanel engine={engine} onClose={() => setSettingsOpen(false)} />}
            <OfflineSummary engine={engine} />
            <NightSummary engine={engine} />
            {view !== "gameover" && <Toasts engine={engine} />}
            {view !== "gameover" && <ChatPanel engine={engine} />}
            {view === "gameover" ?
            <GameOverView engine={engine} onRestart={restart} />
            : view === "shop" ?
              <ShopView engine={engine} onLeave={() => go("town")} />
            : view === "wilderness" ?
              <WildernessView engine={engine} onLeave={() => go("town")} />
            : <TownView
                engine={engine}
                onEnterShop={() => go("shop")}
                onEnterWilderness={() => go("wilderness")}
              />
            }
          </div>
          <div style={stripCellStyle}>
            <AdventureStripPanel engine={engine} />
          </div>
          <div style={timeCellStyle}>
            <TimeColumn engine={engine} />
          </div>
        </div>
      </main>
    </div>
  );
}

// ---- Triptych stage geometry (spec V2.3, issue #77) ----
// The stage is a 2x2 CSS grid: center spans row 1, the strip spans row 2
// under center, and the time column spans both rows on the right. GAP is
// both the internal seam width and the outer frame's border width, so the
// whole thing reads as one continuous piece of dark chrome rather than a
// gap the page background shows through.
const STAGE_GAP = 4;
const STAGE_W = WORLD_W + TIME_COLUMN_W + STAGE_GAP * 3; // 2 border edges + 1 seam
const STAGE_H = WORLD_H + STRIP_H + STAGE_GAP * 3;

const stageStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: STAGE_W,
  aspectRatio: `${STAGE_W} / ${STAGE_H}`,
  display: "grid",
  // fr tracks carry the WORLD_W:TIME_COLUMN_W and WORLD_H:STRIP_H ratios
  // through any scale the aspect-ratio lock produces, so center keeps its
  // exact 960x640 shape (and its overlay children's math) at every size.
  gridTemplateColumns: `${WORLD_W}fr ${TIME_COLUMN_W}fr`,
  gridTemplateRows: `${WORLD_H}fr ${STRIP_H}fr`,
  gridTemplateAreas: `"center time" "strip time"`,
  gap: STAGE_GAP,
  border: `${STAGE_GAP}px solid ${PALETTE.uiBorder}`,
  background: PALETTE.uiBorder, // shows through the gap as the seam
};

const centerCellStyle: CSSProperties = {
  gridArea: "center",
  position: "relative",
  overflow: "hidden",
  background: PALETTE.uiDark,
};

const stripCellStyle: CSSProperties = {
  gridArea: "strip",
  overflow: "hidden",
  background: PALETTE.uiDark,
};

const timeCellStyle: CSSProperties = {
  gridArea: "time",
  overflow: "hidden",
  background: PALETTE.uiDark,
};
