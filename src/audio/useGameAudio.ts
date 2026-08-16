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
  outcomes: number;
  inShop: number;
  phase: string;
  view: GameView;
  shopLevel: number;
}

function read(engine: GameEngine): AudioWatch {
  const s = engine.state;
  return {
    gold: s.gold,
    itemsSold: s.stats.itemsSold,
    adventurersLost: s.stats.adventurersLost,
    outcomes: s.recentOutcomes.length,
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
    const id = setInterval(() => {
      const now = read(engine);
      const was = prev.current;

      // A sale rings the till; spending (restock, buying loot) gets the same
      // coin — gold moved either way.
      if (now.gold !== was.gold) sound.play("coin");
      if (now.itemsSold > was.itemsSold) sound.play("happy");
      if (now.inShop > was.inShop) sound.play("door");
      if (now.adventurersLost > was.adventurersLost) sound.play("angry");
      else if (now.outcomes > was.outcomes) sound.play("monsterDeath");
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
