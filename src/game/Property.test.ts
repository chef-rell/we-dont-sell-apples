// Craft track: property buildings, production loops, hired staff (spec
// V2.9, issue #91). Pure-function unit tests — no engine cycling, per
// Forge.ts/Helper.ts's own precedent for this kind of module.

import { describe, expect, it } from "vitest";
import {
  CRAFT_BUILD_COST,
  CRAFT_PLOTS,
  CRAFT_STAGE_LEVEL,
  buildCraftStructure,
  canBuildCraftStructure,
  canForgeOrder,
  canHireStaff,
  craftWorkerFor,
  forgeAvailable,
  forgeOrder,
  hireStaff,
  isCraftMaterial,
  planRepairErrand,
  resolveRepairErrand,
  runCraftProduction,
  staffHireUnlockDay,
  STAFF_CUT,
  STAFF_HIRE_FEE,
} from "./Property";
import { makeItem } from "../entities/Item";
import { defaultBuildings } from "../utils/TownBuildings";
import type { Adventurer, GameState, Helper, Item, TownBuilding } from "../types";

function baseHelper(overrides: Partial<Helper> = {}): Helper {
  return {
    id: "helper-1",
    name: "Robin",
    appearance: { skin: 0, hair: 0 },
    trait: "curious",
    track: "craft",
    level: 3,
    xp: 160,
    assignment: "craft",
    assignmentDay: 12,
    trackChosenDay: 10,
    ...overrides,
  };
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    day: 12,
    gold: 5000,
    inventory: [],
    shelves: new Array(12).fill(null),
    buildings: defaultBuildings(),
    helper: baseHelper(),
    staff: [],
    reputation: 0,
    ...overrides,
  } as GameState;
}

function adventurer(overrides: Partial<Adventurer> = {}): Adventurer {
  return { gold: 1000, equipment: {}, ...overrides } as Adventurer;
}

describe("CRAFT_PLOTS geometry (issue #91: fixed, non-colliding plots)", () => {
  function overlaps(a: TownBuilding["footprint"], b: TownBuilding["footprint"]): boolean {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  it("none of garden/alchemy_lab/forge collide with any fixed-infrastructure footprint", () => {
    const fixed = defaultBuildings();
    for (const [kind, plot] of Object.entries(CRAFT_PLOTS)) {
      for (const b of fixed) {
        expect(overlaps(plot.footprint, b.footprint), `${kind} vs ${b.id}`).toBe(false);
      }
    }
  });

  it("garden/alchemy_lab/forge don't collide with each other", () => {
    const plots = Object.values(CRAFT_PLOTS);
    for (let i = 0; i < plots.length; i++) {
      for (let j = i + 1; j < plots.length; j++) {
        expect(overlaps(plots[i].footprint, plots[j].footprint)).toBe(false);
      }
    }
  });

  it("every plot and door stays within the world bounds", () => {
    for (const plot of Object.values(CRAFT_PLOTS)) {
      expect(plot.footprint.x).toBeGreaterThanOrEqual(0);
      expect(plot.footprint.y).toBeGreaterThanOrEqual(0);
      expect(plot.door.x).toBeGreaterThanOrEqual(plot.footprint.x);
      expect(plot.door.x).toBeLessThanOrEqual(plot.footprint.x + plot.footprint.w);
    }
  });
});

describe("canBuildCraftStructure / buildCraftStructure gating (issue #91)", () => {
  it("false with no helper at all", () => {
    const s = baseState({ helper: null });
    expect(canBuildCraftStructure(s, "garden")).toBe(false);
  });

  it("false when the helper's permanent track isn't craft, even at a qualifying level", () => {
    const s = baseState({ helper: baseHelper({ track: "shop", level: 5 }) });
    expect(canBuildCraftStructure(s, "garden")).toBe(false);
  });

  it("false below each stage's level threshold (garden L1, lab L2, forge L3)", () => {
    const s = baseState({ helper: baseHelper({ track: "craft", level: 1 }) });
    expect(canBuildCraftStructure(s, "garden")).toBe(true); // L1 satisfies garden
    expect(canBuildCraftStructure(s, "alchemy_lab")).toBe(false); // needs L2
    expect(canBuildCraftStructure(s, "forge")).toBe(false); // needs L3
  });

  it("false without enough gold", () => {
    const s = baseState({ gold: 100 }); // garden costs 150
    expect(canBuildCraftStructure(s, "garden")).toBe(false);
  });

  it("false without the required materials (lab needs 2 echo_crystal)", () => {
    const s = baseState({ inventory: [] });
    expect(canBuildCraftStructure(s, "alchemy_lab")).toBe(false);
    s.inventory.push(makeItem("echo_crystal"), makeItem("echo_crystal"));
    expect(canBuildCraftStructure(s, "alchemy_lab")).toBe(true);
  });

  it("false once the building already exists", () => {
    const s = baseState();
    expect(buildCraftStructure(s, "garden")).not.toBeNull();
    expect(canBuildCraftStructure(s, "garden")).toBe(false);
    expect(buildCraftStructure(s, "garden")).toBeNull();
  });

  it("buildCraftStructure deducts gold + materials and adds a clickable, playerBuilt building at the fixed plot", () => {
    const s = baseState({ gold: 1000, inventory: [makeItem("golem_plate"), makeItem("golem_plate"), makeItem("core_shard")] });
    const built = buildCraftStructure(s, "forge");
    expect(built).not.toBeNull();
    expect(s.gold).toBe(1000 - CRAFT_BUILD_COST.forge.gold);
    expect(s.inventory).toHaveLength(0);
    expect(built!.kind).toBe("forge");
    expect(built!.playerBuilt).toBe(true);
    expect(built!.clickable).toBe(true);
    expect(built!.builtDay).toBe(12);
    expect(built!.footprint).toEqual(CRAFT_PLOTS.forge.footprint);
    expect(s.buildings).toContain(built);
  });

  it("returns null and leaves state untouched when gating fails", () => {
    const s = baseState({ gold: 10 });
    const before = { gold: s.gold, buildingsLen: s.buildings.length };
    expect(buildCraftStructure(s, "garden")).toBeNull();
    expect(s.gold).toBe(before.gold);
    expect(s.buildings).toHaveLength(before.buildingsLen);
  });
});

describe("craftWorkerFor / runCraftProduction (issue #91)", () => {
  it("'helper' when the permanent track AND today's assignment are both craft", () => {
    const s = baseState();
    expect(craftWorkerFor(s, "garden")).toBe("helper");
  });

  it("'staff' when there's no active craft helper but a matching-role hire exists", () => {
    const s = baseState({ helper: baseHelper({ assignment: "shop" }) });
    s.staff.push({ id: "st1", name: "Cobb", role: "garden", hiredDay: 1, cut: STAFF_CUT });
    expect(craftWorkerFor(s, "garden")).toBe("staff");
    expect(craftWorkerFor(s, "lab")).toBeNull(); // no lab-role staff
  });

  it("null with neither an active craft helper nor matching staff", () => {
    const s = baseState({ helper: null });
    expect(craftWorkerFor(s, "garden")).toBeNull();
  });

  it("is a total no-op with zero craft buildings (the harness's no-craft baseline)", () => {
    const s = baseState(); // defaultBuildings() has no garden/lab/forge
    const before = s.inventory.length;
    runCraftProduction(s);
    expect(s.inventory).toHaveLength(before);
  });

  it("garden at the helper rate yields +2 ingredients/day (one herb_bundle, one moon_blossom)", () => {
    const s = baseState();
    buildCraftStructure(s, "garden");
    runCraftProduction(s);
    expect(s.inventory.filter((it) => it.name === "Herb Bundle")).toHaveLength(1);
    expect(s.inventory.filter((it) => it.name === "Moon Blossom")).toHaveLength(1);
  });

  it("garden at the staffed rate yields 1/day", () => {
    const s = baseState({ helper: baseHelper({ assignment: "shop" }) });
    buildCraftStructure(s, "garden");
    s.staff.push({ id: "st1", name: "Cobb", role: "garden", hiredDay: 1, cut: STAFF_CUT });
    runCraftProduction(s);
    expect(s.inventory).toHaveLength(1);
    expect(s.inventory[0].name).toBe("Herb Bundle");
  });

  it("lab at the helper rate consumes 1 herb_bundle + 1 moon_blossom into 1 health_potion/day", () => {
    const s = baseState({ inventory: [makeItem("echo_crystal"), makeItem("echo_crystal")] }); // lab's build cost
    buildCraftStructure(s, "alchemy_lab");
    s.inventory.push(makeItem("herb_bundle"), makeItem("moon_blossom")); // this day's ingredient stock
    runCraftProduction(s);
    expect(s.inventory.filter((it) => it.name === "Herb Bundle")).toHaveLength(0);
    expect(s.inventory.filter((it) => it.name === "Moon Blossom")).toHaveLength(0);
    expect(s.inventory.filter((it) => it.name === "Health Potion")).toHaveLength(1);
  });

  it("lab is a no-op when ingredients are missing, even with a helper actively crafting", () => {
    const s = baseState({ inventory: [makeItem("echo_crystal"), makeItem("echo_crystal")] });
    buildCraftStructure(s, "alchemy_lab");
    runCraftProduction(s);
    expect(s.inventory.filter((it) => it.name === "Health Potion")).toHaveLength(0);
  });

  it("lab at the staffed rate only produces every other day", () => {
    const s = baseState({
      day: 12, // even
      helper: baseHelper({ assignment: "shop" }),
      inventory: [makeItem("echo_crystal"), makeItem("echo_crystal")], // lab's build cost
    });
    buildCraftStructure(s, "alchemy_lab");
    s.inventory.push(makeItem("herb_bundle"), makeItem("moon_blossom"), makeItem("herb_bundle"), makeItem("moon_blossom"));
    s.staff.push({ id: "st1", name: "Cobb", role: "lab", hiredDay: 1, cut: STAFF_CUT });

    runCraftProduction(s); // day 12 (even) -> produces
    expect(s.inventory.filter((it) => it.name === "Health Potion")).toHaveLength(1);

    s.day = 13; // odd -> skipped
    runCraftProduction(s);
    expect(s.inventory.filter((it) => it.name === "Health Potion")).toHaveLength(1); // unchanged
  });
});

describe("staffHireUnlockDay / canHireStaff / hireStaff (issue #91, spec V2.9's escape hatch)", () => {
  it("craft roles reference their building's builtDay; shop references the helper's trackChosenDay", () => {
    const s = baseState();
    buildCraftStructure(s, "garden"); // builtDay = 12
    expect(staffHireUnlockDay(s, "garden")).toBe(12);
    expect(staffHireUnlockDay(s, "lab")).toBeNull(); // never built
    expect(staffHireUnlockDay(s, "shop")).toBeNull(); // helper's track is "craft", not "shop"

    const shopTrack = baseState({ helper: baseHelper({ track: "shop", trackChosenDay: 10 }) });
    expect(staffHireUnlockDay(shopTrack, "shop")).toBe(10);
  });

  it("false before day (unlockDay + 12) with reputation below the threshold", () => {
    const s = baseState({ day: 20, reputation: 0 });
    buildCraftStructure(s, "garden"); // builtDay = 20; +12 = day 32
    expect(canHireStaff(s, "garden")).toBe(false);
  });

  it("true once day >= unlockDay + 12", () => {
    const s = baseState({ day: 12, reputation: 0 });
    buildCraftStructure(s, "garden"); // builtDay = 12
    s.day = 24; // exactly +12
    expect(canHireStaff(s, "garden")).toBe(true);
    s.day = 23;
    expect(canHireStaff(s, "garden")).toBe(false);
  });

  it("true at any day once reputation >= 0.3, bypassing the day gate entirely", () => {
    const s = baseState({ day: 1, reputation: 0.3 });
    buildCraftStructure(s, "garden");
    expect(canHireStaff(s, "garden")).toBe(true);
  });

  it("false without the hire fee, even when otherwise eligible", () => {
    const s = baseState({ reputation: 0.5, gold: 10 });
    expect(canHireStaff(s, "shop")).toBe(false);
  });

  it("false for a role that's already staffed (one hire per role)", () => {
    const s = baseState({ reputation: 0.5 });
    expect(hireStaff(s, "shop")).not.toBeNull();
    expect(canHireStaff(s, "shop")).toBe(false);
    expect(hireStaff(s, "shop")).toBeNull();
  });

  it("hireStaff deducts the 200g fee and records the role/cut/hiredDay", () => {
    const s = baseState({ reputation: 0.5, gold: 1000, day: 15 });
    const staff = hireStaff(s, "forge");
    expect(staff).not.toBeNull();
    expect(s.gold).toBe(1000 - STAFF_HIRE_FEE);
    expect(staff!.role).toBe("forge");
    expect(staff!.cut).toBe(STAFF_CUT);
    expect(staff!.hiredDay).toBe(15);
    expect(s.staff).toContain(staff);
  });
});

/** Builds the forge (2 golem_plate + 1 core_shard, its own build cost) on
 *  `s`, then clears the stockroom so a test starts from a clean slate for
 *  whatever material stock IT wants to seed. */
function buildForge(s: GameState): void {
  s.inventory.push(makeItem("golem_plate"), makeItem("golem_plate"), makeItem("core_shard"));
  const built = buildCraftStructure(s, "forge");
  if (!built) throw new Error("test setup: forge failed to build");
  s.inventory.length = 0;
}

describe("forgeAvailable / canForgeOrder / forgeOrder (issue #91)", () => {
  it("forgeAvailable is false until a forge is built", () => {
    const s = baseState();
    expect(forgeAvailable(s)).toBe(false);
    buildForge(s);
    expect(forgeAvailable(s)).toBe(true);
  });

  it("canForgeOrder is false without a forge, even with an active craft helper and full stock", () => {
    const s = baseState({ inventory: [makeItem("crude_hide"), makeItem("crude_hide")] });
    expect(canForgeOrder(s, "iron_sword")).toBe(false);
  });

  it("canForgeOrder is false when staffed but not helper-crafted (staff never crafts)", () => {
    const s = baseState({ helper: baseHelper({ assignment: "shop" }) });
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"), makeItem("crude_hide"));
    s.staff.push({ id: "st1", name: "Cobb", role: "forge", hiredDay: 1, cut: STAFF_CUT });
    expect(canForgeOrder(s, "iron_sword")).toBe(false);
  });

  it("canForgeOrder is false for a non-gear defKey", () => {
    const s = baseState();
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"), makeItem("crude_hide"));
    expect(canForgeOrder(s, "health_potion")).toBe(false);
  });

  it("forgeOrder consumes 2 materials + half baseValue gold, produces a forged/common item, and caps at 1/day", () => {
    const s = baseState({ gold: 1000 });
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"), makeItem("crude_hide"), makeItem("crude_hide"), makeItem("crude_hide"));
    const goldBefore = s.gold;
    const item = forgeOrder(s, "iron_sword");
    expect(item).not.toBeNull();
    expect(item!.origin).toBe("forged");
    expect(item!.rarity).toBe("common");
    expect(s.gold).toBe(goldBefore - Math.round(30 / 2)); // iron_sword baseValue 30
    expect(s.inventory.filter((it) => it.name === "Crude Hide")).toHaveLength(2); // 2 consumed of the 4 seeded

    expect(forgeOrder(s, "iron_sword")).toBeNull(); // second order same day fails
  });

  it("forgeOrder fails without enough materials and consumes nothing", () => {
    const s = baseState({ gold: 1000 });
    buildForge(s);
    s.inventory.push(makeItem("crude_hide")); // only 1, needs 2
    expect(forgeOrder(s, "iron_sword")).toBeNull();
    expect(s.inventory).toHaveLength(1);
  });

  it("isCraftMaterial excludes garden ingredients from the forge's material pool", () => {
    expect(isCraftMaterial(makeItem("crude_hide"))).toBe(true);
    expect(isCraftMaterial(makeItem("herb_bundle"))).toBe(false);
    expect(isCraftMaterial(makeItem("moon_blossom"))).toBe(false);
    expect(isCraftMaterial(makeItem("iron_sword"))).toBe(false); // not "loot" category
  });
});

describe("planRepairErrand / resolveRepairErrand (issue #91, wired into AdventurerBehavior)", () => {
  function damagedSword(): Item {
    const item = makeItem("iron_sword"); // baseValue 30
    item.durability = 1;
    return item;
  }

  it("null without a forge, even with damaged gear, gold, and material in stock", () => {
    const s = baseState({ inventory: [makeItem("crude_hide")] });
    const a = adventurer({ equipment: { weapon: damagedSword() } });
    expect(planRepairErrand(a, s)).toBeNull();
  });

  it("null without any material in player stock", () => {
    const s = baseState();
    buildForge(s);
    const a = adventurer({ equipment: { weapon: damagedSword() } });
    expect(planRepairErrand(a, s)).toBeNull();
  });

  it("null when the adventurer can't afford the repair", () => {
    const s = baseState();
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"));
    const a = adventurer({ gold: 0, equipment: { weapon: damagedSword() } });
    expect(planRepairErrand(a, s)).toBeNull();
  });

  it("returns the weapon slot when eligible (prefersRepair true, forge + material + gold all present)", () => {
    const s = baseState();
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"));
    const a = adventurer({ equipment: { weapon: damagedSword() } });
    const plan = planRepairErrand(a, s);
    expect(plan).not.toBeNull();
    expect(plan!.slot).toBe("weapon");
  });

  it("resolveRepairErrand pays the player, consumes one material, and applies applyRepair", () => {
    const s = baseState();
    buildForge(s);
    s.inventory.push(makeItem("crude_hide"), makeItem("herb_bundle"));
    const sword = damagedSword();
    const maxBefore = sword.maxDurability!;
    const a = adventurer({ gold: 1000, equipment: { weapon: sword } });
    const goldBefore = s.gold;

    const cost = resolveRepairErrand(a, s, "weapon");
    expect(cost).toBeGreaterThan(0);
    expect(s.gold).toBe(goldBefore + cost);
    expect(a.gold).toBe(1000 - cost);
    // Only the crude_hide (a real "craft material") is eligible to be
    // consumed — herb_bundle is reserved for the lab.
    expect(s.inventory.filter((it) => it.name === "Crude Hide")).toHaveLength(0);
    expect(s.inventory.filter((it) => it.name === "Herb Bundle")).toHaveLength(1);
    expect(a.equipment.weapon!.durability).toBe(a.equipment.weapon!.maxDurability);
    expect(a.equipment.weapon!.maxDurability).toBeLessThan(maxBefore); // the 15% decay from 4a
    expect(a.equipment.weapon!.timesRepaired).toBe(1);
  });

  it("resolveRepairErrand returns 0 and changes nothing when the material is gone (a same-morning race)", () => {
    const s = baseState({ inventory: [] }); // no craft material available
    const sword = damagedSword();
    const a = adventurer({ gold: 1000, equipment: { weapon: sword } });
    const goldBefore = s.gold;
    const cost = resolveRepairErrand(a, s, "weapon");
    expect(cost).toBe(0);
    expect(s.gold).toBe(goldBefore);
    expect(a.gold).toBe(1000);
    expect(a.equipment.weapon!.timesRepaired).toBe(0);
  });
});

describe("CRAFT_STAGE_LEVEL sanity", () => {
  it("is exactly garden L1, alchemy_lab L2, forge L3 per spec V2.9", () => {
    expect(CRAFT_STAGE_LEVEL).toEqual({ garden: 1, alchemy_lab: 2, forge: 3 });
  });
});
