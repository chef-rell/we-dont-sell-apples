// Monster sprites (spec §8, §10). Procedural chunky pixel art on the 4px grid,
// one design per entry in Dev A's MONSTERS table, keyed by name so adding a
// monster there can't break rendering — unknown names fall back to a blob.
//
// Each design draws inside a 12×12 grid cell (48×48 world px) with its feet on
// the bottom edge, so the Wilderness View can place them on a ground line.

import { PX } from "../utils/constants";
import { px } from "./PixelRenderer";

export const MONSTER_CELL = 12; // grid units

const C = {
  // Bark tones, not leaf tones: the Lurker has to read against grass.
  lurkerBody: "#6a5a30",
  lurkerDark: "#46381e",
  goblinSkin: "#7a9a4a",
  goblinDark: "#5c7635",
  goblinCloth: "#8a5a34",
  batBody: "#4a3a5a",
  batDark: "#332841",
  golem: "#7a7a86",
  golemDark: "#5a5a66",
  golemCore: "#c85a3a",
  eye: "#e8d44a",
  eyeAngry: "#e05a3a",
  fang: "#f0e6d3",
  shadow: "#2c1f18",
} as const;

type MonsterFn = (ctx: CanvasRenderingContext2D, gx: number, gy: number) => void;

/** Forest Lurker: a hunched, mossy ambusher with too many eyes. */
const forestLurker: MonsterFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 4, 8, 6, C.lurkerBody); // bulk
  px(ctx, gx + 1, gy + 6, 1, 3, C.lurkerDark); // arms
  px(ctx, gx + 10, gy + 6, 1, 3, C.lurkerDark);
  px(ctx, gx + 3, gy + 2, 6, 3, C.lurkerDark); // hunched head
  px(ctx, gx + 4, gy + 3, 1, 1, C.eye);
  px(ctx, gx + 7, gy + 3, 1, 1, C.eye);
  px(ctx, gx + 3, gy + 10, 2, 2, C.lurkerDark); // feet
  px(ctx, gx + 7, gy + 10, 2, 2, C.lurkerDark);
};

/** Goblin Scavenger: small, quick, armed with something stolen. */
const goblinScavenger: MonsterFn = (ctx, gx, gy) => {
  px(ctx, gx + 3, gy + 5, 6, 5, C.goblinCloth); // tunic
  px(ctx, gx + 3, gy + 2, 6, 4, C.goblinSkin); // head
  px(ctx, gx + 1, gy + 3, 2, 2, C.goblinSkin); // ears
  px(ctx, gx + 9, gy + 3, 2, 2, C.goblinSkin);
  px(ctx, gx + 4, gy + 4, 1, 1, C.eyeAngry);
  px(ctx, gx + 7, gy + 4, 1, 1, C.eyeAngry);
  px(ctx, gx + 5, gy + 6, 2, 1, C.fang); // grin
  px(ctx, gx + 10, gy + 4, 1, 6, C.goblinDark); // stolen blade
  px(ctx, gx + 3, gy + 10, 2, 2, C.goblinDark); // feet
  px(ctx, gx + 7, gy + 10, 2, 2, C.goblinDark);
};

/** Cave Bat Swarm: three bats orbiting the same patch of dark. */
const caveBatSwarm: MonsterFn = (ctx, gx, gy) => {
  const bat = (bx: number, by: number) => {
    px(ctx, bx + 1, by + 1, 2, 2, C.batBody); // body
    px(ctx, bx, by, 1, 2, C.batDark); // wings
    px(ctx, bx + 3, by, 1, 2, C.batDark);
    px(ctx, bx + 1, by + 1, 1, 1, C.eye);
  };
  bat(gx + 1, gy + 2);
  bat(gx + 6, gy);
  bat(gx + 4, gy + 6);
  px(ctx, gx + 2, gy + 11, 8, 1, C.batDark); // the swarm's shadow
};

/** Stone Golem: slab-bodied, cracked, with a glowing core. */
const stoneGolem: MonsterFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 3, 8, 7, C.golem); // torso
  px(ctx, gx + 3, gy, 6, 3, C.golemDark); // head
  px(ctx, gx + 4, gy + 1, 1, 1, C.eye);
  px(ctx, gx + 7, gy + 1, 1, 1, C.eye);
  px(ctx, gx, gy + 4, 2, 5, C.golemDark); // arms
  px(ctx, gx + 10, gy + 4, 2, 5, C.golemDark);
  px(ctx, gx + 5, gy + 5, 2, 2, C.golemCore); // core
  px(ctx, gx + 3, gy + 10, 2, 2, C.golemDark); // legs
  px(ctx, gx + 7, gy + 10, 2, 2, C.golemDark);
};

/** Anything Dev A adds before it has art: a dark blob with eyes. */
const unknownBeast: MonsterFn = (ctx, gx, gy) => {
  px(ctx, gx + 2, gy + 4, 8, 6, C.shadow);
  px(ctx, gx + 3, gy + 3, 6, 2, C.shadow);
  px(ctx, gx + 4, gy + 5, 1, 1, C.eye);
  px(ctx, gx + 7, gy + 5, 1, 1, C.eye);
};

const MONSTER_ART: Record<string, MonsterFn> = {
  "Forest Lurker": forestLurker,
  "Goblin Scavenger": goblinScavenger,
  "Cave Bat Swarm": caveBatSwarm,
  "Stone Golem": stoneGolem,
};

/** Draw a monster by name with its feet at world pixel (x, y + cell height). */
export function drawMonster(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
): void {
  const art = MONSTER_ART[name] ?? unknownBeast;
  art(ctx, x / PX, y / PX);
}
