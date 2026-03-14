import { clamp, lerp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// Audio Engine — plays the soundtrack file with per-era dynamic mixing
//
// Uses Web Audio API to route the track through filters and gain nodes
// so the music responds to the scroll position and era transitions.
// ---------------------------------------------------------------------------

/** Per-era mix profiles. */
interface EraMix {
  volume: number;      // 0-1 base volume
  lowpass: number;     // Hz — filter cutoff (lower = more muffled)
  highpass: number;    // Hz — rumble control
  reverbMix: number;   // 0-1 reverb send
}

const ERA_MIXES: EraMix[] = [
  // 0: Big Bang — muffled at start, opens wide on detonation
  { volume: 0.7, lowpass: 600, highpass: 20, reverbMix: 0.4 },
  // 1: Particle Soup — warm, slightly filtered
  { volume: 0.75, lowpass: 3000, highpass: 30, reverbMix: 0.35 },
  // 2: CMB — open, ethereal
  { volume: 0.7, lowpass: 6000, highpass: 40, reverbMix: 0.45 },
  // 3: Dark Ages — quiet, deeply muffled, oppressive
  { volume: 0.35, lowpass: 800, highpass: 20, reverbMix: 0.6 },
  // 4: First Stars — swells open, emotional peak
  { volume: 0.85, lowpass: 8000, highpass: 30, reverbMix: 0.4 },
  // 5: Galaxy Formation — full, majestic
  { volume: 0.8, lowpass: 10000, highpass: 30, reverbMix: 0.3 },
  // 6: Solar System — warm, grounded
  { volume: 0.75, lowpass: 6000, highpass: 40, reverbMix: 0.3 },
  // 7: Earth Formation — powerful low end
  { volume: 0.75, lowpass: 5000, highpass: 20, reverbMix: 0.35 },
  // 8: Oceans — fluid, shimmering
  { volume: 0.7, lowpass: 8000, highpass: 50, reverbMix: 0.5 },
  // 9: Complex Life — fully open, crescendo
  { volume: 0.9, lowpass: 14000, highpass: 20, reverbMix: 0.35 },
];

/** Create a simple convolution reverb impulse response. */
function createReverbIR(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = rate * duration;
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-(i / rate) * decay);
    }
  }
  return buffer;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private started = false;
  private disposed = false;

  // Audio element + source
  private audio: HTMLAudioElement;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  // Signal chain
  private masterGain!: GainNode;
  private lowpass!: BiquadFilterNode;
  private highpass!: BiquadFilterNode;
  private dryGain!: GainNode;
  private reverbSend!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;

  private muted = false;
  private currentEra = -1;

  constructor() {
    this.audio = new Audio('/soundtrack.webm');
    this.audio.loop = true;
    this.audio.preload = 'auto';
    this.audio.volume = 1; // volume controlled via Web Audio gain
  }

  async start(): Promise<void> {
    if (this.started || this.disposed) return;

    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.buildGraph();
    this.started = true;

    try {
      await this.audio.play();
    } catch (e) {
      // Will retry on next user gesture
      console.warn('Audio play deferred:', e);
    }
  }

  private buildGraph(): void {
    const ctx = this.ctx!;

    // Source from HTML audio element
    this.sourceNode = ctx.createMediaElementSource(this.audio);

    // Master gain
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0;
    this.masterGain.connect(ctx.destination);

    // Filters
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 4000;
    this.lowpass.Q.value = 0.7;

    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 20;
    this.highpass.Q.value = 0.5;

    // Dry path
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.75;

    // Reverb path
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = createReverbIR(ctx, 3.5, 2.0);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;

    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;

    // Signal chain: source → highpass → lowpass → (dry + reverb send) → master
    this.sourceNode.connect(this.highpass);
    this.highpass.connect(this.lowpass);

    // Dry
    this.lowpass.connect(this.dryGain);
    this.dryGain.connect(this.masterGain);

    // Reverb
    this.lowpass.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.reverbReturn);
    this.reverbReturn.connect(this.masterGain);

    // Fade in over 3 seconds
    this.masterGain.gain.setTargetAtTime(0.7, ctx.currentTime, 1.5);
  }

  /**
   * Called every frame.
   * Smoothly adjusts filter/volume based on current era and progress.
   */
  update(progress: number, eraIndex: number): void {
    if (!this.started || !this.ctx || this.muted) return;

    const now = this.ctx.currentTime;
    const era = clamp(eraIndex, 0, ERA_MIXES.length - 1);
    const mix = ERA_MIXES[era];

    // Smooth transitions between era mixes
    const rampTime = 0.8;

    // --- Volume ---
    // Special cases within eras
    let vol = mix.volume;
    if (era === 0) {
      // Big Bang: quiet in the void, swells with detonation
      const localP = progress / 0.08;
      vol = localP < 0.04 / 0.08
        ? lerp(0.3, 0.9, smoothstep(0, 0.04 / 0.08, localP)) // pre-detonation to flash
        : lerp(0.9, 0.7, smoothstep(0.1 / 0.08, 1, localP));
    } else if (era === 3) {
      // Dark Ages: drops to near silence
      vol = lerp(0.4, 0.2, smoothstep(0, 0.5, (progress - 0.23) / 0.10));
    } else if (era === 4) {
      // First Stars: dramatic swell as light returns
      vol = lerp(0.3, 0.9, smoothstep(0, 0.4, (progress - 0.33) / 0.10));
    } else if (era === 9) {
      // Final era: crescendo toward the end
      vol = lerp(0.8, 1.0, smoothstep(0.5, 1.0, (progress - 0.89) / 0.11));
    }
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : vol, now, rampTime);

    // --- Lowpass filter ---
    let lp = mix.lowpass;
    if (era === 0) {
      // Opens dramatically with the detonation
      const localP = progress / 0.08;
      lp = lerp(400, 6000, smoothstep(0, 0.5, localP));
    } else if (era === 3) {
      // Deeply muffled
      lp = lerp(800, 500, smoothstep(0, 0.5, (progress - 0.23) / 0.10));
    } else if (era === 4) {
      // Opens with star ignitions
      lp = lerp(1000, 10000, smoothstep(0, 0.5, (progress - 0.33) / 0.10));
    }
    this.lowpass.frequency.setTargetAtTime(lp, now, rampTime);

    // --- Highpass ---
    this.highpass.frequency.setTargetAtTime(mix.highpass, now, rampTime);

    // --- Reverb send ---
    this.reverbSend.gain.setTargetAtTime(mix.reverbMix, now, rampTime);
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.7, now, 0.3);

    if (this.muted) {
      this.audio.pause();
    } else {
      this.audio.play().catch(() => {});
    }
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get isStarted(): boolean {
    return this.started;
  }

  getContext(): AudioContext | null {
    return this.ctx;
  }

  dispose(): void {
    this.disposed = true;
    this.audio.pause();
    this.audio.src = '';
    this.sourceNode?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
