// Tone.js sound system (spec §9). No audio files: voices are synthesised once
// on first use and reused for every effect after that.
//
// Two browser realities shape this module:
//  1. An AudioContext can't start until the player interacts with the page, so
//     everything is lazy — nothing is created until the first gesture.
//  2. Tone is a heavy dependency, so it is imported dynamically and never
//     lands in the initial bundle for a player who has audio muted.
//
// Sound must never be load-bearing: every call here is safe to make before the
// system is ready, and simply does nothing.

import { AMBIENCE, SFX, type AmbienceKind, type SfxName, type Voice } from "./SFX";

type Tone = typeof import("tone");

const MUTE_KEY = "wdsa_muted_v1";
const DEFAULT_VOLUME = 0.3; // spec §9: start at 30%

class SoundManager {
  private tone: Tone | null = null;
  private starting: Promise<void> | null = null;
  private voices: Partial<Record<Voice, { triggerAttackRelease: (...args: unknown[]) => void }>> = {};
  private ambience: { kind: AmbienceKind; loop: { dispose: () => void }; drone: { dispose: () => void } } | null =
    null;
  private muted = readMuted();
  private volume = DEFAULT_VOLUME;
  private pendingAmbience: AmbienceKind | null = null;

  get isMuted() {
    return this.muted;
  }

  get isReady() {
    return this.tone !== null;
  }

  /**
   * Boot the audio context. Safe to call repeatedly; only the first call after
   * a real user gesture does anything.
   */
  async start(): Promise<void> {
    if (this.tone || this.muted) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      try {
        const tone = await import("tone");
        await tone.start();
        this.tone = tone;
        this.buildVoices(tone);
        this.applyVolume();
        if (this.pendingAmbience) this.setAmbience(this.pendingAmbience);
      } catch {
        this.tone = null; // audio unavailable — the game plays on in silence
      } finally {
        this.starting = null;
      }
    })();
    return this.starting;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // preference just won't persist
    }
    if (muted) {
      this.stopAmbience();
      if (this.tone) this.tone.getDestination().mute = true;
    } else if (this.tone) {
      this.tone.getDestination().mute = false;
      if (this.pendingAmbience) this.setAmbience(this.pendingAmbience);
    } else {
      void this.start();
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  /** Fire a one-shot effect. No-op until the context is running. */
  play(name: SfxName): void {
    const tone = this.tone;
    if (!tone || this.muted) return;
    const def = SFX[name];
    const voice = this.voices[def.voice];
    if (!voice) return;
    const now = tone.now();
    def.notes.forEach((note, i) => {
      const at = now + i * (def.gap ?? 0);
      try {
        if (def.voice === "noise") voice.triggerAttackRelease(def.duration ?? "16n", at);
        else voice.triggerAttackRelease(note, def.duration ?? "16n", at);
      } catch {
        // overlapping triggers on a mono voice: dropping the note is fine
      }
    });
  }

  /** Swap the ambient bed. Remembers the request if audio isn't up yet. */
  setAmbience(kind: AmbienceKind): void {
    this.pendingAmbience = kind;
    const tone = this.tone;
    if (!tone || this.muted) return;
    if (this.ambience?.kind === kind) return;
    this.stopAmbience();

    const bed = AMBIENCE[kind];
    const pad = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.6, decay: 0.4, sustain: 0.2, release: 1.6 },
    }).toDestination();
    pad.volume.value = tone.gainToDb(bed.gain);

    const drone = new tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 2, decay: 0, sustain: 1, release: 3 },
    }).toDestination();
    drone.volume.value = tone.gainToDb(bed.gain * 0.7);
    drone.triggerAttack(bed.drone);

    let step = 0;
    const loop = new tone.Loop((time: number) => {
      // Deterministic-ish wander through the scale so the loop varies without
      // ever landing on a wrong note.
      step += 1;
      if (Math.random() > bed.density) return;
      const note = bed.scale[(step * 3) % bed.scale.length];
      pad.triggerAttackRelease(note, "2n", time);
    }, bed.everySeconds).start(0);

    tone.getTransport().start();
    this.ambience = {
      kind,
      loop: { dispose: () => { loop.dispose(); pad.dispose(); } },
      drone: { dispose: () => { drone.triggerRelease(); setTimeout(() => drone.dispose(), 3000); } },
    };
  }

  stopAmbience(): void {
    this.ambience?.loop.dispose();
    this.ambience?.drone.dispose();
    this.ambience = null;
  }

  private applyVolume(): void {
    if (!this.tone) return;
    const dest = this.tone.getDestination();
    dest.volume.value = this.tone.gainToDb(this.volume);
    dest.mute = this.muted;
  }

  private buildVoices(tone: Tone): void {
    this.voices.metal = new tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.12, release: 0.02 },
      harmonicity: 6,
      resonance: 3000,
    }).toDestination() as never;
    this.voices.wood = new tone.MembraneSynth({
      envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.2 },
    }).toDestination() as never;
    this.voices.bell = new tone.PolySynth(tone.FMSynth, {
      envelope: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.4 },
      modulationIndex: 8,
    }).toDestination() as never;
    this.voices.pad = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.15, decay: 0.3, sustain: 0.3, release: 1.2 },
    }).toDestination() as never;
    this.voices.noise = new tone.NoiseSynth({
      noise: { type: "brown" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
    }).toDestination() as never;
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** One shared instance: the audio context is a per-page resource. */
export const sound = new SoundManager();
