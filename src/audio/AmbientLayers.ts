import { clamp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// Ambient Layers — procedural per-era soundscapes layered over the soundtrack
//
// All sound is generated via Web Audio API oscillators and noise buffers.
// No external audio files are required.
//
// Signal topology per layer:
//   source → filter → gain → masterGain → ctx.destination
//
// The masterGain sits between all layers and the destination so a single mute
// toggle silences everything without touching per-layer gains (which continue
// to be written so crossfades stay in sync when unmuted).
// ---------------------------------------------------------------------------

/** Target gain and filter values for a given era, used for smooth transitions. */
interface EraAmbient {
  rumbleGain: number;
  rumbleFreq: number;
  windGain: number;
  windFilterFreq: number;
  crackleGain: number;
  waterGain: number;
  heartbeatActive: boolean; // only meaningful at progress > 0.95 in era 9
  tickRate: number; // ms between clock ticks (0 = silent)
}

// ---------------------------------------------------------------------------
// Per-era static targets
// ---------------------------------------------------------------------------
const ERA_AMBIENT: EraAmbient[] = [
  // 0: Big Bang — deep sub-bass explosion, energy hiss
  { rumbleGain: 0.15, rumbleFreq: 40, windGain: 0, windFilterFreq: 2000, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 0 },
  // 1: Particle Soup — warm plasma hiss, moderate rumble
  { rumbleGain: 0.10, rumbleFreq: 40, windGain: 0.06, windFilterFreq: 800, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 2: CMB — subtle cosmic hiss, light rumble
  { rumbleGain: 0.05, rumbleFreq: 35, windGain: 0.04, windFilterFreq: 500, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 3: Dark Ages — oppressive silence; faintest sub-Hz drone
  { rumbleGain: 0.01, rumbleFreq: 20, windGain: 0.01, windFilterFreq: 120, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 0 },
  // 4: First Stars — cosmic dawn, wind grows
  { rumbleGain: 0.04, rumbleFreq: 35, windGain: 0.04, windFilterFreq: 600, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 5: Galaxy Formation — sweeping, majestic
  { rumbleGain: 0.08, rumbleFreq: 45, windGain: 0.05, windFilterFreq: 1200, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 6: Solar System — gravitational hum
  { rumbleGain: 0.06, rumbleFreq: 38, windGain: 0.04, windFilterFreq: 900, crackleGain: 0, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 7: Earth Formation — magma crackle, seismic rumble
  { rumbleGain: 0.12, rumbleFreq: 30, windGain: 0.02, windFilterFreq: 400, crackleGain: 0.12, waterGain: 0, heartbeatActive: false, tickRate: 2000 },
  // 8: Oceans — waves swell in, crackle fades
  { rumbleGain: 0.04, rumbleFreq: 35, windGain: 0.03, windFilterFreq: 600, crackleGain: 0, waterGain: 0.15, heartbeatActive: false, tickRate: 2000 },
  // 9: Complex Life — gentle organic soundscape, heartbeat near the end
  { rumbleGain: 0.03, rumbleFreq: 32, windGain: 0.04, windFilterFreq: 700, crackleGain: 0, waterGain: 0.05, heartbeatActive: true, tickRate: 500 },
];

export class AmbientLayers {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private started = false;
  private disposed = false;

  // Rumble — deep sub-frequency sine oscillator
  private rumbleOsc!: OscillatorNode;
  private rumbleGain!: GainNode;

  // Wind / space hiss — bandpass-filtered white noise
  private windNoise!: AudioBufferSourceNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;

  // Crackle — high-passed, amplitude-modulated noise for fire/magma
  private crackleNoise!: AudioBufferSourceNode;
  private crackleGain!: GainNode;
  private crackleFilter!: BiquadFilterNode;
  private crackleModOsc!: OscillatorNode; // amplitude modulator ~4–12 Hz

  // Water / ocean — lowpass-filtered noise with slow LFO
  private waterNoise!: AudioBufferSourceNode;
  private waterGain!: GainNode;
  private waterFilter!: BiquadFilterNode;
  private waterModOsc!: OscillatorNode; // slow swell ~0.3 Hz

  // Heartbeat — 50 Hz sine with periodic gain envelope
  private heartbeatOsc!: OscillatorNode;
  private heartbeatGain!: GainNode;
  private heartbeatTimer: number = -1;

  // Cosmic clock tick
  private tickGain!: GainNode;
  private tickNoiseSource: AudioBufferSourceNode | null = null;
  private tickInterval: number = -1;

  // Doppler whoosh — spatialized particle rush during Era 0
  private whooshTimer: number = -1;
  private whooshRunning = false;

  private muted = false;
  private heartbeatRunning = false;
  private currentTickRate = 0;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(existingCtx?: AudioContext): Promise<void> {
    if (this.started || this.disposed) return;

    this.ctx = existingCtx ?? new AudioContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this.buildGraph();
    this.started = true;
  }

  private buildGraph(): void {
    const ctx = this.ctx!;

    // Master gain for the entire ambient layer (mute control lives here)
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.6; // ambient sits a bit below soundtrack
    this.masterGain.connect(ctx.destination);

    // --- Rumble ---
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumbleGain.connect(this.masterGain);

    this.rumbleOsc = ctx.createOscillator();
    this.rumbleOsc.type = 'sine';
    this.rumbleOsc.frequency.value = 40;
    this.rumbleOsc.connect(this.rumbleGain);
    this.rumbleOsc.start();

    // --- Wind / space hiss ---
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windGain.connect(this.masterGain);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 1000;
    this.windFilter.Q.value = 0.8;
    this.windFilter.connect(this.windGain);

    this.windNoise = this.createNoiseSource(8);
    this.windNoise.connect(this.windFilter);
    this.windNoise.start();

    // --- Crackle / fire / magma ---
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackleGain.connect(this.masterGain);

    this.crackleFilter = ctx.createBiquadFilter();
    this.crackleFilter.type = 'highpass';
    this.crackleFilter.frequency.value = 800;
    this.crackleFilter.Q.value = 0.5;
    this.crackleFilter.connect(this.crackleGain);

    this.crackleNoise = this.createNoiseSource(4);
    this.crackleNoise.connect(this.crackleFilter);
    this.crackleNoise.start();

    // Amplitude modulator gives the organic crackle irregularity
    this.crackleModOsc = ctx.createOscillator();
    this.crackleModOsc.type = 'sawtooth';
    this.crackleModOsc.frequency.value = 7; // ~7 Hz sputtering
    // Route mod osc into crackle gain's gain parameter (ring-mod style)
    const crackleModGain = ctx.createGain();
    crackleModGain.gain.value = 0.5;
    this.crackleModOsc.connect(crackleModGain);
    crackleModGain.connect(this.crackleFilter.frequency); // wobble the filter cutoff
    this.crackleModOsc.start();

    // --- Water / ocean ---
    this.waterGain = ctx.createGain();
    this.waterGain.gain.value = 0;
    this.waterGain.connect(this.masterGain);

    this.waterFilter = ctx.createBiquadFilter();
    this.waterFilter.type = 'lowpass';
    this.waterFilter.frequency.value = 1200;
    this.waterFilter.Q.value = 1.2;
    this.waterFilter.connect(this.waterGain);

    this.waterNoise = this.createNoiseSource(12);
    this.waterNoise.connect(this.waterFilter);
    this.waterNoise.start();

    // Slow LFO for wave swell effect — modulates filter cutoff
    this.waterModOsc = ctx.createOscillator();
    this.waterModOsc.type = 'sine';
    this.waterModOsc.frequency.value = 0.28; // ~one swell every 3.5 s
    const waterModDepth = ctx.createGain();
    waterModDepth.gain.value = 400; // ±400 Hz sweep around 1200 Hz
    this.waterModOsc.connect(waterModDepth);
    waterModDepth.connect(this.waterFilter.frequency);
    this.waterModOsc.start();

    // --- Heartbeat ---
    this.heartbeatGain = ctx.createGain();
    this.heartbeatGain.gain.value = 0;
    this.heartbeatGain.connect(this.masterGain);

    this.heartbeatOsc = ctx.createOscillator();
    this.heartbeatOsc.type = 'sine';
    this.heartbeatOsc.frequency.value = 50;
    this.heartbeatOsc.connect(this.heartbeatGain);
    this.heartbeatOsc.start();

    // --- Tick / cosmic clock ---
    this.tickGain = ctx.createGain();
    this.tickGain.gain.value = 0;
    this.tickGain.connect(this.masterGain);
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(progress: number, eraIndex: number): void {
    if (!this.started || !this.ctx || this.disposed) return;

    const now = this.ctx.currentTime;
    const era = clamp(eraIndex, 0, ERA_AMBIENT.length - 1);
    const target = ERA_AMBIENT[era];
    const ramp = 1.0; // seconds for setTargetAtTime

    // --- Within-era dynamic adjustments ---
    let rumbleGain = target.rumbleGain;
    let windGain = target.windGain;
    let heartbeatGain = 0;
    let waterGain = target.waterGain;

    if (era === 0) {
      // Big Bang: rumble pulses with the detonation — local progress 0–0.08
      const localP = smoothstep(0, 0.08, progress);
      rumbleGain = 0.06 + localP * 0.09; // 0.06 → 0.15

      // Doppler whoosh: particles rushing past the observer
      if (!this.whooshRunning) {
        this.whooshRunning = true;
        this.startWhooshes();
      }
    } else {
      // Stop whooshes as soon as we leave Era 0
      if (this.whooshRunning) {
        this.whooshRunning = false;
        this.stopWhooshes();
      }
    }

    if (era === 4) {
      // First Stars: ambient gradually opens as light returns
      const localP = smoothstep(0.33, 0.43, progress);
      windGain = 0.02 + localP * 0.04; // 0.02 → 0.06
      rumbleGain = 0.02 + localP * 0.02; // 0.02 → 0.04
    } else if (era === 8) {
      // Oceans: water fades in across the whole era (0.79–0.89 are era 8 bounds)
      const localP = smoothstep(0.79, 0.89, progress);
      waterGain = localP * 0.15; // 0 → 0.15
    } else if (era === 9) {
      // Heartbeat appears when the journey is almost done
      if (progress > 0.95) {
        const t = smoothstep(0.95, 1.0, progress);
        heartbeatGain = t * 0.1;
      }
      // Water gently retreats
      const localP = smoothstep(0.89, 0.95, progress);
      waterGain = 0.15 * (1 - localP * 0.67); // 0.15 → 0.05
    }

    // Apply if not muted (gains still track so crossfades are seamless on unmute)
    const mul = this.muted ? 0 : 1;

    this.rumbleGain.gain.setTargetAtTime(rumbleGain * mul, now, ramp);
    this.rumbleOsc.frequency.setTargetAtTime(target.rumbleFreq, now, ramp * 2);

    this.windGain.gain.setTargetAtTime(windGain * mul, now, ramp);
    this.windFilter.frequency.setTargetAtTime(target.windFilterFreq, now, ramp);

    this.crackleGain.gain.setTargetAtTime(target.crackleGain * mul, now, ramp);

    this.waterGain.gain.setTargetAtTime(waterGain * mul, now, ramp);

    // Heartbeat gain is driven by the scheduled pulse envelope, not setTargetAtTime,
    // but we control whether pulsing is active here.
    this.updateHeartbeat(heartbeatGain);

    // Tick
    this.updateTick(target.tickRate);
  }

  // ---------------------------------------------------------------------------
  // Doppler whoosh — Era 0 (Big Bang)
  // ---------------------------------------------------------------------------

  private startWhooshes(): void {
    const scheduleNext = () => {
      if (this.disposed || !this.ctx || !this.whooshRunning) return;

      const ctx = this.ctx;
      const now = ctx.currentTime;

      // Random direction: left-to-right or right-to-left
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Oscillator with pitch sweep (Doppler: approaching = higher, receding = lower)
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const baseFreq = 200 + Math.random() * 200;
      osc.frequency.setValueAtTime(baseFreq * 1.5, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.5, now + 0.6);

      // Stereo pan sweep left-to-right or right-to-left
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(-direction, now);
      panner.pan.linearRampToValueAtTime(direction, now + 0.6);

      // Amplitude envelope: quick fade-in, exponential decay
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(0.018, now + 0.1);
      env.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

      osc.connect(env);
      env.connect(panner);
      panner.connect(this.masterGain);

      osc.start(now);
      osc.stop(now + 0.7);

      // Schedule next whoosh at a random interval (800–1500 ms)
      const delay = 800 + Math.random() * 700;
      this.whooshTimer = window.setTimeout(scheduleNext, delay);
    };

    scheduleNext();
  }

  private stopWhooshes(): void {
    if (this.whooshTimer >= 0) {
      clearTimeout(this.whooshTimer);
      this.whooshTimer = -1;
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private updateHeartbeat(targetGainCeiling: number): void {
    if (targetGainCeiling > 0.01) {
      if (!this.heartbeatRunning) {
        this.heartbeatRunning = true;
        this.pulseHeartbeat();
      }
    } else {
      if (this.heartbeatRunning) {
        this.heartbeatRunning = false;
        clearTimeout(this.heartbeatTimer);
        this.heartbeatTimer = -1;
        if (this.ctx) {
          this.heartbeatGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
        }
      }
    }
  }

  private pulseHeartbeat(): void {
    if (!this.ctx || this.disposed || !this.heartbeatRunning) return;

    const now = this.ctx.currentTime;
    const g = this.heartbeatGain.gain;

    const mul = this.muted ? 0 : 1;

    // "lub" — first stronger beat
    g.setTargetAtTime(0.12 * mul, now, 0.02);
    g.setTargetAtTime(0.0, now + 0.08, 0.03);
    // "dub" — softer echo beat ~250 ms later
    g.setTargetAtTime(0.08 * mul, now + 0.25, 0.02);
    g.setTargetAtTime(0.0, now + 0.33, 0.05);

    // 72 BPM → one beat every 833 ms
    this.heartbeatTimer = window.setTimeout(() => this.pulseHeartbeat(), 833);
  }

  // ---------------------------------------------------------------------------
  // Cosmic clock tick
  // ---------------------------------------------------------------------------

  private updateTick(rateMs: number): void {
    // If the rate is unchanged, nothing to do
    if (rateMs === this.currentTickRate) return;
    this.currentTickRate = rateMs;

    // Clear existing interval
    if (this.tickInterval !== -1) {
      clearInterval(this.tickInterval);
      this.tickInterval = -1;
    }

    if (rateMs <= 0 || !this.ctx) return;

    // Schedule recurring ticks
    this.tickInterval = window.setInterval(() => {
      this.fireTick();
    }, rateMs);
  }

  private fireTick(): void {
    if (!this.ctx || this.disposed || this.muted) return;

    const now = this.ctx.currentTime;
    const tickBuf = this.createNoise(0.04); // 40 ms of noise
    const src = this.ctx.createBufferSource();
    src.buffer = tickBuf;

    // Narrow highpass to give the tick a sharp, metallic click
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.06, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    src.connect(hp);
    hp.connect(g);
    g.connect(this.masterGain);

    src.start(now);
    src.stop(now + 0.05);
  }

  // ---------------------------------------------------------------------------
  // Mute toggle
  // ---------------------------------------------------------------------------

  toggleMute(): void {
    this.muted = !this.muted;
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    // Drive master gain; per-layer gains keep tracking so crossfades remain correct
    this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.6, now, 0.3);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  // ---------------------------------------------------------------------------
  // Noise helpers
  // ---------------------------------------------------------------------------

  /**
   * Create a looping AudioBufferSourceNode filled with white noise.
   * The buffer length sets how long before the random pattern repeats —
   * longer durations prevent audible looping artifacts.
   */
  private createNoiseSource(duration: number): AudioBufferSourceNode {
    const buf = this.createNoise(duration);
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  private createNoise(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ---------------------------------------------------------------------------
  // Teardown
  // ---------------------------------------------------------------------------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    clearTimeout(this.heartbeatTimer);
    this.whooshRunning = false;
    this.stopWhooshes();
    if (this.tickInterval !== -1) clearInterval(this.tickInterval);

    try {
      this.rumbleOsc.stop();
      this.windNoise.stop();
      this.crackleNoise.stop();
      this.crackleModOsc.stop();
      this.waterNoise.stop();
      this.waterModOsc.stop();
      this.heartbeatOsc.stop();
    } catch {
      // Nodes may already be stopped — safe to ignore
    }

    // Only close the context if we created it ourselves.
    // If an external context was passed in (shared with AudioEngine) we must
    // NOT close it here — AudioEngine.dispose() owns that lifecycle.
  }
}
