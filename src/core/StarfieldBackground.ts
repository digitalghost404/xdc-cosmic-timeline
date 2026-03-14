import * as THREE from 'three';
import { clamp, smoothstep } from '../utils/math';

// ---------------------------------------------------------------------------
// Vertex shader — positions, sizes, and per-star twinkling phase
// ---------------------------------------------------------------------------

const STAR_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute vec3  aColor;

  uniform float uTime;
  uniform float uOpacity;

  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    // Twinkling: two sine waves at slightly offset frequencies per star
    float twinkle = 0.75 + 0.25 * sin(uTime * 1.3 + aPhase)
                         * sin(uTime * 0.7 + aPhase * 2.5);

    vAlpha = twinkle * uOpacity;
    vColor = aColor;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Size attenuates with distance; stars are very far away so we cap this
    float dist = -mvPosition.z;
    gl_PointSize = clamp(aSize * (300.0 / dist), 0.5, 6.0);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

// ---------------------------------------------------------------------------
// Fragment shader — soft circular splat with anamorphic horizontal glint
// ---------------------------------------------------------------------------

const STAR_FRAG = /* glsl */ `
  varying float vAlpha;
  varying vec3  vColor;

  void main() {
    if (vAlpha <= 0.0) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float core = exp(-d * 10.0);
    float halo = exp(-d *  3.5) * 0.35;
    // Subtle anamorphic horizontal streak
    float streak = exp(-abs(uv.y) * 22.0) * exp(-abs(uv.x) * 4.0) * 0.18;

    float intensity = (core + halo + streak) * vAlpha;
    gl_FragColor = vec4(vColor * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// StarfieldBackground
// ---------------------------------------------------------------------------

const STAR_COUNT = 3000;

export class StarfieldBackground {
  /** A dedicated THREE.Scene containing only the starfield geometry. */
  public readonly scene: THREE.Scene;
  /**
   * A wide-FOV orthographic-equivalent perspective camera that never moves in
   * sync with the era cameras, creating the parallax illusion.
   */
  public readonly camera: THREE.PerspectiveCamera;

  private points!: THREE.Points;
  private mat!: THREE.ShaderMaterial;

  /**
   * A render target that App.ts renders the starfield into each frame.
   * The texture is then set as the active era scene's background so the
   * EffectComposer processes everything in one pass.
   */
  public readonly renderTarget: THREE.WebGLRenderTarget;

  constructor() {
    // ---- Scene ----
    this.scene = new THREE.Scene();

    // ---- Camera ----
    // Wide FOV so stars fill the screen. Near/far encompass our star shell.
    this.camera = new THREE.PerspectiveCamera(
      80,
      window.innerWidth / window.innerHeight,
      1,
      5000,
    );
    this.camera.position.set(0, 0, 0);

    // ---- Render target ----
    this.renderTarget = new THREE.WebGLRenderTarget(
      window.innerWidth,
      window.innerHeight,
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: false,
        stencilBuffer: false,
      },
    );

    this.buildStars();
  }

  // ---------------------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------------------

  private buildStars(): void {
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes     = new Float32Array(STAR_COUNT);
    const phases    = new Float32Array(STAR_COUNT);
    const colors    = new Float32Array(STAR_COUNT * 3);

    // Star colour palettes: cool blue-white, pure white, warm yellow-white
    const palette: [number, number, number][] = [
      [0.72, 0.82, 1.00], // blue-white (O/B type)
      [0.92, 0.95, 1.00], // white      (A type)
      [1.00, 0.97, 0.88], // warm white (F/G type)
      [1.00, 0.92, 0.70], // yellow-white (K type)
    ];
    // Weighted distribution: most stars are white/warm, fewer blue
    const weights = [0.15, 0.40, 0.30, 0.15];
    const cumWeights = weights.reduce<number[]>((acc, w, i) => {
      acc.push((acc[i - 1] ?? 0) + w);
      return acc;
    }, []);

    const pickColor = (): [number, number, number] => {
      const r = Math.random();
      for (let k = 0; k < cumWeights.length; k++) {
        if (r <= cumWeights[k]) return palette[k];
      }
      return palette[palette.length - 1];
    };

    for (let i = 0; i < STAR_COUNT; i++) {
      // Distribute uniformly on a sphere shell between radius 500 and 2000
      // Using rejection sampling for uniform distribution
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 500 + Math.random() * 1500;

      positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);

      // Varied sizes: most are small, a few are larger (bright stars)
      const sizeBias = Math.random();
      sizes[i] = sizeBias < 0.85
        ? 0.8 + Math.random() * 1.2   // common faint stars
        : 2.0 + Math.random() * 2.5;  // rare bright stars

      phases[i] = Math.random() * Math.PI * 2;

      const col = pickColor();
      // Slightly de-saturate fainter stars for realism
      const desat = 0.7 + Math.random() * 0.3;
      colors[i * 3]     = col[0] * desat + (1 - desat);
      colors[i * 3 + 1] = col[1] * desat + (1 - desat);
      colors[i * 3 + 2] = col[2] * desat + (1 - desat);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    geo.setAttribute('aColor',   new THREE.BufferAttribute(colors,    3));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:    { value: 0 },
        uOpacity: { value: 1 },
      },
      vertexShader:   STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      blending:       THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.scene.add(this.points);
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * @param progress   global scroll progress [0, 1]
   * @param globalTime monotonically increasing seconds
   */
  update(progress: number, globalTime: number): void {
    this.mat.uniforms.uTime.value = globalTime;

    // Very slow rotation for the parallax effect — much slower than era cameras
    this.points.rotation.y = globalTime * 0.002;
    this.points.rotation.x = Math.sin(globalTime * 0.0008) * 0.04;

    // Slight depth shift based on progress: moves the layer very gently
    this.camera.position.z = Math.sin(progress * Math.PI * 2) * 8;

    // Opacity: visible everywhere, but dims during Dark Ages (era index 3)
    // Dark Ages span global progress 0.23 – 0.33
    const inDarkAges = progress >= 0.23 && progress <= 0.33;
    let opacity: number;
    if (inDarkAges) {
      // Fade out entering Dark Ages, fade back in leaving
      const midpoint = 0.28;
      if (progress < midpoint) {
        opacity = clamp(1.0 - smoothstep(0.23, 0.27, progress) * 0.85, 0.15, 1.0);
      } else {
        opacity = clamp(smoothstep(0.29, 0.33, progress) * 0.85 + 0.15, 0.15, 1.0);
      }
    } else {
      opacity = 1.0;
    }
    this.mat.uniforms.uOpacity.value = opacity;
  }

  // ---------------------------------------------------------------------------
  // Resize
  // ---------------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderTarget.setSize(width, height);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.points.geometry.dispose();
    this.mat.dispose();
    this.renderTarget.dispose();
  }
}
