// Building registry + hit-testing (spec V2.8, issue #56): the shop and gate
// click regions and coordinates must match what the old hand-written bbox
// tests in TownView.tsx used to check, since the registry replaces them.

import { describe, expect, it } from "vitest";
import { defaultBuildings, getBuilding, worldPointToBuilding } from "./TownBuildings";

describe("defaultBuildings", () => {
  it("seeds today's fixed infrastructure by id/kind", () => {
    const buildings = defaultBuildings();
    const ids = buildings.map((b) => b.id).sort();
    expect(ids).toEqual(["gate", "house-0", "house-1", "house-2", "shop", "square", "tavern"]);
    expect(buildings.filter((b) => b.kind === "house")).toHaveLength(3);
  });

  it("marks only the shop and gate clickable", () => {
    const buildings = defaultBuildings();
    const clickable = buildings.filter((b) => b.clickable).map((b) => b.id).sort();
    expect(clickable).toEqual(["gate", "shop"]);
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
