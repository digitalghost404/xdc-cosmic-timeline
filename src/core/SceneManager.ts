import * as THREE from 'three';
import { BaseEra, PostConfig } from '../eras/BaseEra';
import { EraDefinition } from '../eras/EraRegistry';
import { clamp, inverseLerp, smoothstep } from '../utils/math';

export interface RenderState {
  scene: THREE.Scene;
  camera: THREE.Camera;
  postConfig: PostConfig;
  transitionScene?: THREE.Scene;
  transitionCamera?: THREE.Camera;
  transitionMix: number;
}

const CROSSFADE_ZONE = 0.15; // fraction of era duration for crossfade
const PRELOAD_AHEAD = 2;     // initialise this many eras ahead
const DISPOSE_BEHIND = 3;    // dispose eras this far behind

export class SceneManager {
  private eras: Map<number, BaseEra> = new Map();
  private activeEraIndex: number = 0;
  private transitionEraIndex: number = -1;
  private transitionMix: number = 0;
  private initPromises: Map<number, Promise<void>> = new Map();

  constructor(private eraDefinitions: EraDefinition[]) {}

  // ---------------------------------------------------------------------------
  // Init / dispose lifecycle
  // ---------------------------------------------------------------------------

  async initEra(index: number): Promise<void> {
    if (index < 0 || index >= this.eraDefinitions.length) return;
    if (this.eras.has(index)) return;

    // Deduplicate concurrent init requests
    const existing = this.initPromises.get(index);
    if (existing) return existing;

    const promise = (async () => {
      const def = this.eraDefinitions[index];
      const era = def.create();
      await era.init();
      this.eras.set(index, era);
    })();

    this.initPromises.set(index, promise);
    await promise;
    this.initPromises.delete(index);
  }

  private disposeEra(index: number): void {
    const era = this.eras.get(index);
    if (!era) return;
    era.deactivate();
    era.dispose();
    this.eras.delete(index);
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(progress: number, delta: number, globalTime: number): void {
    const newIndex = this.eraIndexFromProgress(progress);

    // Lazy preload eras ahead
    for (let i = 1; i <= PRELOAD_AHEAD; i++) {
      const ahead = newIndex + i;
      if (
        ahead < this.eraDefinitions.length &&
        !this.eras.has(ahead) &&
        !this.initPromises.has(ahead)
      ) {
        this.initEra(ahead).catch(console.error);
      }
    }

    // Dispose stale eras behind
    for (const idx of Array.from(this.eras.keys())) {
      if (idx < newIndex - DISPOSE_BEHIND) {
        this.disposeEra(idx);
      }
    }

    // Detect era change
    if (newIndex !== this.activeEraIndex) {
      const prev = this.eras.get(this.activeEraIndex);
      prev?.deactivate();
      this.activeEraIndex = newIndex;
      const next = this.eras.get(this.activeEraIndex);
      next?.activate();
    }

    // Determine if we're in a crossfade zone
    const activeDef = this.eraDefinitions[this.activeEraIndex];
    const eraLen = activeDef.scrollEnd - activeDef.scrollStart;
    const eraProgress = clamp(
      inverseLerp(activeDef.scrollStart, activeDef.scrollEnd, progress),
      0,
      1,
    );
    const fadeZoneFraction = CROSSFADE_ZONE;
    const crossfadeStart = 1 - fadeZoneFraction;

    if (eraProgress > crossfadeStart && this.activeEraIndex < this.eraDefinitions.length - 1) {
      const nextIndex = this.activeEraIndex + 1;
      this.transitionEraIndex = nextIndex;
      this.transitionMix = smoothstep(crossfadeStart, 1.0, eraProgress);

      // Ensure next era is loaded
      if (!this.eras.has(nextIndex) && !this.initPromises.has(nextIndex)) {
        this.initEra(nextIndex).catch(console.error);
      }
    } else {
      this.transitionEraIndex = -1;
      this.transitionMix = 0;
    }

    // Update active era
    const activeEra = this.eras.get(this.activeEraIndex);
    if (activeEra) {
      activeEra.update(eraProgress, delta, globalTime);
      activeEra.scene.background = activeEra.getBackgroundColor(eraProgress);
    }

    // Update transition era if present
    if (this.transitionEraIndex >= 0) {
      const transEra = this.eras.get(this.transitionEraIndex);
      if (transEra) {
        const transEraProgress = 0;
        transEra.update(transEraProgress, delta, globalTime);
        transEra.scene.background = transEra.getBackgroundColor(transEraProgress);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------------------

  getRenderState(): RenderState {
    const activeEra = this.eras.get(this.activeEraIndex);
    const activeDef = this.eraDefinitions[this.activeEraIndex];
    const eraLen = activeDef.scrollEnd - activeDef.scrollStart;

    // Fallback scene/camera if era not loaded yet
    const scene = activeEra?.scene ?? new THREE.Scene();
    const camera = activeEra?.camera ?? new THREE.PerspectiveCamera();

    const fallbackPostConfig: PostConfig = {
      bloomStrength: 0.8,
      bloomRadius: 0.5,
      bloomThreshold: 0.4,
      chromaticAberration: 0,
      filmGrain: 0.04,
      godRays: false,
      godRayIntensity: 0,
      vignetteStrength: 0.4,
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
    const postConfig: PostConfig =
      activeEra != null
        ? activeEra.getPostConfig(this.transitionMix > 0 ? 1 - this.transitionMix : 0)
        : fallbackPostConfig;

    const state: RenderState = {
      scene,
      camera,
      postConfig: postConfig as PostConfig,
      transitionMix: this.transitionMix,
    };

    if (this.transitionEraIndex >= 0) {
      const transEra = this.eras.get(this.transitionEraIndex);
      if (transEra) {
        state.transitionScene = transEra.scene;
        state.transitionCamera = transEra.camera;
      }
    }

    return state;
  }

  getCurrentEraDefinition(): EraDefinition {
    return this.eraDefinitions[this.activeEraIndex];
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private eraIndexFromProgress(progress: number): number {
    const p = clamp(progress, 0, 1);

    for (let i = 0; i < this.eraDefinitions.length; i++) {
      const def = this.eraDefinitions[i];
      // Last era captures up to 1.0 inclusive
      const end = i === this.eraDefinitions.length - 1 ? 1.0 + 1e-9 : def.scrollEnd;
      if (p >= def.scrollStart && p < end) {
        return i;
      }
    }

    return this.eraDefinitions.length - 1;
  }

  /** Get a loaded era instance by index (or null if not loaded). */
  getEra(index: number): BaseEra | null {
    return this.eras.get(index) ?? null;
  }

  dispose(): void {
    for (const idx of Array.from(this.eras.keys())) {
      this.disposeEra(idx);
    }
    this.eras.clear();
    this.initPromises.clear();
  }
}
