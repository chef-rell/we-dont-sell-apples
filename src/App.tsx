// Root component: HUD + view router. Phase 1 ships Town View only;
// Shop/Wilderness views arrive in Phases 2 and 4.

import { useEffect, useRef, useState } from "react";
import { GameEngine } from "./game/GameEngine";
import { clearSave } from "./game/GameStatePersistence";
import { NightSummary } from "./ui/NightSummary";
import { GameOverView } from "./views/GameOverView";
import { TownView } from "./views/TownView";
import { ShopView } from "./views/ShopView";
import { WildernessView } from "./views/WildernessView";
import type { GameSpeed, GameView } from "./types";

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
      <main key={run} style={{ position: "relative" }}>
        <NightSummary engine={engine} />
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
      </main>
    </div>
  );
}
