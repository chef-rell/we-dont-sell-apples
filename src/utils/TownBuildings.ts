// Town building registry (spec V2.8, issue #56): replaces the frozen TOWN
// literal that used to live in AdventurerBehavior.ts and the two
// hand-written bbox click tests that used to live in TownView.tsx. Numbers
// below are copied verbatim from both of those — nothing has moved.
//
// Two buildings (shop, gate) need more than one point: a movement/render
// anchor AND a separate, deliberately generous click region ("a little
// slack for easy clicking", per the old TownView comment). `door` carries
// the anchor for those two; `footprint` carries the click region. Buildings
// that were never click-tested (tavern, house, square) don't have that
// split — their footprint origin IS their anchor.

import type { TownBuilding } from "../types";
import { WORLD_W } from "./constants";

/** Fixed town infrastructure, coordinate-identical to the old TOWN literal
 *  and the old TownView click bboxes. Called fresh (not shared/mutated) —
 *  see createInitialState() and GameStatePersistence.loadGame(). */
export function defaultBuildings(): TownBuilding[] {
  return [
    {
      id: "shop",
      kind: "shop",
      // Old click test: shop.x-20..shop.x+96, shop.y-24..shop.y+64
      // (shop anchor was x:120,y:140) — carried over exactly.
      footprint: { x: 100, y: 116, w: 116, h: 88 },
      door: { x: 156, y: 200 }, // old TOWN.shopDoor
      clickable: true,
    },
    {
      id: "tavern",
      kind: "tavern",
      footprint: { x: 640, y: 120, w: 64, h: 48 }, // old TOWN.tavern + wall size (16x12 grid units)
      door: { x: 668, y: 172 }, // old TOWN.tavernDoor
      clickable: false,
    },
    {
      id: "house-0",
      kind: "house",
      footprint: { x: 200, y: 420, w: 40, h: 32 }, // old TOWN.houses[0] + wall size
      clickable: false,
    },
    {
      id: "house-1",
      kind: "house",
      footprint: { x: 360, y: 460, w: 40, h: 32 }, // old TOWN.houses[1] + wall size
      clickable: false,
    },
    {
      id: "house-2",
      kind: "house",
      footprint: { x: 560, y: 430, w: 40, h: 32 }, // old TOWN.houses[2] + wall size
      clickable: false,
    },
    {
      id: "gate",
      kind: "gate",
      // Old click test: gate.x-24.. (no upper bound), gate.y-40..gate.y+140
      // (gate anchor was x:880,y:300) — clamped to the world's east edge,
      // which the unbounded test could never click past anyway.
      footprint: { x: 856, y: 260, w: WORLD_W - 856, h: 180 },
      door: { x: 880, y: 300 }, // old TOWN.gate
      clickable: true,
    },
    {
      id: "square",
      kind: "square",
      footprint: { x: 440, y: 280, w: 160, h: 120 }, // old TOWN.square + plaza size
      clickable: false,
    },
  ];
}

/** Lookup by id. Buildings are few (single digits today); a linear scan is
 *  simpler than maintaining an index and cheap enough to call per-tick. */
export function getBuilding(buildings: TownBuilding[], id: string): TownBuilding | undefined {
  return buildings.find((b) => b.id === id);
}

/** First clickable building whose footprint contains (x, y), or null.
 *  Registry order decides precedence on overlap, matching the old
 *  click-handler's if/return order (shop checked before gate). */
export function worldPointToBuilding(
  buildings: TownBuilding[],
  x: number,
  y: number,
): TownBuilding | null {
  for (const b of buildings) {
    if (!b.clickable) continue;
    const { x: bx, y: by, w, h } = b.footprint;
    if (x >= bx && x <= bx + w && y >= by && y <= by + h) return b;
  }
  return null;
}
