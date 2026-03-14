import { clamp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// Voiceover narration system
// ---------------------------------------------------------------------------

interface NarrationEntry {
  eraIndex: number;
  file: string;
  triggerAt: number;
  /** Optional: seconds into the narration to fire a cue event. */
  cueAt?: number;
  cueId?: string;
}

const NARRATIONS: NarrationEntry[] = [
  {
    eraIndex: 0, file: '/vo/00-bigbang.mp3', triggerAt: 0.02,
    cueAt: 7.8, cueId: 'bigbang-detonate', // right AFTER "And then, it erupted."
  },
  { eraIndex: 1, file: '/vo/01-quarksoup.mp3', triggerAt: 0.1 },
  { eraIndex: 2, file: '/vo/02-cmb.mp3', triggerAt: 0.1 },
  { eraIndex: 3, file: '/vo/03-darkages.mp3', triggerAt: 0.08 },
  { eraIndex: 4, file: '/vo/04-firststars.mp3', triggerAt: 0.1 },
  { eraIndex: 5, file: '/vo/05-galaxies.mp3', triggerAt: 0.1 },
  { eraIndex: 6, file: '/vo/06-solarsystem.mp3', triggerAt: 0.1 },
  { eraIndex: 7, file: '/vo/07-earth.mp3', triggerAt: 0.1 },
  { eraIndex: 8, file: '/vo/08-oceans.mp3', triggerAt: 0.1 },
  { eraIndex: 9, file: '/vo/09-life.mp3', triggerAt: 0.1 },
];

export class Narration {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private started = false;
  private muted = false;

  private currentAudio: HTMLAudioElement | null = null;
  private currentSource: MediaElementAudioSourceNode | null = null;
  private currentEra: number = -1;
  private playedEras: Set<number> = new Set();
  private eraTriggered: Set<number> = new Set();
  private firedCues: Set<string> = new Set();
  private cueTimer: ReturnType<typeof setTimeout> | null = null;

  private onDuckChange: ((ducked: boolean) => void) | null = null;
  private cueCallbacks: Map<string, () => void> = new Map();

  // Explosion sound
  private explosionAudio: HTMLAudioElement | null = null;
  private explosionSource: MediaElementAudioSourceNode | null = null;
  private explosionGain: GainNode | null = null;

  async start(existingCtx?: AudioContext): Promise<void> {
    if (this.started) return;

    this.ctx = existingCtx ?? new AudioContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1.0;
    this.masterGain.connect(this.ctx.destination);

    // Preload explosion sound — routed through Web Audio for fade control
    this.explosionAudio = new Audio('/explosion.webm');
    this.explosionAudio.preload = 'auto';

    this.explosionGain = this.ctx.createGain();
    this.explosionGain.gain.value = 0.9;
    this.explosionGain.connect(this.ctx.destination); // direct to output, not through narration gain

    this.explosionSource = this.ctx.createMediaElementSource(this.explosionAudio);
    this.explosionSource.connect(this.explosionGain);

    this.started = true;
  }

  setDuckCallback(cb: (ducked: boolean) => void): void {
    this.onDuckChange = cb;
  }

  /** Register a callback for a named narration cue (e.g., 'bigbang-detonate'). */
  onCue(cueId: string, cb: () => void): void {
    this.cueCallbacks.set(cueId, cb);
  }

  update(eraIndex: number, eraProgress: number): void {
    if (!this.started || !this.ctx || this.muted) return;

    const entry = NARRATIONS.find(n => n.eraIndex === eraIndex);
    if (!entry) return;

    if (eraProgress >= entry.triggerAt && !this.eraTriggered.has(eraIndex)) {
      this.eraTriggered.add(eraIndex);
      if (!this.playedEras.has(eraIndex)) {
        this.playNarration(entry);
      }
    }

    if (this.currentEra !== eraIndex && this.currentAudio && !this.currentAudio.paused) {
      this.fadeOutCurrent();
    }
  }

  private playNarration(entry: NarrationEntry): void {
    this.stopCurrent();

    this.currentEra = entry.eraIndex;
    this.playedEras.add(entry.eraIndex);

    const audio = new Audio(entry.file);
    audio.crossOrigin = 'anonymous';
    this.currentAudio = audio;

    const source = this.ctx!.createMediaElementSource(audio);
    this.currentSource = source;

    const voGain = this.ctx!.createGain();
    voGain.gain.value = 0;
    source.connect(voGain);
    voGain.connect(this.masterGain);

    const now = this.ctx!.currentTime;
    voGain.gain.setTargetAtTime(1.0, now, 0.3);

    this.onDuckChange?.(true);

    // Schedule cue if this entry has one
    if (entry.cueAt && entry.cueId && !this.firedCues.has(entry.cueId)) {
      const cueId = entry.cueId;
      this.cueTimer = setTimeout(() => {
        if (!this.firedCues.has(cueId)) {
          this.firedCues.add(cueId);
          const cb = this.cueCallbacks.get(cueId);
          cb?.();

          // Play explosion with fade-out + procedural rumble tail
          if (cueId === 'bigbang-detonate') {
            this.playExplosion();
          }
        }
      }, entry.cueAt * 1000);
    }

    audio.addEventListener('ended', () => {
      this.onDuckChange?.(false);
      this.currentAudio = null;
      this.currentSource = null;
    });

    audio.addEventListener('error', () => {
      this.onDuckChange?.(false);
      this.currentAudio = null;
      this.currentSource = null;
    });

    audio.play().catch(() => {
      this.onDuckChange?.(false);
    });
  }

  /**
   * Play the explosion clip with a smooth fade-out before it ends,
   * plus a layered procedural sub-bass rumble tail that sustains and
   * decays naturally over several seconds.
   */
  private playExplosion(): void {
    if (!this.ctx || !this.explosionAudio || !this.explosionGain) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const audio = this.explosionAudio;

    // Reset and play the clip
    audio.currentTime = 0;
    this.explosionGain.gain.setValueAtTime(0.9, now);

    // Fade out the clip over its last 1.5 seconds to avoid the hard cut.
    // The clip is short (~3-4s), so start fading around 2s in.
    const fadeStart = 1.5; // seconds into clip
    const fadeDuration = 2.0;

    // Schedule the gain ramp
    this.explosionGain.gain.setValueAtTime(0.9, now + fadeStart);
    this.explosionGain.gain.exponentialRampToValueAtTime(0.001, now + fadeStart + fadeDuration);

    audio.play().catch(() => {});

    // --- Procedural rumble tail ---
    // Layer a deep sub-bass boom + mid-frequency roar that sustains
    // well beyond the clip, giving a cinematic "the explosion echoes
    // through the cosmos" feeling.

    // Sub-bass boom (30Hz sine)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(50, now);
    subOsc.frequency.exponentialRampToValueAtTime(20, now + 5); // pitch drops

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.25, now);
    subGain.gain.setValueAtTime(0.25, now + 0.5);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 6); // 6 second tail

    subOsc.connect(subGain);
    subGain.connect(ctx.destination);
    subOsc.start(now);
    subOsc.stop(now + 6.5);

    // Mid-frequency rumble (noise burst through lowpass, decaying)
    const noiseLen = ctx.sampleRate * 5;
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      noiseData[i] = (Math.random() * 2 - 1);
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuf;

    const noiseLp = ctx.createBiquadFilter();
    noiseLp.type = 'lowpass';
    noiseLp.frequency.setValueAtTime(300, now);
    noiseLp.frequency.exponentialRampToValueAtTime(40, now + 5);
    noiseLp.Q.value = 1.0;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.setValueAtTime(0.12, now + 0.3);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 5);

    noiseSource.connect(noiseLp);
    noiseLp.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start(now);
    noiseSource.stop(now + 5.5);

    // Impact transient — sharp attack click
    const clickOsc = ctx.createOscillator();
    clickOsc.type = 'square';
    clickOsc.frequency.value = 80;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.3, now);
    clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.start(now);
    clickOsc.stop(now + 0.2);
  }

  private fadeOutCurrent(): void {
    if (!this.currentAudio || !this.ctx) return;

    const audio = this.currentAudio;
    this.onDuckChange?.(false);

    const fadeTime = 1.0;
    setTimeout(() => {
      if (audio === this.currentAudio) {
        audio.pause();
        this.currentAudio = null;
        this.currentSource = null;
      }
    }, fadeTime * 1000);

    const startVol = audio.volume;
    const steps = 20;
    const interval = (fadeTime * 1000) / steps;
    let step = 0;
    const fade = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) clearInterval(fade);
    }, interval);
  }

  private stopCurrent(): void {
    if (this.cueTimer !== null) {
      clearTimeout(this.cueTimer);
      this.cueTimer = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    if (this.currentSource) {
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.onDuckChange?.(false);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1.0, this.ctx!.currentTime, 0.3);
    }
    if (this.muted) {
      this.stopCurrent();
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  reset(): void {
    this.playedEras.clear();
    this.eraTriggered.clear();
    this.firedCues.clear();
    this.stopCurrent();
  }

  dispose(): void {
    this.stopCurrent();
    if (this.explosionAudio) {
      this.explosionAudio.pause();
      this.explosionAudio = null;
    }
  }
}
