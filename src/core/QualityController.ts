const FPS_WINDOW_SECONDS = 3.0;
const FPS_DOWNGRADE_THRESHOLD = 45;
const DOWNGRADE_COOLDOWN_MS = 10_000; // 10 s between downgrades

export class QualityController {
  private tier: 1 | 2 | 3;
  private fpsHistory: number[] = [];
  private lastDowngrade: number = 0;
  private accumTime: number = 0;

  constructor(initialTier: 1 | 2 | 3) {
    this.tier = initialTier;
  }

  // ---------------------------------------------------------------------------
  // Per-frame update — pass frame delta in seconds
  // ---------------------------------------------------------------------------

  update(delta: number): void {
    if (delta <= 0) return;

    const fps = 1 / delta;
    this.fpsHistory.push(fps);
    this.accumTime += delta;

    // Keep only the last FPS_WINDOW_SECONDS worth of samples
    while (this.accumTime > FPS_WINDOW_SECONDS && this.fpsHistory.length > 1) {
      // Each sample represents roughly delta seconds; pop one off front
      this.accumTime -= 1 / this.fpsHistory[0];
      this.fpsHistory.shift();
    }

    // Evaluate average
    if (this.fpsHistory.length >= 30) {
      const avg = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;
      const now = performance.now();

      if (
        avg < FPS_DOWNGRADE_THRESHOLD &&
        this.tier < 3 &&
        now - this.lastDowngrade > DOWNGRADE_COOLDOWN_MS
      ) {
        this.tier = (this.tier + 1) as 1 | 2 | 3;
        this.lastDowngrade = now;
        this.fpsHistory = [];
        this.accumTime = 0;
        console.info(`[QualityController] Downgraded to tier ${this.tier} (avg FPS: ${avg.toFixed(1)})`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  getTier(): 1 | 2 | 3 {
    return this.tier;
  }

  /** Render resolution scale: tier 1 → 1.0, tier 2 → 0.75, tier 3 → 0.5 */
  getResolutionScale(): number {
    switch (this.tier) {
      case 1: return 1.0;
      case 2: return 0.75;
      case 3: return 0.5;
    }
  }

  /** Maximum particle count per system */
  getMaxParticles(): number {
    switch (this.tier) {
      case 1: return 1_000_000;
      case 2: return 500_000;
      case 3: return 100_000;
    }
  }

  /** Noise octaves for procedural textures/shaders */
  getNoiseOctaves(): number {
    switch (this.tier) {
      case 1: return 8;
      case 2: return 5;
      case 3: return 3;
    }
  }

  /** Whether to use volumetric lighting / god rays */
  shouldUseVolumetrics(): boolean {
    return this.tier <= 2;
  }
}
