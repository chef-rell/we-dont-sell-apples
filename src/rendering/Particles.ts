// A very small particle system (spec §15 Phase 5 polish). Chunky squares on
// the 4px grid like everything else — no blending, no sub-pixel drift, just
// bursts that arc and fade so a sale or a hit has some weight to it.
//
// Purely cosmetic: particles never carry state the game reads back.

import { PX } from "../utils/constants";
import { rect } from "./PixelRenderer";

interface Particle {
  x: number;
  y: number;
  vx: number; // world px per second
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  size: number;
  colors: readonly string[]; // stepped through as the particle ages
  gravity: number;
}

export interface BurstOptions {
  count?: number;
  colors?: readonly string[];
  speed?: number;
  spread?: number; // horizontal bias, 1 = even in all directions
  gravity?: number;
  life?: number;
  size?: number;
}

const MAX_PARTICLES = 120; // cosmetic: never worth a frame drop

export class Particles {
  private items: Particle[] = [];

  get count(): number {
    return this.items.length;
  }

  /** Throw a handful of particles out from a point. */
  burst(x: number, y: number, opts: BurstOptions = {}): void {
    const {
      count = 8,
      colors = ["#e6c35c", "#f4dc9a"],
      speed = 90,
      spread = 1,
      gravity = 240,
      life = 0.7,
      size = PX,
    } = opts;

    for (let i = 0; i < count && this.items.length < MAX_PARTICLES; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const power = speed * (0.6 + Math.random() * 0.6);
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * power * spread,
        vy: Math.sin(angle) * power - speed * 0.4, // biased upward
        life,
        maxLife: life,
        size,
        colors,
        gravity,
      });
    }
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    for (const p of this.items) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.items = this.items.filter((p) => p.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.items) {
      // Step through the colors as the particle burns down.
      const t = 1 - p.life / p.maxLife;
      const color = p.colors[Math.min(p.colors.length - 1, Math.floor(t * p.colors.length))];
      rect(ctx, p.x, p.y, p.size, p.size, color);
    }
  }

  clear(): void {
    this.items = [];
  }
}
