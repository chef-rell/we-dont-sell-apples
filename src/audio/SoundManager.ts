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
/** Level for an effect that declares no gain of its own. */
const DEFAULT_SFX_GAIN = 0.4;
/** Bed crossfade, seconds. Long enough to hide the seam, short enough that a
 *  weather change still reads as a change. */
const BED_FADE = 0.8;

class SoundManager {
  private tone: Tone | null = null;
  private starting: Promise<void> | null = null;
  private voices: Partial<Record<Voice, { triggerAttackRelease: (...args: unknown[]) => void }>> = {};
  /** One gain node per voice, sitting between the voice and the destination,
   *  so `SfxDef.gain` becomes an actual level instead of a dead field. */
  private trims: Partial<Record<Voice, { gain: { rampTo: (value: number, time: number) => void } }>> = {};
  private ambience: { kind: AmbienceKind; fadeOut: (seconds: number) => void } | null = null;
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
    // Each effect's own level (SfxDef.gain) rides on a per-effect gain node
    // rather than the voice itself: voices are shared between effects, so
    // setting the level on the voice would retune whatever is still ringing
    // (the coin's tail would jump when an "angry" wood hit followed it).
    const trim = this.trims[def.voice];
    if (trim) trim.gain.rampTo(def.gain ?? DEFAULT_SFX_GAIN, 0.005);
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

  /** Swap the ambient bed. Remembers the request if audio isn't up yet.
   *
   *  Beds crossfade rather than cut. The old bed used to be disposed the
   *  instant a new one was asked for, which chopped whatever pad note was
   *  sounding mid-envelope — audible as a click every time the weather or
   *  the phase changed, and those changes are exactly when the player is
   *  most likely to be listening. Now the outgoing bed rides its own gain
   *  node down over BED_FADE and is disposed after it lands silent, while
   *  the incoming one fades up over the same window. */
  setAmbience(kind: AmbienceKind): void {
    this.pendingAmbience = kind;
    const tone = this.tone;
    if (!tone || this.muted) return;
    if (this.ambience?.kind === kind) return;
    this.fadeOutAmbience(BED_FADE);

    const bed = AMBIENCE[kind];
    // The bed's own fader. Starts silent and comes up, so a bed that arrives
    // mid-drone-attack doesn't punch in at full level.
    const fade = new tone.Gain(0).toDestination();
    fade.gain.rampTo(1, BED_FADE);

    const pad = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.6, decay: 0.4, sustain: 0.2, release: 1.6 },
    }).connect(fade);
    pad.volume.value = tone.gainToDb(bed.gain);

    const drone = new tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 2, decay: 0, sustain: 1, release: 3 },
    }).connect(fade);
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
      fadeOut: (seconds: number) => {
        // Stop scheduling new notes immediately, let the sounding ones ride
        // the fader down, then tear the whole chain down together.
        loop.stop().dispose();
        drone.triggerRelease();
        fade.gain.rampTo(0, seconds);
        setTimeout(
          () => {
            pad.dispose();
            drone.dispose();
            fade.dispose();
          },
          seconds * 1000 + 200,
        );
      },
    };
  }

  /** Fade the current bed out and forget it. `seconds` of 0 still gets a very
   *  short ramp — a true instant cut is what produced the click. */
  private fadeOutAmbience(seconds: number): void {
    this.ambience?.fadeOut(Math.max(0.05, seconds));
    this.ambience = null;
  }

  stopAmbience(): void {
    this.fadeOutAmbience(BED_FADE);
  }

  private applyVolume(): void {
    if (!this.tone) return;
    const dest = this.tone.getDestination();
    dest.volume.value = this.tone.gainToDb(this.volume);
    dest.mute = this.muted;
  }

  private buildVoices(tone: Tone): void {
    // Each voice runs through its own trim gain; play() sets that trim from
    // the effect's declared level just before triggering.
    const trimmed = (voice: { connect: (node: never) => void }, name: Voice) => {
      const trim = new tone.Gain(DEFAULT_SFX_GAIN).toDestination();
      voice.connect(trim as never);
      this.trims[name] = trim as never;
      return voice as never;
    };

    this.voices.metal = trimmed(
      new tone.MetalSynth({
        envelope: { attack: 0.001, decay: 0.12, release: 0.02 },
        harmonicity: 6,
        resonance: 3000,
      }),
      "metal",
    );
    this.voices.wood = trimmed(
      new tone.MembraneSynth({
        envelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.2 },
      }),
      "wood",
    );
    this.voices.bell = trimmed(
      new tone.PolySynth(tone.FMSynth, {
        envelope: { attack: 0.005, decay: 0.25, sustain: 0, release: 0.4 },
        modulationIndex: 8,
      }),
      "bell",
    );
    this.voices.pad = trimmed(
      new tone.PolySynth(tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.15, decay: 0.3, sustain: 0.3, release: 1.2 },
      }),
      "pad",
    );
    this.voices.noise = trimmed(
      new tone.NoiseSynth({
        noise: { type: "brown" },
        envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
      }),
      "noise",
    );
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
