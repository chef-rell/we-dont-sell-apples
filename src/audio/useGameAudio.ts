// Wires game state to sound (spec §9). The engine has no idea audio exists —
// this hook polls the same way the HUD does and plays a cue when something it
// cares about changes. Nothing here can affect the sim.

import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import type { GameView } from "../types";
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
}

function read(engine: GameEngine): AudioWatch {
  const s = engine.state;
  const latest = s.recentOutcomes.at(-1);
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
  };
}

function ambienceFor(view: GameView, phase: string): AmbienceKind {
  if (view === "wilderness") return "wilderness";
  return phase === "night" ? "night" : "town";
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

      const bed = ambienceFor(now.view, now.phase);
      if (now.view !== "gameover") sound.setAmbience(bed);

      prev.current = now;
    }, 250);
    return () => clearInterval(id);
  }, [engine]);

  // Leaving the page shouldn't leave a drone running.
  useEffect(() => () => sound.stopAmbience(), []);
}
