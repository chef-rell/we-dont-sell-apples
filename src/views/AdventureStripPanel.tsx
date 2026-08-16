// Bottom adventure-strip panel (spec V2.3, issue #77): the triptych's third
// panel. Placeholder-drawn until #78 lands the real AdventureScript
// playback — own canvas + rAF loop for drawing only, exactly like every
// other view. App.tsx's single tick loop (issue #55) is still the only
// thing that calls engine.tick; this panel only ever reads engine.state.

import { useEffect, useRef } from "react";
import type { GameEngine } from "../game/GameEngine";
import { renderStripPlaceholder } from "../rendering/AdventureStripRenderer";
import { STRIP_H, WORLD_W } from "../utils/constants";

export function AdventureStripPanel({ engine }: { engine: GameEngine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let raf = 0;
    const frame = (now: number) => {
      renderStripPlaceholder(ctx, engine.state, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return (
    <canvas
      ref={canvasRef}
      width={WORLD_W}
      height={STRIP_H}
      style={{ width: "100%", height: "100%", imageRendering: "pixelated", display: "block" }}
    />
  );
}
