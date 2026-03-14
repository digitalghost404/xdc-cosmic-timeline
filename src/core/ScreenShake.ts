import * as THREE from 'three';

// ---------------------------------------------------------------------------
// ScreenShake — trauma-based camera shake
//
// A "trauma" value (0-1) is accumulated when triggers fire. Each frame the
// trauma decays multiplicatively. The actual shake offset is proportional to
// trauma², which gives a natural feel: strong hits punch hard, then quickly
// calm to a gentle tremor before disappearing entirely.
// ---------------------------------------------------------------------------

export class ScreenShake {
  /** Current trauma level [0, 1]. Feeds the offset calculation. */
  private trauma: number = 0;

  /** Multiplied against trauma every frame: 0.9 = aggressive decay, 0.98 = long rumble. */
  private decay: number = 0.92;

  /** The current pixel-space shake offset applied to the camera. */
  private offset: THREE.Vector2 = new THREE.Vector2();

  /**
   * Stored baseline camera positions so we can restore them after each frame.
   * Without this the shake offsets would accumulate forever.
   */
  private baseX: number = 0;
  private baseY: number = 0;
  private baseZ: number = 0;

  /** Whether we've captured the baseline this frame. */
  private baselineCaptured: boolean = false;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Add trauma to trigger a shake.  Multiple simultaneous triggers are clamped
   * to 1 to avoid infinite amplification.
   *
   * @param intensity  Trauma amount to add (0 – 1). Typical values:
   *                     0.05 - gentle nudge (scrolling)
   *                     0.15 - moderate impact (Big Bang detonation)
   *                     0.30 - heavy impact (asteroid strike)
   * @param decay      Optional override for this trigger's decay rate.
   */
  trigger(intensity: number, decay?: number): void {
    this.trauma = Math.min(this.trauma + intensity, 1.0);
    if (decay !== undefined) {
      this.decay = decay;
    }
  }

  /**
   * Call once per frame BEFORE calling apply().
   * Decays trauma and computes the offset for this frame.
   *
   * @param delta  Frame time in seconds.
   */
  update(delta: number): void {
    if (this.trauma <= 0.0001) {
      this.trauma = 0;
      this.offset.set(0, 0);
      return;
    }

    // Decay — frame-rate independent
    this.trauma *= Math.pow(this.decay, delta * 60);
    if (this.trauma < 0.0001) this.trauma = 0;

    // Shake amount proportional to trauma² for perceptual linearity
    const shake = this.trauma * this.trauma;

    // Random offset scaled by shake magnitude
    // Multiply by a small world-unit scalar so the effect is subtle
    const scale = 0.35;
    this.offset.set(
      (Math.random() * 2 - 1) * shake * scale,
      (Math.random() * 2 - 1) * shake * scale,
    );
  }

  /**
   * Returns the current shake offset in world units.
   */
  getOffset(): THREE.Vector2 {
    return this.offset;
  }

  /**
   * Saves the camera's current position as the baseline, then adds the
   * shake offset to its X and Y.  Call restore() at the end of the frame
   * (or simply call apply() again next frame — the baseline is saved fresh
   * every call so drift cannot accumulate).
   *
   * @param camera  Any THREE.Camera; works best with PerspectiveCamera.
   */
  apply(camera: THREE.Camera): void {
    if (this.trauma <= 0) return;

    // Capture baseline only once per frame (before the first apply call)
    if (!this.baselineCaptured) {
      this.baseX = camera.position.x;
      this.baseY = camera.position.y;
      this.baseZ = camera.position.z;
      this.baselineCaptured = true;
    }

    camera.position.x = this.baseX + this.offset.x;
    camera.position.y = this.baseY + this.offset.y;
  }

  /**
   * Restore the camera to its pre-shake baseline.
   * Call this after rendering but before the next update/apply cycle.
   * This prevents shake from accumulating across frames.
   */
  restore(camera: THREE.Camera): void {
    if (!this.baselineCaptured) return;
    camera.position.x = this.baseX;
    camera.position.y = this.baseY;
    camera.position.z = this.baseZ;
    this.baselineCaptured = false;
  }

  /** True when a shake is actively in progress. */
  get isActive(): boolean {
    return this.trauma > 0.001;
  }
}
