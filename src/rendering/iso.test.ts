// Iso projection module tests (spec V2.4, issue #70). Pure math — no
// rendering/DOM setup needed, same as Economy.test.ts.

import { describe, expect, it } from "vitest";
import { defaultBuildings, worldPointToBuilding } from "../utils/TownBuildings";
import { WORLD_H, WORLD_W } from "../utils/constants";
import { depthKey, isoFacing, project, shade, unproject } from "./iso";

describe("project / unproject", () => {
  it("round-trips exactly for a grid of world points", () => {
    for (let wx = 0; wx <= WORLD_W; wx += 40) {
      for (let wy = 0; wy <= WORLD_H; wy += 40) {
        const { sx, sy } = project(wx, wy);
        const back = unproject(sx, sy);
        expect(back.wx).toBeCloseTo(wx, 9);
        expect(back.wy).toBeCloseTo(wy, 9);
      }
    }
  });

  it("projects the shop door inside the canvas", () => {
    const shop = defaultBuildings().find((b) => b.id === "shop")!;
    const { sx, sy } = project(shop.door!.x, shop.door!.y);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(WORLD_W);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(WORLD_H);
  });

  it("projects the gate door inside the canvas", () => {
    const gate = defaultBuildings().find((b) => b.id === "gate")!;
    const { sx, sy } = project(gate.door!.x, gate.door!.y);
    expect(sx).toBeGreaterThanOrEqual(0);
    expect(sx).toBeLessThanOrEqual(WORLD_W);
    expect(sy).toBeGreaterThanOrEqual(0);
    expect(sy).toBeLessThanOrEqual(WORLD_H);
  });

  it("unprojecting the projected shop footprint center still resolves to the shop", () => {
    const buildings = defaultBuildings();
    const shop = buildings.find((b) => b.id === "shop")!;
    const cx = shop.footprint.x + shop.footprint.w / 2;
    const cy = shop.footprint.y + shop.footprint.h / 2;
    const { sx, sy } = project(cx, cy);
    const { wx, wy } = unproject(sx, sy);
    expect(worldPointToBuilding(buildings, wx, wy)?.id).toBe("shop");
  });

  it("unprojecting the projected gate footprint center still resolves to the gate", () => {
    const buildings = defaultBuildings();
    const gate = buildings.find((b) => b.id === "gate")!;
    const cx = gate.footprint.x + gate.footprint.w / 2;
    const cy = gate.footprint.y + gate.footprint.h / 2;
    const { sx, sy } = project(cx, cy);
    const { wx, wy } = unproject(sx, sy);
    expect(worldPointToBuilding(buildings, wx, wy)?.id).toBe("gate");
  });
});

describe("depthKey", () => {
  it("orders a south-east point after a north-west one (painter's algorithm)", () => {
    const nw = depthKey(80, 60);
    const se = depthKey(700, 500);
    expect(se).toBeGreaterThan(nw);
  });

  it("is just wx + wy", () => {
    expect(depthKey(10, 20)).toBe(30);
    expect(depthKey(0, 0)).toBe(0);
  });
});

describe("isoFacing", () => {
  it("maps the four cardinal world facings to iso diagonals", () => {
    expect(isoFacing("right")).toBe("SE");
    expect(isoFacing("down")).toBe("SW");
    expect(isoFacing("left")).toBe("NW");
    expect(isoFacing("up")).toBe("NE");
  });

  it("passes diagonals through unchanged", () => {
    expect(isoFacing("SE")).toBe("SE");
    expect(isoFacing("SW")).toBe("SW");
    expect(isoFacing("NE")).toBe("NE");
    expect(isoFacing("NW")).toBe("NW");
  });
});

describe("shade", () => {
  it("lightens toward white for positive amounts", () => {
    expect(shade("#808080", 0.5)).toBe("#c0c0c0");
  });

  it("darkens toward black for negative amounts", () => {
    expect(shade("#808080", -0.5)).toBe("#404040");
  });

  it("leaves the color unchanged for amt = 0", () => {
    expect(shade("#3a6b35", 0)).toBe("#3a6b35");
  });

  it("clamps at white/black instead of overflowing", () => {
    expect(shade("#f0f0f0", 2.0)).toBe("#ffffff");
    expect(shade("#101010", -2.0)).toBe("#000000");
  });
});
