import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Post-processing configuration that eras expose to the compositor
// ---------------------------------------------------------------------------

export interface PostConfig {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  chromaticAberration: number;
  filmGrain: number;
  godRays: boolean;
  godRayIntensity: number;
  vignetteStrength: number;
  // Gravitational lensing post-processing
  lensingStrength: number;          // 0 = off, 0.5 = subtle, 1.0+ = extreme
  lensingCenter: [number, number];  // screen-space center of mass [0-1, 0-1]
  lensingRadius: number;            // falloff radius in screen-space (0.1–0.5)
}

// ---------------------------------------------------------------------------
// Abstract base class — every era extends this
// ---------------------------------------------------------------------------

export abstract class BaseEra {
  public scene: THREE.Scene;
  public camera: THREE.PerspectiveCamera;
  protected isActive: boolean = false;
  protected isInitialized: boolean = false;

  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.001,
      10000,
    );
    this.camera.position.set(0, 0, 5);
  }

  // ---------------------------------------------------------------------------
  // Abstract interface — eras must implement these
  // ---------------------------------------------------------------------------

  abstract init(): Promise<void>;

  /**
   * Called every frame while the era is active or transitioning.
   * @param progress  local era progress [0, 1]
   * @param delta     frame time in seconds
   * @param globalTime  monotonically increasing time in seconds
   */
  abstract update(progress: number, delta: number, globalTime: number): void;

  /** Return post-processing config appropriate for the current progress. */
  abstract getPostConfig(progress: number): PostConfig;

  /** Return the background/sky colour for the current progress. */
  abstract getBackgroundColor(progress: number): THREE.Color;

  // ---------------------------------------------------------------------------
  // Lifecycle helpers
  // ---------------------------------------------------------------------------

  activate(): void {
    this.isActive = true;
  }

  deactivate(): void {
    this.isActive = false;
  }

  /** Override in subclasses to free GPU resources. Always call super.dispose(). */
  dispose(): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          (obj.material as THREE.Material).dispose();
        }
        obj.geometry.dispose();
      }
    });

    // Remove all children
    while (this.scene.children.length > 0) {
      this.scene.remove(this.scene.children[0]);
    }

    this.isInitialized = false;
    this.isActive = false;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  protected defaultPostConfig(): PostConfig {
    return {
      bloomStrength: 0.8,
      bloomRadius: 0.5,
      bloomThreshold: 0.4,
      chromaticAberration: 0.0,
      filmGrain: 0.04,
      godRays: false,
      godRayIntensity: 0.0,
      vignetteStrength: 0.4,
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }
}
