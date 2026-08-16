// Root component: HUD + view router. Phase 1 ships Town View only;
// Shop/Wilderness views arrive in Phases 2 and 4.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { sound } from "./audio/SoundManager";
import { useGameAudio } from "./audio/useGameAudio";
import { GameEngine } from "./game/GameEngine";
import { clearSave } from "./game/GameStatePersistence";
import { ChatPanel } from "./ui/ChatPanel";
import { NightSummary } from "./ui/NightSummary";
import { OfflineSummary } from "./ui/OfflineSummary";
import { SettingsPanel } from "./ui/SettingsPanel";
import { Toasts } from "./ui/Toasts";
import { GameOverView } from "./views/GameOverView";
import { TownView } from "./views/TownView";
import { ShopView } from "./views/ShopView";
import { WildernessView } from "./views/WildernessView";
import type { GameSpeed, GameView } from "./types";
import { WORLD_H, WORLD_W } from "./utils/constants";

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
          Day {hud.day} · {hud.phase}
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
      {/* The stage is exactly as wide as the canvas, so overlays (night
          summary, chat) sit over the game rather than the whole window. */}
      <main key={run}>
        {/* The stage is exactly the canvas box — same width AND the same 3:2
            shape — so overlays anchor to the game, not to the leftover
            viewport around it (main is a full-height centring flex box). */}
        <div style={stageStyle}>
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
      </main>
    </div>
  );
}

const stageStyle: CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: WORLD_W,
  aspectRatio: `${WORLD_W} / ${WORLD_H}`,
};
