// Wires game state to sound (spec §9). The engine has no idea audio exists —
// this hook polls the same way the HUD does and plays a cue when something it
// cares about changes. Nothing here can affect the sim.

import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { AdventureScript, GameView, WeatherKind } from "../types";
import { PHASE_BOUNDS } from "../utils/constants";
import { sound } from "./SoundManager";
import type { AmbienceKind } from "./SFX";

interface AudioWatch {
  gold: number;
  itemsSold: number;
  adventurersLost: number;
  lastOutcome: string | null;
  inShop: number;
  phase: string;
  view: GameView;
  shopLevel: number;
  weather: WeatherKind;
  scriptId: string | null;
  encountersFired: number;
}

/** How many of `script`'s encounter events the strip has already played
 *  back, given the current outbound-leg progress `p` (0..1) — mirrors
 *  AdventureStripRenderer.ts's own `processEvents`/`marchProgress` timing
 *  read (spec V2.5's `t` packing) but computed independently here from
 *  GameState alone, since audio stays fully decoupled from the renderer
 *  (this hook has never imported anything from src/rendering). Read-only;
 *  never mutates the script. */
function encountersReached(script: AdventureScript, p: number): number {
  let n = 0;
  for (const ev of script.events) {
    if (ev.type === "encounter" && ev.t <= p) n += 1;
  }
  return n;
}

function outboundProgress(phase: string, timeOfDay: number): number {
  const [lo, hi] = PHASE_BOUNDS.afternoon;
  if (phase === "afternoon") return Math.max(0, Math.min(1, (timeOfDay - lo) / (hi - lo)));
  if (phase === "evening" || phase === "night") return 1; // outbound leg is long over
  return 0;
}

function read(engine: GameEngine): AudioWatch {
  const s = engine.state;
  const latest = s.recentOutcomes.at(-1);
  const script = s.currentScript;
  return {
    gold: s.gold,
    itemsSold: s.stats.itemsSold,
    adventurersLost: s.stats.adventurersLost,
    // Identify the newest adventure rather than counting them: the engine caps
    // recentOutcomes, so a length comparison goes quiet once it is full.
    lastOutcome: latest ? `${latest.adventurerId}-${latest.day}-${latest.monsterName}` : null,
    inShop: s.adventurers.filter((a) => a.alive && a.state === "browsing").length,
    phase: s.phase,
    view: s.view,
    shopLevel: s.shopLevel,
    weather: s.weather,
    scriptId: script?.id ?? null,
    encountersFired: script ? encountersReached(script, outboundProgress(s.phase, s.timeOfDay)) : 0,
  };
}

// "wilderness" retired from GameView (issue #78 — the adventure strip panel
// plays back the day's script inline, so there's no separate screen to key
// ambience off anymore).
//
// Weather (spec V2.9's audio pass, issue #95) takes priority over phase —
// state.weather is a whole-day fact (game/Weather.ts, rolled once at
// rollover), so a storm or a rainy day sounds like itself all day, not just
// during whichever phase happens to be active. Evening gets its own
// "tavern" bed (the town's one loud room) on clear/fog days; night keeps
// its existing crickets-over-a-drone bed unchanged. SoundManager only ever
// plays one bed at a time (see SFX.ts's note on the new entries) — layering
// e.g. tavern hum UNDER night's crickets was considered and skipped for the
// same reason: a second concurrent voice path is a bigger change than this
// pass's scope.
function ambienceFor(phase: string, weather: WeatherKind): AmbienceKind {
  if (weather === "storm") return "storm";
  if (weather === "rain") return "rain";
  if (phase === "night") return "night";
  if (phase === "evening") return "tavern";
  return "town";
}

export function useGameAudio(engine: GameEngine): void {
  const prev = useRef<AudioWatch>(read(engine));

  // Audio can't start until the player interacts with the page.
  useEffect(() => {
    const wake = () => void sound.start();
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  useEffect(() => {
    // Re-baseline on the engine we're actually watching. Restarting the game
    // swaps in a fresh engine while this hook stays mounted, and comparing the
    // new run against the old one's numbers would fire cues for nothing.
    prev.current = read(engine);

    const id = setInterval(() => {
      const now = read(engine);
      const was = prev.current;

      // A sale rings the till; spending (restock, buying loot) gets the same
      // coin — gold moved either way.
      if (now.gold !== was.gold) sound.play("coin");
      if (now.itemsSold > was.itemsSold) sound.play("happy");
      if (now.inShop > was.inShop) sound.play("door");
      if (now.adventurersLost > was.adventurersLost) sound.play("angry");
      else if (now.lastOutcome !== was.lastOutcome && now.lastOutcome !== null) {
        sound.play("monsterDeath");
      }
      if (now.shopLevel > was.shopLevel) sound.play("levelUp");
      if (now.phase === "night" && was.phase !== "night") sound.play("dayTransition");
      if (now.view === "gameover" && was.view !== "gameover") {
        sound.stopAmbience();
        sound.play("gameOver");
      }
      // Strip encounter accent (spec V2.9's audio pass, issue #95): a new
      // script resets the count to 0 (encountersReached() reads 0 progress
      // the first poll after a fresh scriptId, same "no false rewind"
      // guard the renderer's own primed/firedEvents catch-up gets); only an
      // INCREASE within the same script fires the cue, so loading mid-fight
      // never floods every earlier beat at once.
      if (now.scriptId === was.scriptId && now.encountersFired > was.encountersFired) {
        sound.play("encounter");
      }

      const bed = ambienceFor(now.phase, now.weather);
      if (now.view !== "gameover") sound.setAmbience(bed);

      prev.current = now;
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  // Leaving the page shouldn't leave a drone running.
  useEffect(() => () => sound.stopAmbience(), []);
}
