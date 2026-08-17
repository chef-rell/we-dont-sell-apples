// Adventure strip renderer (spec V2.5, issue #78) — the bottom panel's
// side-scrolling playback of GameState.currentScript. This is a pure read
// surface: every fact drawn here (who lives, what breaks, what drops, how
// much gold enters town) was already final the instant Combat.ts generated
// the script (spec §6 extended by V2.2: "the renderer never decides
// outcomes"). This module never mutates GameState and never calls into
// GameEngine — it only reads `state` and the wall clock `now`, exactly like
// every other view's draw function (spec V2.13: the flagship isolated
// Dev-B-ready package, own module, zero engine coupling).
//
// Timeline: `AdventureScriptEvent.t` is 0..1 through the OUTBOUND leg only
// (Combat.ts packs march/encounter/hit/.../victory/returnMarch entirely
// inside that range). The afternoon phase (PHASE_BOUNDS.afternoon) is that
// leg's real-time window; outbound playback progress = (timeOfDay -
// afternoonStart) / afternoonLength, clamped 0..1, and an event "fires" the
// first frame playback progress passes its `t`. Evening (PHASE_BOUNDS.
// evening) replays nothing — it is a silent walk home, right to left,
// survivors only, at half the walk-frame rate (the limping read). Night
// plays no script at all (see the module-end note on night raids).

import { CHILD_SPRITE_H, drawCharacter } from "./CharacterRenderer";
import type { Facing } from "./CharacterRenderer";
import { drawItemIcon, drawItemWithRarity, ICON_CELL, spawnRaritySparkle } from "./ItemRenderer";
import { shade } from "./iso";
import { drawMonster, MONSTER_CELL } from "./MonsterRenderer";
import { Particles } from "./Particles";
import { hash2d, rect } from "./PixelRenderer";
import { lightningFlash, weatherTint } from "./WeatherFX";
import { ITEM_DEFS } from "../entities/Item";
import type {
  Adventurer,
  AdventureOutcome,
  AdventureScript,
  AdventureScriptEvent,
  DayPhase,
  Enchantment,
  GameState,
  Helper,
  ItemCategory,
  ItemRarity,
  WeatherKind,
} from "../types";
import { DAY_SKY, PALETTE, PHASE_BOUNDS, PX, STRIP_H, WORLD_W } from "../utils/constants";

// ---------- Layout ----------

const GROUND_Y = 150; // terrain/ground line; sky above, dirt/grass/scree below
const SKY_H = 130; // sky fill height; 130-150 is the blended horizon band
const MARCH_X0 = 54; // meadow-side march anchor (the gate is just off-strip left)
const MARCH_X1 = 820; // cave-side march anchor (short of the arch — reads as arriving)
const CHAR_H = 64; // drawCharacter's sprite height at PX=4 (16 grid units)
const MONSTER_PX = MONSTER_CELL * PX;
const MEADOW_END_BASE = 340;
const FOREST_END_BASE = 700;
const ENCOUNTER_HOLD = 0.05; // fraction of the outbound timeline spent paused per encounter

// Strip-local ad-hoc tones (kept local like MonsterRenderer/ItemRenderer's
// own `C` tables — PALETTE covers only colors shared across modules).
const C = {
  flower: "#e07ab0",
  dust: "#c9b98a",
  slash: "#f0e6d3",
  impact: "#c0392b",
  crackShard: "#e8e0c8",
  caveRock: "#565049",
  caveDark: "#14121a",
  scree: "#4a4438",
  bone: "#8a8a92",
  boneDark: "#5a5a62",
  sackBrown: "#8a6a3a",
  sackDark: "#5e4526",
} as const;

// ---------- Public entry point ----------

/**
 * Draw the WORLD_W x STRIP_H adventure strip. Called every rAF frame from
 * AdventureStripPanel with the same (ctx, state, now) shape as every other
 * view's draw function. `now` drives idle animation and effect fade-outs
 * only — never anything that decides a verdict.
 */
export function renderStrip(ctx: CanvasRenderingContext2D, state: GameState, now: number): void {
  const deltaMs = lastNow === null ? 0 : Math.min(now - lastNow, 100);
  lastNow = now;

  // Which script (if any) is this frame's to play — the day's party script
  // during afternoon/evening, or last night's raid script (spec V2.15's
  // "the strip [Phase 5b] can play it back during the FOLLOWING night
  // phase") once phase flips to night. The two never overlap in real time
  // within a day, so the module-scoped animator state below (firedEvents,
  // particles, labels...) can track whichever one is active by id, exactly
  // like it always tracked state.currentScript alone.
  const activeScript = state.phase === "night" ? state.nightScript : state.currentScript;
  const scriptId = activeScript?.id ?? null;
  if (scriptId !== trackedScriptId) resetAnimator(scriptId);

  drawSky(ctx, state.phase, state.weather);
  drawTerrain(ctx, state.day);
  drawPath(ctx, now);
  drawClouds(ctx, now);

  const playingDayScript = state.currentScript !== null && (state.phase === "afternoon" || state.phase === "evening");
  const playingNightScript = state.phase === "night" && state.nightScript !== null;
  if (playingDayScript) {
    playScript(ctx, state, state.currentScript!, now);
  } else if (playingNightScript) {
    // Night raids (spec V2.9/Phase-2 deferral, issue #94, unblocked here):
    // same AdventureScript machinery as the day script, just read from
    // `state.nightScript` and mapped onto the night phase's own time
    // window instead of afternoon/evening's — see playNightScript() below.
    playNightScript(ctx, state, state.nightScript!, now);
  } else if (state.phase !== "night") {
    drawBirds(ctx, now);
  }

  particles.update(deltaMs);
  particles.draw(ctx);
  drawFlashes(ctx, now);
  drawLabels(ctx, now);

  // Dark tint over whatever just played (script or ambient) — the raid, if
  // any, plays out UNDER this tint (spec: "under a dark tint"), same as the
  // day script plays under full daylight.
  if (state.phase === "night") {
    rect(ctx, 0, 0, WORLD_W, STRIP_H, "rgba(6,8,20,0.58)");
  }

  // Storm lightning (spec V2.9's weather layer): a brief full-panel
  // brighten, drawn last so it reads as a flash cutting through the night
  // tint above rather than being muted by it.
  const flash = lightningFlash(state.weather, now);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.55;
    rect(ctx, 0, 0, WORLD_W, STRIP_H, "#eef0ff");
    ctx.globalAlpha = 1;
  }
}

// ---------- Animator state (module-scoped; one strip panel is ever mounted) ----------
//
// The panel's contract stays a single (ctx, state, now) call (see
// AdventureStripPanel.tsx) — this module quietly owns its own ephemeral
// presentation state (which script events have already "fired" their
// one-time flash/burst/label, and the moving particles/labels themselves)
// the same way ShopView's rAF loop owns a Particles instance across frames,
// just scoped to the module instead of a component ref since the renderer
// itself is the thing with continuity here. Nothing here is ever read back
// by game logic.

let lastNow: number | null = null;
let trackedScriptId: string | null = null;
let primed = false; // true once the catch-up pass for the current script has run
const firedEvents = new Set<AdventureScriptEvent>();
const hpBarUntil = new Map<string, number>(); // adventurerId -> wall-clock expiry
const particles = new Particles();
let labels: FloatingLabel[] = [];
let flashes: Flash[] = [];

interface FloatingLabel {
  text: string;
  x: number;
  y: number;
  color: string;
  bornAt: number;
  life: number; // ms
  icon?: { icon: string; category: ItemCategory; rarity?: ItemRarity; enchantments?: Enchantment[] };
}

interface Flash {
  x: number;
  y: number;
  kind: "slash" | "impact" | "crack";
  bornAt: number;
  life: number; // ms
}

function resetAnimator(scriptId: string | null): void {
  trackedScriptId = scriptId;
  primed = false;
  firedEvents.clear();
  hpBarUntil.clear();
  particles.clear();
  labels = [];
  flashes = [];
}

// ---------- Script playback ----------

function playScript(ctx: CanvasRenderingContext2D, state: GameState, script: AdventureScript, now: number): void {
  const [aLo, aHi] = PHASE_BOUNDS.afternoon;
  const [eLo, eHi] = PHASE_BOUNDS.evening;
  const outboundP = clamp((state.timeOfDay - aLo) / (aHi - aLo), 0, 1);
  const returning = state.timeOfDay >= eLo;
  const returnP = returning ? clamp((state.timeOfDay - eLo) / (eHi - eLo), 0, 1) : 0;

  const party = script.partyIds
    .map((id) => state.adventurers.find((a) => a.id === id))
    .filter((a): a is Adventurer => a !== undefined);
  const outcomeById = new Map(script.memberOutcomes.map((o) => [o.adventurerId, o] as const));
  const deathTById = new Map<string, number>();
  for (const ev of script.events) {
    if (ev.type === "death" && ev.actorId) deathTById.set(ev.actorId, ev.t);
  }
  const encounterTs = script.events.filter((e) => e.type === "encounter").map((e) => e.t);

  // Combat facts only ever live inside the outbound leg's 0..1 timeline;
  // the evening leg replays nothing, so effects only ever fire off
  // outbound progress even after progress functionally reaches 1.
  processEvents(script, outboundP, now);

  if (!returning) {
    drawOutboundLeg(ctx, party, deathTById, encounterTs, script, outboundP, now, state.helper);
  } else {
    drawFallenMarkers(ctx, party, deathTById);
    drawReturnLeg(ctx, party, outcomeById, returnP, now, script.helperAlong, state.helper);
  }
}

// Outbound+combat share of the night phase's own window before the return
// leg takes over — proportioned like PHASE_BOUNDS' afternoon (0.25 span)
// vs evening (0.20 span), ~55/45, since night runs pack the same march ->
// encounter(s) -> victory/defeat -> returnMarch shape into their own 0..1
// timeline (Combat.ts's `night: true` mode only changes threat/reward
// multipliers, never the event packing) but have no separate "evening"
// phase of their own to resolve the return leg against.
const NIGHT_OUT_FRACTION = 0.55;

/** A night owl's solo raid (spec V2.9/Phase-2 deferral, issue #94): almost
 *  the same shape as playScript() above (a party script, an outbound leg,
 *  a return leg) just always a party of one and never helper-accompanied
 *  (resolveNightRun() never passes helper options into
 *  generateAdventureScript), read from `state.nightScript` and timed
 *  against the night phase's own window instead of afternoon/evening's. */
function playNightScript(ctx: CanvasRenderingContext2D, state: GameState, script: AdventureScript, now: number): void {
  const [nLo, nHi] = PHASE_BOUNDS.night;
  const outEnd = nLo + (nHi - nLo) * NIGHT_OUT_FRACTION;
  const outboundP = clamp((state.timeOfDay - nLo) / (outEnd - nLo), 0, 1);
  const returning = state.timeOfDay >= outEnd;
  const returnP = returning ? clamp((state.timeOfDay - outEnd) / (nHi - outEnd), 0, 1) : 0;

  const party = script.partyIds
    .map((id) => state.adventurers.find((a) => a.id === id))
    .filter((a): a is Adventurer => a !== undefined);
  const outcomeById = new Map(script.memberOutcomes.map((o) => [o.adventurerId, o] as const));
  const deathTById = new Map<string, number>();
  for (const ev of script.events) {
    if (ev.type === "death" && ev.actorId) deathTById.set(ev.actorId, ev.t);
  }
  const encounterTs = script.events.filter((e) => e.type === "encounter").map((e) => e.t);

  processEvents(script, outboundP, now);

  if (!returning) {
    drawOutboundLeg(ctx, party, deathTById, encounterTs, script, outboundP, now, null);
  } else {
    drawFallenMarkers(ctx, party, deathTById);
    // helper=null unconditionally: resolveNightRun() never passes helper
    // options into generateAdventureScript, so script.helperAlong is always
    // false in practice — read here anyway (rather than hardcoded false)
    // so this stays correct if that ever changes; drawReturnLeg no-ops the
    // helper-marcher branch whenever `helper` is null either way.
    drawReturnLeg(ctx, party, outcomeById, returnP, now, script.helperAlong, null);
  }
}

/** Fire each event's one-time cosmetic effect the first frame playback
 *  progress passes it. On the first observation of a NEW script we do a
 *  silent catch-up (mark everything already behind `p` as fired without
 *  bursting) so loading mid-afternoon doesn't detonate every earlier beat
 *  at once — after that, effects fire one at a time as progress reaches them. */
function processEvents(script: AdventureScript, p: number, now: number): void {
  if (!primed) {
    for (const ev of script.events) if (ev.t <= p) firedEvents.add(ev);
    primed = true;
    return;
  }
  for (const ev of script.events) {
    if (ev.t > p) break; // events are non-decreasing in t (Combat.ts builds them in order)
    if (firedEvents.has(ev)) continue;
    firedEvents.add(ev);
    fireEffect(ev, now);
  }
}

function fireEffect(ev: AdventureScriptEvent, now: number): void {
  const x = xForT(ev.t);
  const y = GROUND_Y;
  switch (ev.type) {
    case "march":
      particles.burst(MARCH_X0, y - 4, { count: 4, colors: [C.dust], speed: 40, spread: 1.4, gravity: 160, life: 0.4, size: PX });
      break;
    case "hit":
      flashes.push({ x, y: y - 60, kind: "slash", bornAt: now, life: 260 });
      particles.burst(x, y - 50, { count: 6, colors: [C.slash, "#e8d44a"], speed: 130, spread: 1, gravity: 220, life: 0.4 });
      break;
    case "monsterHit":
      if (ev.actorId) hpBarUntil.set(ev.actorId, now + 1800);
      flashes.push({ x, y: y - 46, kind: "impact", bornAt: now, life: 240 });
      break;
    case "gearBreak": {
      flashes.push({ x, y: y - 44, kind: "crack", bornAt: now, life: 300 });
      particles.burst(x, y - 44, { count: 5, colors: ["#c8ccd8", "#8a90a0"], speed: 90, spread: 1, gravity: 220, life: 0.5 });
      labels.push({
        text: `${ev.itemName ?? "Gear"} broke!`,
        x,
        y: y - 62,
        color: "#e05a3a",
        bornAt: now,
        life: 1500,
        icon: { icon: "broken", category: "weapon" },
      });
      break;
    }
    case "death":
      particles.burst(x, y - 24, { count: 8, colors: [C.bone, C.boneDark], speed: 60, spread: 1, gravity: 50, life: 0.9 });
      break;
    case "lootDrop": {
      const def = ev.itemName ? ITEM_DEFS[ev.itemName] : undefined;
      if (def) {
        labels.push({
          text: `${def.name} — ${def.baseValue}g`,
          x,
          y: y - 72,
          color: PALETTE.gold,
          bornAt: now,
          life: 1900,
          icon: { icon: def.icon, category: def.category, rarity: ev.itemRarity, enchantments: ev.itemEnchantments },
        });
        particles.burst(x, y - 60, { count: 4, colors: [PALETTE.gold, "#f4dc9a"], speed: 70, spread: 1, gravity: 130, life: 0.6 });
        if (ev.itemRarity === "rare" || ev.itemRarity === "legendary") {
          spawnRaritySparkle(particles, { rarity: ev.itemRarity }, x - 16, y - 72 - 34, ICON_CELL * PX);
        }
      }
      break;
    }
    case "goldDrop": {
      // The gold faucet, made visible: coins arc up and off the top of the
      // strip toward the town panel above it (spec V2.5).
      const count = 2 + Math.floor(Math.random() * 3); // 2-4
      particles.burst(x, y - 30, { count, colors: [PALETTE.gold, "#f4dc9a"], speed: 210, spread: 0.45, gravity: 30, life: 1.3, size: PX });
      if (ev.value) {
        labels.push({ text: `+${ev.value}g`, x, y: y - 74, color: PALETTE.gold, bornAt: now, life: 1300 });
      }
      break;
    }
    case "victory":
      particles.burst(x, y - 50, { count: 10, colors: ["#f4dc9a", PALETTE.gold, "#ffffff"], speed: 100, spread: 1, gravity: 60, life: 0.8 });
      break;
    case "defeat":
      particles.burst(x, y - 20, { count: 6, colors: [C.boneDark, "#3a3a44"], speed: 50, spread: 1, gravity: 90, life: 0.7 });
      break;
    case "returnMarch":
      break; // implicit — the evening leg begins on its own once the phase rolls over
  }
}

// ---------- Outbound leg (afternoon, left -> right) ----------

function drawOutboundLeg(
  ctx: CanvasRenderingContext2D,
  party: Adventurer[],
  deathTById: Map<string, number>,
  encounterTs: number[],
  script: AdventureScript,
  p: number,
  now: number,
  helper: Helper | null,
): void {
  const groupX = xForT(marchProgress(p, encounterTs));
  const frame: 0 | 1 = Math.floor(now / 180) % 2 === 0 ? 0 : 1;

  const activeEncounter = findActiveEncounter(script, p);
  if (activeEncounter) {
    const bob = Math.sin(now / 220) * 3;
    drawMonster(ctx, activeEncounter.monster ?? "", groupX + 70, GROUND_Y - MONSTER_PX + bob);
  }

  party.forEach((a, i) => {
    const deathT = deathTById.get(a.id);
    if (deathT !== undefined && deathT <= p) return; // drawn once, below, as a persistent marker
    const { dx, dy } = stagger(i, party.length);
    drawMarcher(ctx, a, groupX + dx, GROUND_Y + dy, frame, "right");
    drawRunningHpBar(ctx, a, script, p, groupX + dx, GROUND_Y + dy, now);
  });

  if (script.helperAlong && helper) {
    drawHelperMarcher(ctx, helper, groupX + helperDx(party.length, helper.level), GROUND_Y, frame, "right");
  }

  drawFallenMarkers(ctx, party, deathTById, p);
}

/** Party position eases through, then pauses ~ENCOUNTER_HOLD at each
 *  encounter's own `t` so its beat has room to read, then resumes — a
 *  monotonic, closed-form reshaping of raw progress (never loops or jumps),
 *  built from the encounter t's Combat.ts already spaces evenly. */
function marchProgress(p: number, encounterTs: number[]): number {
  const stops = [0, ...encounterTs, 1];
  for (let i = 0; i < stops.length - 1; i++) {
    const segStart = stops[i];
    const segEnd = stops[i + 1];
    const holdEnd = i > 0 ? Math.min(segEnd, segStart + ENCOUNTER_HOLD) : segStart;
    if (p < holdEnd) return segStart;
    if (p >= segEnd) continue;
    const span = segEnd - holdEnd;
    const frac = span > 0 ? (p - holdEnd) / span : 1;
    return segStart + frac * (segEnd - segStart);
  }
  return 1;
}

function findActiveEncounter(script: AdventureScript, p: number): AdventureScriptEvent | null {
  let active: AdventureScriptEvent | null = null;
  for (const ev of script.events) {
    if (ev.type !== "encounter") continue;
    if (ev.t <= p && p <= ev.t + ENCOUNTER_HOLD + 0.01) active = ev;
  }
  return active;
}

/** Damage this member has actually taken by playback progress `p`, derived
 *  purely from the script's own monsterHit events — NOT from `a.hp`, which
 *  AdventurerBehavior only decrements once at evening resolution, well
 *  after the outbound leg has already shown the fight happening. */
function runningHp(a: Adventurer, script: AdventureScript, p: number): number {
  let hp = a.hp;
  for (const ev of script.events) {
    if (ev.t > p) break;
    if (ev.type === "monsterHit" && ev.actorId === a.id) hp -= ev.value ?? 0;
  }
  return Math.max(0, hp);
}

function drawRunningHpBar(
  ctx: CanvasRenderingContext2D,
  a: Adventurer,
  script: AdventureScript,
  p: number,
  x: number,
  y: number,
  now: number,
): void {
  const until = hpBarUntil.get(a.id);
  if (!until || until < now) return;
  const ratio = runningHp(a, script, p) / a.maxHp;
  const w = 32;
  const clamped = Math.max(0, Math.min(1, ratio));
  rect(ctx, x - w / 2, y - CHAR_H - 12, w, 6, "#1e1a14");
  rect(
    ctx,
    x - w / 2 + PX / 2,
    y - CHAR_H - 12 + PX / 2,
    Math.max(0, (w - PX) * clamped),
    6 - PX,
    clamped > 0.5 ? "#5bbf5b" : clamped > 0.25 ? "#d9b93a" : "#c0392b",
  );
}

// ---------- Return leg (evening, right -> left) ----------

function drawReturnLeg(
  ctx: CanvasRenderingContext2D,
  party: Adventurer[],
  outcomeById: Map<string, AdventureOutcome>,
  p: number,
  now: number,
  helperAlong: boolean,
  helper: Helper | null,
): void {
  const survivors = party.filter((a) => outcomeById.get(a.id)?.survived);
  const x = MARCH_X1 - p * (MARCH_X1 - MARCH_X0);
  // Halved walk-frame rate — the limping read (spec V2.5: dusk march is
  // survivors, slower).
  const frame: 0 | 1 = Math.floor(now / 360) % 2 === 0 ? 0 : 1;
  survivors.forEach((a, i) => {
    const { dx, dy } = stagger(i, survivors.length);
    drawMarcher(ctx, a, x + dx, GROUND_Y + dy, frame, "left");
  });

  if (helperAlong && helper) {
    if (survivors.length === 0) {
      // Full wipe: nobody marches back under the normal formation path —
      // the helper alone drags home whatever gold/items the dead party
      // couldn't carry (GameEngine already applied the real effects via
      // this script's "helperCarry" events; this is purely that beat's
      // visual).
      drawHelperAlone(ctx, helper, x, GROUND_Y, frame);
    } else {
      drawHelperMarcher(ctx, helper, x + helperDx(survivors.length, helper.level), GROUND_Y, frame, "left");
    }
  }
}

// ---------- Shared party/marker drawing ----------

function stagger(i: number, n: number): { dx: number; dy: number } {
  return { dx: (i - (n - 1) / 2) * 20, dy: (i % 2) * 12 };
}

function drawMarcher(
  ctx: CanvasRenderingContext2D,
  a: Adventurer,
  x: number,
  y: number,
  frame: 0 | 1,
  facing: Facing,
): void {
  rect(ctx, x - 14, y - PX, 32, PX, "rgba(20,16,12,0.4)"); // ground shadow
  drawCharacter(ctx, a, x - 18, y - CHAR_H, frame, facing);
  ctx.font = `${2 * PX}px monospace`;
  ctx.textAlign = "center";
  ctx.fillStyle = PALETTE.textDim;
  ctx.fillText(a.name.split(" ")[0], x, y + 10);
  ctx.textAlign = "left";
}

/** The helper's marching-formation offset relative to the real party's
 *  center line — one step further out than the outermost real member.
 *  Negative dx = back of formation (trailing, further from the direction
 *  of travel, the default); positive dx = front (leading, level >= 4).
 *  Like `stagger()`, this is direction-agnostic — the same sign convention
 *  reads correctly added onto either leg's own x (outbound marches right,
 *  return marches left), so callers never flip the sign themselves. */
function helperDx(formationSize: number, level: number): number {
  const half = (formationSize - 1) / 2;
  return (level >= 4 ? half + 1 : -(half + 1)) * 20;
}

/** The helper's marching sprite — smaller than a real party member's, no
 *  name label (spec: keep the helper's marker simpler). */
function drawHelperMarcher(
  ctx: CanvasRenderingContext2D,
  helper: Helper,
  x: number,
  y: number,
  frame: 0 | 1,
  facing: Facing,
): void {
  rect(ctx, x - 12, y - PX, 24, PX, "rgba(20,16,12,0.4)"); // ground shadow
  drawCharacter(ctx, helper, x - 18, y - CHILD_SPRITE_H, frame, facing, "child");
}

/** Full-wipe beat: nobody survived to march home, so the helper (if it
 *  tagged along) walks the same return timeline alone, dragging a sack of
 *  whatever gold/items the dead party couldn't carry — the visual for the
 *  script's "helperCarry" events, which GameEngine has already resolved
 *  into state.gold/state.inventory elsewhere; this draws no numbers. */
function drawHelperAlone(ctx: CanvasRenderingContext2D, helper: Helper, x: number, y: number, frame: 0 | 1): void {
  // Sack trails behind, opposite the direction of travel (walking left, so
  // it drags to the sprite's right). A couple of overlapping rects read as
  // "lumpy sack" rather than a crate.
  rect(ctx, x + 10, y - 14, 14, 10, C.sackDark);
  rect(ctx, x + 14, y - 21, 12, 13, C.sackBrown);
  rect(ctx, x + 12, y - 10, 10, 4, C.sackDark);
  rect(ctx, x - 12, y - PX, 24, PX, "rgba(20,16,12,0.4)"); // ground shadow
  drawCharacter(ctx, helper, x - 18, y - CHILD_SPRITE_H, frame, "left", "child");
}

/** Fallen party members stay exactly where they fell for the rest of the
 *  day (spec: "the fallen sprite stays as a marker"), through both the
 *  outbound leg once passed and the whole evening leg — `p` omitted means
 *  "show every death this script recorded" (used once combat is fully
 *  resolved, i.e. during the evening leg). */
function drawFallenMarkers(
  ctx: CanvasRenderingContext2D,
  party: Adventurer[],
  deathTById: Map<string, number>,
  p = 1,
): void {
  let slot = 0;
  for (const a of party) {
    const deathT = deathTById.get(a.id);
    if (deathT === undefined || deathT > p) continue;
    drawFallenMarker(ctx, xForT(deathT), GROUND_Y, slot);
    slot += 1;
  }
}

function drawFallenMarker(ctx: CanvasRenderingContext2D, x: number, groundY: number, slot: number): void {
  const nudge = (slot % 3) * 6;
  rect(ctx, x - 10 + nudge, groundY - 26, 20, 22, PALETTE.stone[1]);
  rect(ctx, x - 8 + nudge, groundY - 28, 16, PX, PALETTE.stone[0]);
  rect(ctx, x - 2 + nudge, groundY - 22, 4, 14, "#3d382e");
  rect(ctx, x - 8 + nudge, groundY - 16, 16, PX, "#3d382e");
}

// ---------- Ephemeral effect drawing (flashes + floating labels) ----------

function drawFlashes(ctx: CanvasRenderingContext2D, now: number): void {
  flashes = flashes.filter((f) => now - f.bornAt < f.life);
  for (const f of flashes) {
    const t = (now - f.bornAt) / f.life;
    ctx.globalAlpha = Math.max(0, 1 - t);
    if (f.kind === "slash") {
      for (const off of [0, 10]) {
        for (let s = 0; s < 5; s++) rect(ctx, f.x - 10 + off + s * PX, f.y + s * PX, PX, PX, C.slash);
      }
    } else if (f.kind === "impact") {
      rect(ctx, f.x - 6, f.y, PX * 2, PX * 2, C.impact);
      rect(ctx, f.x + 6, f.y + 8, PX, PX, C.impact);
    } else {
      rect(ctx, f.x - 4, f.y, PX * 2, PX * 2, C.crackShard);
      rect(ctx, f.x + 2, f.y + PX, PX, PX, C.crackShard);
    }
    ctx.globalAlpha = 1;
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, now: number): void {
  labels = labels.filter((l) => now - l.bornAt < l.life);
  for (const l of labels) {
    const t = (now - l.bornAt) / l.life;
    const rise = t * 20;
    ctx.globalAlpha = Math.max(0, 1 - t);
    if (l.icon) {
      if (l.icon.rarity) {
        drawItemWithRarity(
          ctx,
          { icon: l.icon.icon, category: l.icon.category, rarity: l.icon.rarity, enchantments: l.icon.enchantments ?? [] },
          l.x - 16,
          l.y - rise - 34,
        );
      } else {
        drawItemIcon(ctx, l.icon, l.x - 16, l.y - rise - 34);
      }
    }
    ctx.font = `${2.5 * PX}px monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y - rise);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  }
}

// ---------- Terrain (always drawn — the strip is never a dead panel) ----------

function drawSky(ctx: CanvasRenderingContext2D, phase: DayPhase, weather: WeatherKind): void {
  const base = weatherTint(DAY_SKY[phase], weather); // spec: "strip tints to match" the town's weather
  rect(ctx, 0, 0, WORLD_W, SKY_H, base);
  rect(ctx, 0, SKY_H, WORLD_W, GROUND_Y - SKY_H, shade(base, -0.12));
}

/** Meadow -> forest -> cave-mouth boundaries, shifting subtly deeper (more
 *  cave, less meadow) as `day` climbs — the road delving further in as the
 *  run goes on. Deltas are intentionally small (spec: "subtly"). */
function terrainBounds(day: number): { meadowEnd: number; forestEnd: number } {
  const shrink = Math.min(90, day * 2.2);
  const meadowEnd = Math.max(180, MEADOW_END_BASE - shrink);
  const forestEnd = Math.max(meadowEnd + 220, FOREST_END_BASE - shrink * 0.6);
  return { meadowEnd, forestEnd };
}

function drawTerrain(ctx: CanvasRenderingContext2D, day: number): void {
  const { meadowEnd, forestEnd } = terrainBounds(day);
  const depth = Math.min(1, day / 30); // 0 (fresh run) .. 1 (deep into the run)

  const grass = shade(PALETTE.grass[0], -depth * 0.15);
  const grassHi = shade(PALETTE.grass[1], -depth * 0.15);
  rect(ctx, 0, GROUND_Y, meadowEnd, STRIP_H - GROUND_Y, grass);
  for (let x = 8; x < meadowEnd; x += 20) {
    if (hash2d(x, 1, 3) > 0.72) rect(ctx, x, GROUND_Y + 6 + hash2d(x, 2, 4) * 24, PX, PX, grassHi);
    if (hash2d(x, 5, 9) > 0.9) rect(ctx, x, GROUND_Y + 8 + hash2d(x, 3, 7) * 18, PX, PX, C.flower);
  }

  const forestFloor = shade(PALETTE.wood[0], depth * -0.1 + 0.08);
  rect(ctx, meadowEnd, GROUND_Y, forestEnd - meadowEnd, STRIP_H - GROUND_Y, forestFloor);
  const treeCount = 11;
  for (let i = 0; i < treeCount; i++) {
    const span = forestEnd - meadowEnd - 30;
    const tx = meadowEnd + 18 + (i / treeCount) * span + hash2d(i, 7, 2) * 14;
    drawStripTree(ctx, tx, GROUND_Y, depth);
  }

  rect(ctx, forestEnd, GROUND_Y, WORLD_W - forestEnd, STRIP_H - GROUND_Y, shade(C.scree, -depth * 0.2));
  for (let x = forestEnd + 10; x < WORLD_W; x += 26) {
    if (hash2d(x, 6, 4) > 0.65) rect(ctx, x, GROUND_Y + 10 + hash2d(x, 4, 8) * 20, 10, 8, shade(C.scree, -0.15));
  }
  drawCaveMouth(ctx, WORLD_W - 90, depth);

  rect(ctx, 0, GROUND_Y, WORLD_W, PX, "#241f18"); // ground line
}

function drawStripTree(ctx: CanvasRenderingContext2D, x: number, groundY: number, depth: number): void {
  const trunkW = 8;
  const trunkH = 16;
  shadedBlock(ctx, x - trunkW / 2, groundY - trunkH, trunkW, trunkH, shade(PALETTE.wood[0], -depth * 0.1));
  const canW = 26;
  const canH = 24;
  shadedBlock(ctx, x - canW / 2, groundY - trunkH - canH + 6, canW, canH, shade(PALETTE.foliage, -depth * 0.15));
}

function drawCaveMouth(ctx: CanvasRenderingContext2D, cx: number, depth: number): void {
  const w = 150;
  const h = 130;
  shadedBlock(ctx, cx - w / 2, GROUND_Y - h, w, h, shade(C.caveRock, -depth * 0.15));
  const mouthW = 60;
  const mouthH = 92;
  rect(ctx, cx - mouthW / 2, GROUND_Y - mouthH, mouthW, mouthH, C.caveDark);
  rect(ctx, cx - mouthW / 2 + 10, GROUND_Y - mouthH - 14, mouthW - 20, 18, C.caveDark); // arched top
}

/** Three-face shading rule (spec V2.4): top light, base mid, one dark edge,
 *  plus a dark silhouette edge — applied as a front-elevation box (the
 *  strip is a side-scroll, not the iso town, so this reuses the shading
 *  math from rendering/iso.ts's `shade()` rather than its diamond
 *  projection, which is calibrated to the town canvas). */
function shadedBlock(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string): void {
  const top = shade(base, 0.28);
  const dark = shade(base, -0.3);
  rect(ctx, x, y, w, h, base);
  const edge = Math.max(PX, Math.round((w * 0.3) / PX) * PX);
  rect(ctx, x + w - edge, y, edge, h, dark);
  const cap = Math.max(PX, Math.round((h * 0.22) / PX) * PX);
  rect(ctx, x, y, w, cap, top);
  rect(ctx, x, y, PX, h, "#14141c");
  rect(ctx, x, y, w, PX, "#14141c");
}

/** A single worn dirt track running the whole strip, tying the three bands
 *  together as one continuous road — the path the party marches down, and
 *  the thing that keeps an empty strip reading as "a place" rather than a
 *  void (kept from the #77 placeholder, now load-bearing scenery). */
function drawPath(ctx: CanvasRenderingContext2D, now: number): void {
  rect(ctx, 0, GROUND_Y - 8, WORLD_W, 8, PALETTE.dirt[1]);
  rect(ctx, 0, GROUND_Y - 8, WORLD_W, PX, PALETTE.dirt[0]);
  for (let x = -48; x < WORLD_W + 48; x += 56) {
    const dashX = ((x + now * 0.01) % (WORLD_W + 96)) - 48;
    rect(ctx, dashX, GROUND_Y - 5, 22, PX, "#8b6914");
  }
}

// ---------- Ambient (no script, or dawn/morning) ----------

const CLOUD_COUNT = 4;

function drawClouds(ctx: CanvasRenderingContext2D, now: number): void {
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const w = 60 + hash2d(i, 2, 5) * 34;
    const speed = 4 + hash2d(i, 6, 1) * 5;
    const startX = hash2d(i, 11, 3) * (WORLD_W + w * 2);
    const x = ((startX + (now / 1000) * speed) % (WORLD_W + w * 2)) - w;
    const y = 10 + hash2d(i, 4, 9) * 44;
    const h = w * 0.3;
    rect(ctx, x, y, w, h, "rgba(240,230,211,0.06)");
    rect(ctx, x + w * 0.22, y - h * 0.35, w * 0.56, h, "rgba(240,230,211,0.06)");
  }
}

/** A little life on quiet days — no script playing, so nothing here reads
 *  as anything but ambience (spec: "never a dead panel"). */
function drawBirds(ctx: CanvasRenderingContext2D, now: number): void {
  for (let i = 0; i < 2; i++) {
    const speed = 30 + hash2d(i, 9, 5) * 20;
    const startX = hash2d(i, 3, 8) * (WORLD_W + 200);
    const x = ((startX + (now / 1000) * speed) % (WORLD_W + 200)) - 100;
    const y = 26 + hash2d(i, 5, 2) * 40 + Math.sin(now / 400 + i) * 4;
    const flap = Math.floor(now / 200 + i) % 2 === 0;
    ctx.fillStyle = "rgba(30,26,20,0.5)";
    ctx.fillRect(x, y, PX, PX);
    ctx.fillRect(x - PX, y - (flap ? PX : 0), PX, PX);
    ctx.fillRect(x + PX, y - (flap ? PX : 0), PX, PX);
  }
}

// ---------- Small helpers ----------

function xForT(t: number): number {
  return MARCH_X0 + clamp(t, 0, 1) * (MARCH_X1 - MARCH_X0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
