// Craft track: property buildings, production loops, hired staff (spec
// V2.9, issue #91). Builds on 4a's Forge.ts (pure repair math) and #83's
// Helper.ts — the same "pure functions GameEngine wires in" shape those
// modules use. Nothing here calls Math.random() except `hireStaff`'s name
// pick, which is pure liveliness (CLAUDE.md's determinism-vs-liveliness
// gotcha) and never gates a mechanic.

import type { Adventurer, GameState, Item, Staff, StaffRole, TownBuilding } from "../types";
import { ITEM_DEFS, makeItem } from "../entities/Item";
import { getBuilding } from "../utils/TownBuildings";
import { generateTownsfolkName } from "../utils/names";
import { applyRepair, canRepair, prefersRepair, repairCost } from "./Forge";

// ---------- Buildings ----------

export type CraftBuildingKind = "garden" | "alchemy_lab" | "forge";

/** L1 gardening -> garden, L2 alchemy -> lab, L3 blacksmithing -> forge
 *  (spec V2.9). Helper level is a single track-agnostic curve (#83); the
 *  gate below also requires `track === "craft"` so a shop/adventure-track
 *  helper's level never unlocks these. */
export const CRAFT_STAGE_LEVEL: Record<CraftBuildingKind, number> = {
  garden: 1,
  alchemy_lab: 2,
  forge: 3,
};

export const CRAFT_BUILD_COST: Record<CraftBuildingKind, { gold: number; materials: [string, number][] }> = {
  garden: { gold: 150, materials: [] },
  alchemy_lab: { gold: 400, materials: [["echo_crystal", 2]] },
  forge: { gold: 800, materials: [["golem_plate", 2], ["core_shard", 1]] },
};

/** Fixed world-coordinate plots, adjacent to the shop (footprint x100-216,
 *  y116-204) and clear of every other registered footprint (verified in
 *  Property.test.ts): garden west of the shop, lab south-west, forge
 *  directly south. Own plot only — no other building ever occupies these
 *  slots, so this stays multiplayer-safe (spec V2.8's "never impedes other
 *  plots"). Doors sit at each footprint's bottom-center. */
export const CRAFT_PLOTS: Record<
  CraftBuildingKind,
  { footprint: { x: number; y: number; w: number; h: number }; door: { x: number; y: number } }
> = {
  garden: { footprint: { x: 20, y: 128, w: 64, h: 48 }, door: { x: 52, y: 176 } },
  alchemy_lab: { footprint: { x: 20, y: 216, w: 64, h: 48 }, door: { x: 52, y: 264 } },
  forge: { footprint: { x: 100, y: 216, w: 64, h: 48 }, door: { x: 132, y: 264 } },
};

function countMaterial(items: Item[], defKey: string): number {
  const name = ITEM_DEFS[defKey].name;
  return items.filter((it) => it.name === name).length;
}

/** Removes exactly `n` copies of `defKey` from `items` (by display name,
 *  the only stable match key on a plain Item) if that many exist; leaves
 *  `items` untouched and returns false otherwise. */
function takeMaterial(items: Item[], defKey: string, n: number): boolean {
  const name = ITEM_DEFS[defKey].name;
  const idxs: number[] = [];
  for (let i = 0; i < items.length && idxs.length < n; i++) {
    if (items[i].name === name) idxs.push(i);
  }
  if (idxs.length < n) return false;
  for (let i = idxs.length - 1; i >= 0; i--) items.splice(idxs[i], 1);
  return true;
}

/** Whether `kind` can be built right now: not already built, helper
 *  committed to "craft" and at the stage's level, and gold/materials in
 *  the player's stockroom cover the cost. */
export function canBuildCraftStructure(s: GameState, kind: CraftBuildingKind): boolean {
  if (getBuilding(s.buildings, kind)) return false;
  const h = s.helper;
  if (!h || h.track !== "craft") return false;
  if (h.level < CRAFT_STAGE_LEVEL[kind]) return false;
  const cost = CRAFT_BUILD_COST[kind];
  if (s.gold < cost.gold) return false;
  for (const [key, n] of cost.materials) {
    if (countMaterial(s.inventory, key) < n) return false;
  }
  return true;
}

/** Builds `kind`: deducts gold + materials, adds the fixed-plot building to
 *  `state.buildings` (clickable, so a later phase can open its panel).
 *  Returns the new building, or null if `canBuildCraftStructure` said no —
 *  callers never need to duplicate the gating check. */
export function buildCraftStructure(s: GameState, kind: CraftBuildingKind): TownBuilding | null {
  if (!canBuildCraftStructure(s, kind)) return null;
  const cost = CRAFT_BUILD_COST[kind];
  for (const [key, n] of cost.materials) takeMaterial(s.inventory, key, n);
  s.gold -= cost.gold;
  const plot = CRAFT_PLOTS[kind];
  const building: TownBuilding = {
    id: kind,
    kind,
    footprint: plot.footprint,
    door: plot.door,
    clickable: true,
    playerBuilt: true,
    builtDay: s.day,
  };
  s.buildings.push(building);
  return building;
}

// ---------- Hired staff (the V2.1/V2.9 escape hatch) ----------

export const STAFF_HIRE_FEE = 200;
export const STAFF_CUT = 0.08; // 8% of daily sales revenue, paid at rollover
export const STAFF_HIRE_REP_THRESHOLD = 0.3;
export const STAFF_HIRE_DELAY_DAYS = 12;

/** Maps a staff role to the craft building that gates it, or null for
 *  "shop" (which needs no building — the shop exists from day one). */
function craftKindForRole(role: StaffRole): CraftBuildingKind | null {
  if (role === "garden") return "garden";
  if (role === "lab") return "alchemy_lab";
  if (role === "forge") return "forge";
  return null;
}

/** The day this role's hire window REFERENCE point landed (spec V2.9:
 *  "the equivalent hire becomes available ~10-15 days later" than the
 *  helper's own unlock) — null if that reference hasn't happened yet.
 *  Craft roles use their building's `builtDay` (the concrete, deterministic
 *  event a craft stage unlocking produces); "shop" uses the helper's
 *  `trackChosenDay` (there's no building to point to for that track).
 *  Judgment call, since the spec doesn't pin this down further — documented
 *  in the PR body / V2.15. */
export function staffHireUnlockDay(s: GameState, role: StaffRole): number | null {
  if (role === "shop") {
    return s.helper && s.helper.track === "shop" ? s.helper.trackChosenDay : null;
  }
  const kind = craftKindForRole(role)!;
  return getBuilding(s.buildings, kind)?.builtDay ?? null;
}

/** Hire-eligibility gate (spec V2.9, issue #91): day >= unlock reference +
 *  12, OR reputation >= 0.3 — whichever the player reaches first. One hire
 *  per role (a second garden hand isn't a thing this economy models). */
export function canHireStaff(s: GameState, role: StaffRole): boolean {
  if (s.staff.some((st) => st.role === role)) return false;
  if (s.gold < STAFF_HIRE_FEE) return false;
  if (s.reputation >= STAFF_HIRE_REP_THRESHOLD) return true;
  const unlockDay = staffHireUnlockDay(s, role);
  return unlockDay !== null && s.day >= unlockDay + STAFF_HIRE_DELAY_DAYS;
}

/** Hires a townsperson for `role`: 200g fee, 8% ongoing payroll cut, a name
 *  drawn from the townsfolk pool (never an adventurer). Returns the new
 *  Staff row, or null if `canHireStaff` said no. */
export function hireStaff(s: GameState, role: StaffRole): Staff | null {
  if (!canHireStaff(s, role)) return null;
  s.gold -= STAFF_HIRE_FEE;
  const staff: Staff = {
    id: crypto.randomUUID(),
    name: generateTownsfolkName(),
    role,
    hiredDay: s.day,
    cut: STAFF_CUT,
  };
  s.staff.push(staff);
  return staff;
}

// ---------- Production (day-rollover garden/lab; forge is player-triggered) ----------

export type CraftWorker = "helper" | "staff" | null;

/** Who's actually working `role` today: the helper (full rate) whenever
 *  they're committed to the craft track AND today's daily assignment is
 *  "craft" (mirrors #83's "effects gate on assignment, not permanent
 *  track"); otherwise hired staff for that role, if any (reduced rate);
 *  otherwise nobody. */
export function craftWorkerFor(s: GameState, role: StaffRole): CraftWorker {
  if (s.helper && s.helper.track === "craft" && s.helper.assignment === "craft") return "helper";
  if (s.staff.some((st) => st.role === role)) return "staff";
  return null;
}

/** Deterministic day-rollover production (spec V2.9, issue #91): garden and
 *  lab only — forge output is the player-triggered `forgeOrder()` below,
 *  plus the always-on repair service (`AdventurerBehavior`'s repair
 *  errand), neither of which is a rollover event. A complete no-op when
 *  neither building exists — byte-identical to pre-#91 rollover, which is
 *  exactly the harness's no-craft balance path. */
export function runCraftProduction(s: GameState): void {
  const garden = getBuilding(s.buildings, "garden");
  if (garden) {
    const worker = craftWorkerFor(s, "garden");
    if (worker === "helper") {
      // Full rate: +2 ingredients/day, one of each (spec V2.9).
      s.inventory.push(makeItem("herb_bundle"));
      s.inventory.push(makeItem("moon_blossom"));
    } else if (worker === "staff") {
      // Staffed output 60%, expressed per the issue's own literal number:
      // "garden 1/day".
      s.inventory.push(makeItem("herb_bundle"));
    }
  }

  const lab = getBuilding(s.buildings, "alchemy_lab");
  if (lab) {
    const worker = craftWorkerFor(s, "lab");
    // Staffed output: "lab every other day" — day-parity is deterministic
    // and needs no extra persisted state.
    const eligible = worker === "helper" || (worker === "staff" && s.day % 2 === 0);
    if (eligible && takeMaterial(s.inventory, "herb_bundle", 1) && takeMaterial(s.inventory, "moon_blossom", 1)) {
      s.inventory.push(makeItem("health_potion"));
    }
  }
}

// ---------- Forge: crafting (player-triggered, once/day) ----------

/** Monster-drop material stock, distinct from the garden's ingredients
 *  (herb_bundle/moon_blossom are reserved for the lab — see the ITEM_DEFS
 *  comment in entities/Item.ts) — the "2 materials" a forge order or a
 *  repair consumes are the existing loot-category monster drops. */
export function isCraftMaterial(item: Item): boolean {
  return (
    item.category === "loot" &&
    item.name !== ITEM_DEFS.herb_bundle.name &&
    item.name !== ITEM_DEFS.moon_blossom.name
  );
}

function takeCraftMaterial(items: Item[]): Item | null {
  const idx = items.findIndex(isCraftMaterial);
  if (idx === -1) return null;
  return items.splice(idx, 1)[0];
}

export const FORGE_ORDER_MATERIAL_COUNT = 2;

/** Whether a forge exists in `state.buildings` at all — the forge's repair
 *  service is always-on once built, independent of helper/staff (spec
 *  V2.9's "Repairs (the forge's service)" section never mentions a worker
 *  requirement). Forge.ts's `prefersRepair` takes exactly this boolean. */
export function forgeAvailable(s: GameState): boolean {
  return getBuilding(s.buildings, "forge") !== undefined;
}

/** Whether `defKey` can be forge-ordered right now: a forge exists, the
 *  HELPER (never staff — "forge repairs only, no crafting" for staff, spec
 *  V2.9) is actively on craft duty today, `defKey` is equippable gear, the
 *  order hasn't already fired today, and gold + 2 materials cover the
 *  cost. */
export function canForgeOrder(s: GameState, defKey: string): boolean {
  const forge = getBuilding(s.buildings, "forge");
  if (!forge) return false;
  if (forge.lastProducedDay === s.day) return false;
  if (craftWorkerFor(s, "forge") !== "helper") return false;
  const def = ITEM_DEFS[defKey];
  if (!def || (def.category !== "weapon" && def.category !== "armor")) return false;
  const cost = Math.round(def.baseValue / 2);
  if (s.gold < cost) return false;
  const materialCount = s.inventory.filter(isCraftMaterial).length;
  return materialCount >= FORGE_ORDER_MATERIAL_COUNT;
}

/** Forges `defKey`: 2 materials + half its baseValue in gold -> a new item
 *  with `origin: "forged"` (the ×1.3 durability multiplier from 4a) at
 *  common rarity. Judgment call: the issue's "quality ceiling = uncommon
 *  rarity" doesn't specify how a forged item's rarity is actually chosen;
 *  a player-triggered action rolling rarity would need its own rng seed to
 *  stay deterministic (nothing in the codebase seeds one for engine
 *  actions outside Combat.ts), so forged items are always exactly
 *  "common" — trivially satisfying "never exceeds uncommon" without
 *  inventing an unseeded roll. Onto an empty shelf, else the stockroom
 *  (mirrors `buyWholesale`). Returns the new item, or null if
 *  `canForgeOrder` said no. */
export function forgeOrder(s: GameState, defKey: string): Item | null {
  if (!canForgeOrder(s, defKey)) return null;
  const def = ITEM_DEFS[defKey];
  const cost = Math.round(def.baseValue / 2);
  for (let i = 0; i < FORGE_ORDER_MATERIAL_COUNT; i++) takeCraftMaterial(s.inventory);
  s.gold -= cost;
  const item = makeItem(defKey, { origin: "forged", rarity: "common" });
  const empty = s.shelves.findIndex((slot) => slot === null);
  if (empty !== -1) s.shelves[empty] = item;
  else s.inventory.push(item);
  getBuilding(s.buildings, "forge")!.lastProducedDay = s.day;
  return item;
}

// ---------- Forge: repair errand (wired into AdventurerBehavior.ts) ----------

/** Decide-phase (morning, before the adventurer sets out): does this trip
 *  go to the forge instead of the shop? Pure read — mutates nothing, so
 *  it's safe to call speculatively. Requires a built forge, a repairable
 *  equipped item this adventurer prefers repairing (4a's `prefersRepair`,
 *  §6-style pure decision, untouched here), gold to cover it, AND at least
 *  one material already in stock (a materialless trip falls back to
 *  shopping rather than promising a repair it can't deliver). Checks
 *  weapon before armor — an arbitrary but deterministic tie-break. */
export function planRepairErrand(
  a: Adventurer,
  s: GameState,
): { slot: "weapon" | "armor"; item: Item } | null {
  if (!forgeAvailable(s)) return null;
  if (!s.inventory.some(isCraftMaterial)) return null;
  for (const slot of ["weapon", "armor"] as const) {
    const item = a.equipment[slot];
    if (item && canRepair(item) && prefersRepair(a, item, true) && a.gold >= repairCost(item)) {
      return { slot, item };
    }
  }
  return null;
}

/** Execute-phase (on arrival at the forge): pays the player, consumes one
 *  material, applies 4a's `applyRepair` to the equipped item. Re-checks the
 *  material (another adventurer may have taken the last one between the
 *  decide and execute phases) and returns 0 — no charge, nothing consumed
 *  — if it's gone; the caller treats that as "leave without buying"
 *  exactly like a normal shop trip that didn't convert. Returns the gold
 *  the player was paid. */
export function resolveRepairErrand(a: Adventurer, s: GameState, slot: "weapon" | "armor"): number {
  const item = a.equipment[slot];
  if (!item) return 0;
  const material = takeCraftMaterial(s.inventory);
  if (!material) return 0;
  const cost = repairCost(item);
  a.gold -= cost;
  s.gold += cost;
  a.equipment[slot] = applyRepair(item);
  return cost;
}
