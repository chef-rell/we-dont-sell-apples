// Sound effect definitions (spec §9). Every sound is synthesised — there are
// no audio files in this project, same rule as the art.
//
// Each effect is a recipe: which voice plays it, and what it plays. The
// SoundManager owns the voices and the timing; this file owns the character of
// each sound, so tweaking how a coin feels never touches the audio plumbing.

export type SfxName =
  | "coin" // gold changes hands
  | "thud" // item moved onto a shelf
  | "door" // an adventurer walks into the shop
  | "happy" // reaction chimes (§6 verdicts)
  | "neutral"
  | "unhappy"
  | "angry"
  | "hit" // combat impact
  | "monsterDeath"
  | "dayTransition" // night falls
  | "gameOver"
  | "levelUp" // shop expansion / milestone
  | "encounter"; // strip beat: a monster steps into the party's path (spec V2.9, issue #95)

export type Voice = "metal" | "wood" | "bell" | "pad" | "noise";

export interface SfxDef {
  voice: Voice;
  /** Notes to play in order; a single note is just one entry. */
  notes: string[];
  /** Seconds between notes when there is more than one. */
  gap?: number;
  duration?: string;
  /** Relative level, 0-1, before the master volume. */
  gain?: number;
}

export const SFX: Record<SfxName, SfxDef> = {
  // Short metallic ping — the sound the whole economy runs on.
  coin: { voice: "metal", notes: ["C7"], duration: "32n", gain: 0.5 },
  thud: { voice: "wood", notes: ["G2"], duration: "16n", gain: 0.4 },
  door: { voice: "bell", notes: ["G5", "C6"], gap: 0.09, duration: "8n", gain: 0.35 },

  // Reactions: the shape of the interval carries the verdict.
  happy: { voice: "bell", notes: ["C6", "E6", "G6"], gap: 0.06, duration: "16n", gain: 0.4 },
  neutral: { voice: "bell", notes: ["E5", "E5"], gap: 0.12, duration: "16n", gain: 0.3 },
  unhappy: { voice: "wood", notes: ["A2", "F2"], gap: 0.1, duration: "8n", gain: 0.45 },
  angry: { voice: "wood", notes: ["C2", "B2"], gap: 0.0, duration: "8n", gain: 0.5 }, // minor 2nd, on purpose

  hit: { voice: "noise", notes: ["C2"], duration: "32n", gain: 0.5 },
  monsterDeath: { voice: "pad", notes: ["G4", "D4", "G3"], gap: 0.1, duration: "8n", gain: 0.4 },

  dayTransition: { voice: "pad", notes: ["C4", "G4", "A4"], gap: 0.5, duration: "2n", gain: 0.3 },
  gameOver: { voice: "pad", notes: ["A4", "F4", "D4", "A3"], gap: 0.45, duration: "2n", gain: 0.45 },
  levelUp: { voice: "bell", notes: ["C5", "E5", "G5", "C6"], gap: 0.08, duration: "16n", gain: 0.45 },

  // A short tick/clash — deliberately quieter and shorter than "hit" (a
  // per-swing combat impact); this one marks the strip's rarer "an
  // encounter just started" beat instead (spec V2.9, issue #95).
  encounter: { voice: "wood", notes: ["D3", "A2"], gap: 0.05, duration: "16n", gain: 0.35 },
};

/** Ambient beds (spec §9). Notes are picked from these in a slow loop. */
export const AMBIENCE = {
  town: {
    drone: "C2",
    scale: ["C4", "D4", "F4", "G4", "A4", "C5"], // warm pentatonic, tavern-ish
    everySeconds: 2.2,
    density: 0.6, // chance a beat actually plays a note
    gain: 0.16,
  },
  wilderness: {
    drone: "A1",
    scale: ["A3", "C4", "E4", "A4", "D4"], // sparser, wider, tenser
    everySeconds: 3.4,
    density: 0.35,
    gain: 0.14,
  },
  night: {
    drone: "F1",
    scale: ["C6", "D6"], // cricket-ish blips over the drone
    everySeconds: 2.8,
    density: 0.3,
    gain: 0.1,
  },
  // ---- Weather + evening beds (spec V2.9's audio pass, issue #95) ----
  // Same pad+drone architecture as every bed above — SoundManager.setAmbience
  // only ever runs ONE bed at a time (a single drone + a single note loop),
  // so these are alternative moods rather than a layer stacked under
  // "night"/"town"; useGameAudio.ts's ambienceFor() picks whichever one
  // wins for the current weather/phase. A true textured noise-patter rain
  // (using the NoiseSynth voice `hit` already reuses) was considered and
  // skipped — it would mean giving SoundManager a second concurrent voice
  // path for one subtle layer, a bigger surface change than this
  // presentation pass warrants; this reuses the existing pad/drone shape
  // instead, just tuned soft and busy for a rain-like patter.
  rain: {
    drone: "D2",
    scale: ["D4", "F4", "A4", "D5"], // soft, damp, narrow interval spread
    everySeconds: 1.1,
    density: 0.55,
    gain: 0.09,
  },
  // Low rumble, sparse — a storm reads as absence-of-melody as much as
  // presence-of-drone; the loop mostly stays silent (low density) so the
  // sub-bass drone itself carries the mood.
  storm: {
    drone: "D1",
    scale: ["D2", "A1"],
    everySeconds: 4.5,
    density: 0.2,
    gain: 0.15, // on par with every other bed's gain (0.09-0.16) — "low rumble," not a wall of sound
  },
  // Evening tavern hum: warmer/denser than the daytime "town" bed — the
  // town's one loud room, heard from outside.
  tavern: {
    drone: "G1",
    scale: ["G3", "B3", "D4", "G4", "B4"],
    everySeconds: 1.6,
    density: 0.7,
    gain: 0.13,
  },
} as const;

export type AmbienceKind = keyof typeof AMBIENCE;
