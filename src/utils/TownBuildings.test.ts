// Building registry + hit-testing (spec V2.8, issue #56): the shop and gate
// click regions and coordinates must match what the old hand-written bbox
// tests in TownView.tsx used to check, since the registry replaces them.

import { describe, expect, it } from "vitest";
import { defaultBuildings, getBuilding, worldPointToBuilding } from "./TownBuildings";
import { CRAFT_PLOTS } from "../game/Property";
import type { TownBuilding } from "../types";

describe("defaultBuildings", () => {
  it("seeds today's fixed infrastructure by id/kind", () => {
    const buildings = defaultBuildings();
    const ids = buildings.map((b) => b.id).sort();
    expect(ids).toEqual([
      "competitor-east",
      "competitor-north",
      "gate",
      "graveyard",
      "house-0",
      "house-1",
      "house-2",
      "shop",
      "square",
      "tavern",
    ]);
    expect(buildings.filter((b) => b.kind === "house")).toHaveLength(3);
    expect(buildings.filter((b) => b.kind === "competitor_store")).toHaveLength(2);
  });

  it("marks only the shop and gate clickable", () => {
    const buildings = defaultBuildings();
    const clickable = buildings.filter((b) => b.clickable).map((b) => b.id).sort();
    expect(clickable).toEqual(["gate", "shop"]);
  });

  // spec V2.9/V2.10, issue #94: the two competitor stores + the graveyard
  // must not collide with any existing fixed footprint, CRAFT_PLOTS'
  // player-buildable plots (src/game/Property.ts), or each other.
  describe("v2 Phase 5a additions (issue #94)", () => {
    function overlaps(a: TownBuilding["footprint"], b: TownBuilding["footprint"]): boolean {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    }

    it("graveyard and both competitor stores collide with nothing fixed", () => {
      const buildings = defaultBuildings();
      const newOnes = buildings.filter((b) => ["graveyard", "competitor-north", "competitor-east"].includes(b.id));
      const others = buildings.filter((b) => !newOnes.includes(b));
      for (const n of newOnes) {
        for (const o of others) {
          expect(overlaps(n.footprint, o.footprint), `${n.id} vs ${o.id}`).toBe(false);
        }
      }
    });

    it("graveyard and both competitor stores collide with neither each other nor CRAFT_PLOTS", () => {
      const buildings = defaultBuildings();
      const newOnes = buildings.filter((b) => ["graveyard", "competitor-north", "competitor-east"].includes(b.id));
      for (let i = 0; i < newOnes.length; i++) {
        for (let j = i + 1; j < newOnes.length; j++) {
          expect(overlaps(newOnes[i].footprint, newOnes[j].footprint), `${newOnes[i].id} vs ${newOnes[j].id}`).toBe(false);
        }
      }
      for (const plot of Object.values(CRAFT_PLOTS)) {
        for (const n of newOnes) {
          expect(overlaps(plot.footprint, n.footprint), n.id).toBe(false);
        }
      }
    });

    it("graveyard sits east of every house and south of the gate-to-square path", () => {
      const buildings = defaultBuildings();
      const grave = buildings.find((b) => b.id === "graveyard")!;
      const houses = buildings.filter((b) => b.kind === "house");
      for (const h of houses) expect(grave.footprint.x).toBeGreaterThan(h.footprint.x);
      const gateDoor = buildings.find((b) => b.id === "gate")!.door!;
      const squareOrigin = buildings.find((b) => b.id === "square")!.footprint;
      const pathY = Math.max(gateDoor.y, squareOrigin.y);
      expect(grave.footprint.y).toBeGreaterThan(pathY);
    });
  });
});

describe("getBuilding", () => {
  it("finds a building by id, or undefined for an unknown id", () => {
    const buildings = defaultBuildings();
    expect(getBuilding(buildings, "shop")?.kind).toBe("shop");
    expect(getBuilding(buildings, "nope")).toBeUndefined();
  });
});

describe("worldPointToBuilding", () => {
  it("resolves the shop at its known clickable coordinates", () => {
    const buildings = defaultBuildings();
    // Inside the old TownView bbox test: shop.x-20..shop.x+96, shop.y-24..shop.y+64
    // (shop anchor 120,140) — a point comfortably inside that region.
    const hit = worldPointToBuilding(buildings, 150, 170);
    expect(hit?.id).toBe("shop");
  });

  it("resolves the gate at its known clickable coordinates", () => {
    const buildings = defaultBuildings();
    // Inside the old TownView bbox test: gate.x-24.., gate.y-40..gate.y+140
    // (gate anchor 880,300) — a point comfortably inside that region.
    const hit = worldPointToBuilding(buildings, 900, 330);
    expect(hit?.id).toBe("gate");
  });

  it("returns null outside any clickable footprint", () => {
    const buildings = defaultBuildings();
    expect(worldPointToBuilding(buildings, 0, 0)).toBeNull();
    expect(worldPointToBuilding(buildings, 440, 280)).toBeNull(); // square: not clickable
  });
});
