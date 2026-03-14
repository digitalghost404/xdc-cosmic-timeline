import * as THREE from 'three';
import { getCapabilities } from '../utils/capabilities';

export class Renderer {
  public renderer: THREE.WebGLRenderer;
  public canvas: HTMLCanvasElement;
  public isWebGPU: boolean = false;

  private container: HTMLElement;
  private dpr: number;

  constructor(container: HTMLElement) {
    this.container = container;

    const caps = getCapabilities();
    this.dpr = caps.dpr;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: true,
    });

    this.canvas = this.renderer.domElement;
    this.applySettings();
    this.container.appendChild(this.canvas);
    this.resize();
  }

  private applySettings(): void {
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.autoClear = false;
  }

  /** Called after construction; reserved for WebGPU async init in the future. */
  async init(): Promise<void> {
    // WebGL renderer is synchronous — nothing additional to await.
    // When WebGPU support stabilises we can hot-swap here.
  }

  resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  dispose(): void {
    this.renderer.dispose();
    if (this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }
}
