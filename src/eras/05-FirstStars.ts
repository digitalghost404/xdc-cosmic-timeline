import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, randomInSphere } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Star points — vertex shader
// Attributes: position (world pos), aIgnitionTime, aPhase, aBrightness
// ---------------------------------------------------------------------------

const STAR_VERT = /* glsl */ `
  attribute float aIgnitionTime;
  attribute float aPhase;
  attribute float aBrightness;

  uniform float uProgress;
  uniform float uTime;

  varying float vBrightness;
  varying float vIgnitionAge;

  void main() {
    float age = max(uProgress - aIgnitionTime, 0.0);
    vIgnitionAge = age;

    // Rapid flare then settle — a sharp spike that decays exponentially
    float scale = age > 0.0 ? (1.0 + exp(-age * 20.0) * 5.0) : 0.0;

    // Breathing pulse for stars that are already lit
    float breathe = 1.0 + 0.06 * sin(uTime * 1.4 + aPhase * 6.2831853);
    scale *= breathe;

    vBrightness = aBrightness * scale;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float pointSize = scale * aBrightness * (400.0 / -mvPosition.z);
    gl_PointSize = clamp(pointSize, 0.0, 128.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// ---------------------------------------------------------------------------
// Star points — fragment shader
// Blue-white core fading to warm edges, anamorphic horizontal streak
// ---------------------------------------------------------------------------

const STAR_FRAG = /* glsl */ `
  varying float vBrightness;
  varying float vIgnitionAge;

  void main() {
    if (vBrightness <= 0.0) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Hot core
    float core = exp(-d * 12.0);
    // Soft glow halo
    float glow = exp(-d * 3.0) * 0.5;
    // Anamorphic horizontal lens streak
    float streak = exp(-abs(uv.y) * 20.0) * exp(-abs(uv.x) * 3.0) * 0.3;

    float intensity = (core + glow + streak) * vBrightness;

    // Blue-white core → warm amber at edges (young hot Population III stars)
    vec3 color = mix(vec3(0.82, 0.88, 1.0), vec3(1.0, 0.92, 0.75), clamp(d * 2.2, 0.0, 1.0));

    // Extra blue tint at ignition moment
    float newborn = clamp(exp(-vIgnitionAge * 8.0), 0.0, 1.0);
    color = mix(color, vec3(0.6, 0.75, 1.0), newborn * 0.4);

    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// Background nebula — fullscreen quad vertex shader
// ---------------------------------------------------------------------------

const NEBULA_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Background nebula — fragment shader
// FBM + simplex noise for emission nebula patches (pink/purple/blue)
// Full simplex 3D noise implementation included inline
// ---------------------------------------------------------------------------

const NEBULA_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform vec2  uResolution;

  varying vec2 vUv;

  // --- Simplex 3D noise (Stefan Gustavson, public domain) ---

  vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289v3(i);
    vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // --- FBM using simplex noise ---
  float fbm(vec3 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= octaves) break;
      value += amplitude * snoise(p * frequency);
      frequency *= 2.1;
      amplitude *= 0.48;
    }
    return value;
  }

  void main() {
    // Aspect-correct UV centred at 0
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 uv = (vUv - 0.5) * aspect;

    // Slowly drifting 3D coordinate for the noise
    float slowTime = uTime * 0.018;
    vec3 p = vec3(uv * 1.6, slowTime);

    // Domain-warped FBM for the nebula shape
    vec3 warp = vec3(
      fbm(p + vec3(1.7, 9.2, 0.0), 4),
      fbm(p + vec3(8.3, 2.8, 0.5), 4),
      fbm(p + vec3(3.1, 5.6, 1.0), 3)
    );
    float density = fbm(p + warp * 0.55, 6);

    // Remap to [0,1] and shape the emission
    density = clamp(density * 0.5 + 0.5, 0.0, 1.0);
    density = pow(density, 2.8);

    // Three nebula colour regions layered by noise coordinate
    vec3 pink   = vec3(1.0,  0.38, 0.65);
    vec3 purple = vec3(0.55, 0.18, 0.95);
    vec3 blue   = vec3(0.22, 0.48, 1.0);

    float n1 = snoise(p * 0.8 + vec3(0.0)) * 0.5 + 0.5;
    float n2 = snoise(p * 0.5 + vec3(4.1, 2.3, 1.7)) * 0.5 + 0.5;

    vec3 nebulaColor = mix(pink, purple, n1);
    nebulaColor = mix(nebulaColor, blue, n2 * 0.5);

    // Fade in with progress, dim at start (universe still dark)
    float visibility = smoothstep(0.0, 0.25, uProgress);
    // Gentle pulse
    float pulse = 1.0 + 0.04 * sin(uTime * 0.7);

    float alpha = density * visibility * pulse * 0.28;

    gl_FragColor = vec4(nebulaColor, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Constellation line shaders — faint, pulsing, dashed appearance
// ---------------------------------------------------------------------------

const CONSTELLATION_VERT = /* glsl */ `
  // Each vertex carries the progress threshold at which its segment becomes
  // visible; this lets segments appear sequentially as stars ignite.
  attribute float aRevealAt;

  uniform float uProgress;
  uniform float uTime;

  varying float vReveal;
  varying float vLineDist; // distance along line [0,1] for dash pattern

  // We abuse gl_PointSize as a passthrough — not used — instead we rely on
  // the fragment shader's built-in interpolation of vLineDist.

  void main() {
    vReveal  = smoothstep(aRevealAt, aRevealAt + 0.08, uProgress);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CONSTELLATION_FRAG = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;

  varying float vReveal;

  void main() {
    if (vReveal <= 0.0) discard;

    // Overall fade driven by progress [0.4 → 0.6] ramp
    float globalFade = smoothstep(0.4, 0.6, uProgress);

    // Gentle luminance pulse on the whole constellation grid
    float pulse = 0.8 + 0.2 * sin(uTime * 0.9);

    float alpha = 0.11 * globalFade * vReveal * pulse;
    if (alpha < 0.001) discard;

    // Blue-white constellation colour
    vec3 col = vec3(0.55, 0.72, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Supernova flash — fullscreen quad fragment shader
// ---------------------------------------------------------------------------

const SUPERNOVA_FLASH_FRAG = /* glsl */ `
  uniform float uFlashIntensity;
  void main() {
    gl_FragColor = vec4(1.0, 0.98, 0.95, uFlashIntensity);
  }
`;

// ---------------------------------------------------------------------------
// Supernova shockwave — sphere with additive fresnel edges
// ---------------------------------------------------------------------------

const SHOCKWAVE_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const SHOCKWAVE_FRAG = /* glsl */ `
  uniform float uExpand;   // 0..1 — how far the ring has expanded
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    // Fresnel: bright at grazing angles (the ring edge), transparent at front
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 2.5);

    // Fade ring as it expands and disperses
    float fade = uOpacity * (1.0 - uExpand);
    float alpha = fresnel * fade;
    if (alpha < 0.001) discard;

    // Hot blue-white shock front cools to amber at the trailing edge
    vec3 col = mix(vec3(1.0, 0.95, 0.7), vec3(0.5, 0.8, 1.0), fresnel);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Nebula remnant — small sphere with noise-based glowing gas
// ---------------------------------------------------------------------------

const NEBULA_REMNANT_VERT = /* glsl */ `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vPosition = position;
    vNormal   = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir   = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const NEBULA_REMNANT_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;   // fades in 0→1

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  // --- Simplex 3D noise helpers ---
  vec3 _nmod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _nmod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _nperm(vec4 x)   { return _nmod289(((x * 34.0) + 1.0) * x); }
  vec4 _ntiSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise3(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = _nmod289(i);
    vec4 p = _nperm(_nperm(_nperm(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0+1.0; vec4 s1 = floor(b1)*2.0+1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = _ntiSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
    m = m*m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  float nfbm(vec3 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * snoise3(p); p *= 2.1; a *= 0.48;
    }
    return v;
  }

  void main() {
    // Fresnel rim — show nebula as a volumetric cloud haze at grazing angles
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 1.8);

    // FBM density to break up the sphere into wispy lobes
    vec3 p = vPosition * 1.6 + vec3(uTime * 0.03);
    float density = nfbm(p) * 0.5 + 0.5;
    density = pow(clamp(density, 0.0, 1.0), 1.4);

    // Colour: hot pink → purple → blue nebula
    float n1 = snoise3(vPosition * 1.2 + vec3(0.5)) * 0.5 + 0.5;
    float n2 = snoise3(vPosition * 0.8 + vec3(3.7, 1.1, 2.3)) * 0.5 + 0.5;
    vec3 pink   = vec3(1.0, 0.35, 0.7);
    vec3 purple = vec3(0.6, 0.2,  1.0);
    vec3 blue   = vec3(0.3, 0.6,  1.0);
    vec3 col = mix(pink, purple, n1);
    col = mix(col, blue, n2 * 0.45);

    float alpha = fresnel * density * uOpacity * 0.75;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAR_COUNT = 200;

// The supernova star is placed at a fixed, known world position so we can
// aim the shockwave sphere and nebula remnant at the same location.
const SUPERNOVA_POS = new THREE.Vector3(3, 1.5, -2);

// Pre-defined constellation groups: each sub-array is a list of star indices
// (indices into the positions array built in buildStars) that form one shape.
// The indices are chosen to pick stars spread across the field so they form
// recognisable skeletal shapes at whatever random positions the stars land in.
// We define them as fractions [0,1] of STAR_COUNT so they scale with density.
const CONSTELLATION_GROUPS: number[][] = [
  // "The Crucible" — cross / plus shape
  [4, 18, 32, 46, 60],
  // "The Arc" — curved chain
  [10, 25, 40, 55, 70, 85],
  // "The Triangle"
  [100, 115, 130],
  // "The Serpent" — longer winding chain
  [5, 20, 37, 52, 65, 80, 95],
  // "The Crown" — fan shape
  [150, 160, 165, 170, 175],
  // "The Sigil" — small diamond
  [140, 148, 155, 162],
];

// ---------------------------------------------------------------------------
// FirstStars Era
// ---------------------------------------------------------------------------

export class FirstStars extends BaseEra {
  // Star points system
  private starGeo!: THREE.BufferGeometry;
  private starMat!: THREE.ShaderMaterial;
  private starPoints!: THREE.Points;

  // Background nebula fullscreen quad
  private nebulaMesh!: THREE.Mesh;
  private nebulaMat!: THREE.ShaderMaterial;

  // Constellation lines
  private constellationLines!: THREE.LineSegments;
  private constellationMat!: THREE.ShaderMaterial;

  // Ignition thresholds stored for update logic
  private ignitionTimes!: Float32Array;

  // ---- Supernova event meshes ----
  // Full-screen white flash quad
  private flashQuad!: THREE.Mesh;
  private flashMat!: THREE.ShaderMaterial;
  // Expanding shockwave sphere
  private shockwaveMesh!: THREE.Mesh;
  private shockwaveMat!: THREE.ShaderMaterial;
  // Nebula remnant sphere
  private nebulaRemnantMesh!: THREE.Mesh;
  private nebulaRemnantMat!: THREE.ShaderMaterial;
  // Index of the star we'll explode (ignition time ~0.15)
  private supernovaStarIndex: number = -1;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.camera.near = 0.01;
    this.camera.far = 5000;
    this.camera.fov = 70;
    this.camera.position.set(0, 0, 18);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.buildNebula();
    this.buildStars();
    // Constellations are built after buildStars() because they need the
    // already-computed star positions array.
    this.buildConstellations();
    this.buildSupernova();

    this.isInitialized = true;
  }

  // -------------------------------------------------------------------------
  // Nebula background — fullscreen quad, renders behind stars
  // -------------------------------------------------------------------------

  private buildNebula(): void {
    // PlaneGeometry in NDC is simpler than BufferGeometry for a fullscreen quad
    const geo = new THREE.PlaneGeometry(2, 2);
    this.nebulaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uProgress:   { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      },
      vertexShader:   NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      blending:       THREE.AdditiveBlending,
    });

    this.nebulaMesh = new THREE.Mesh(geo, this.nebulaMat);
    // Render before stars; renderOrder -1 keeps it behind
    this.nebulaMesh.renderOrder = -1;
    // Frustum culling off — it's a fullscreen quad managed manually
    this.nebulaMesh.frustumCulled = false;
    this.scene.add(this.nebulaMesh);
  }

  // -------------------------------------------------------------------------
  // Star particle system — Points with per-attribute ignition data
  // -------------------------------------------------------------------------

  private buildStars(): void {
    this.starGeo = new THREE.BufferGeometry();

    const positions     = new Float32Array(STAR_COUNT * 3);
    const ignitionTimes = new Float32Array(STAR_COUNT);
    const phases        = new Float32Array(STAR_COUNT);
    const brightnesses  = new Float32Array(STAR_COUNT);

    // Keep a reference for the update loop (no need to read back from GPU)
    this.ignitionTimes = ignitionTimes;

    for (let i = 0; i < STAR_COUNT; i++) {
      // Distribute in a sphere; keep them visible from the initial camera distance
      const pos = randomInSphere(12);
      positions[i * 3]     = pos.x;
      positions[i * 3 + 1] = pos.y * 0.6; // slightly flatten on Y for more sky-like feel
      positions[i * 3 + 2] = pos.z;

      // Stagger ignition across 5% – 90% of progress
      ignitionTimes[i] = 0.05 + (i / STAR_COUNT) * 0.85;

      phases[i]       = Math.random() * Math.PI * 2;
      brightnesses[i] = 0.6 + Math.random() * 0.8; // varied intrinsic brightness
    }

    // --- Supernova star: find the star whose ignition time is closest to 0.15
    //     (oldest burning star at the time of the event) and relocate it to the
    //     known SUPERNOVA_POS so the shockwave/remnant can be anchored there.
    {
      let bestIdx = 0;
      let bestDist = Math.abs(ignitionTimes[0] - 0.15);
      for (let i = 1; i < STAR_COUNT; i++) {
        const d = Math.abs(ignitionTimes[i] - 0.15);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      }
      this.supernovaStarIndex = bestIdx;
      positions[bestIdx * 3]     = SUPERNOVA_POS.x;
      positions[bestIdx * 3 + 1] = SUPERNOVA_POS.y;
      positions[bestIdx * 3 + 2] = SUPERNOVA_POS.z;
      // Make it intrinsically bright — it's a massive Population III progenitor
      brightnesses[bestIdx] = 1.4;
    }

    this.starGeo.setAttribute('position',     new THREE.BufferAttribute(positions,     3));
    this.starGeo.setAttribute('aIgnitionTime',new THREE.BufferAttribute(ignitionTimes, 1));
    this.starGeo.setAttribute('aPhase',       new THREE.BufferAttribute(phases,        1));
    this.starGeo.setAttribute('aBrightness',  new THREE.BufferAttribute(brightnesses,  1));

    this.starMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.starPoints = new THREE.Points(this.starGeo, this.starMat);
    this.scene.add(this.starPoints);
  }

  // -------------------------------------------------------------------------
  // Constellation lines — built after stars so positions are available
  // -------------------------------------------------------------------------

  private buildConstellations(): void {
    // Read the star position attribute that was just written in buildStars()
    const posAttr = this.starGeo.getAttribute('position') as THREE.BufferAttribute;
    const ignAttr  = this.starGeo.getAttribute('aIgnitionTime') as THREE.BufferAttribute;

    // Build line segment pairs for each constellation group.
    // Each consecutive pair of indices in a group forms one segment.
    const linePositions: number[] = [];
    const revealAts: number[]     = [];

    for (const group of CONSTELLATION_GROUPS) {
      for (let k = 0; k < group.length - 1; k++) {
        const aIdx = group[k];
        const bIdx = group[k + 1];

        // Guard against groups referencing out-of-range star indices
        if (aIdx >= STAR_COUNT || bIdx >= STAR_COUNT) continue;

        // Vertex A
        linePositions.push(
          posAttr.getX(aIdx),
          posAttr.getY(aIdx),
          posAttr.getZ(aIdx),
        );
        // Vertex B
        linePositions.push(
          posAttr.getX(bIdx),
          posAttr.getY(bIdx),
          posAttr.getZ(bIdx),
        );

        // This segment is revealed when both endpoint stars have ignited.
        // Use the later of the two ignition times so the line appears only
        // after both stars are visible.
        const revealAt = Math.max(
          ignAttr.getX(aIdx),
          ignAttr.getX(bIdx),
        );
        // Push two identical values (one per vertex) — the shader interpolates
        revealAts.push(revealAt, revealAt);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(linePositions), 3),
    );
    geo.setAttribute(
      'aRevealAt',
      new THREE.BufferAttribute(new Float32Array(revealAts), 1),
    );

    this.constellationMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   CONSTELLATION_VERT,
      fragmentShader: CONSTELLATION_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.constellationLines = new THREE.LineSegments(geo, this.constellationMat);
    // Render on top of the nebula but below the star splats
    this.constellationLines.renderOrder = 0;
    this.scene.add(this.constellationLines);
  }

  // -------------------------------------------------------------------------
  // Supernova — flash quad, shockwave sphere, nebula remnant
  // -------------------------------------------------------------------------

  private buildSupernova(): void {
    // --- 1. Full-screen white flash quad (renders in front of everything) ---
    const flashGeo = new THREE.PlaneGeometry(2, 2);
    this.flashMat = new THREE.ShaderMaterial({
      uniforms: { uFlashIntensity: { value: 0 } },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: SUPERNOVA_FLASH_FRAG,
      transparent:  true,
      depthWrite:   false,
      depthTest:    false,
      blending:     THREE.AdditiveBlending,
    });
    this.flashQuad = new THREE.Mesh(flashGeo, this.flashMat);
    this.flashQuad.frustumCulled = false;
    this.flashQuad.renderOrder   = 100; // topmost
    this.flashQuad.visible       = false;
    this.scene.add(this.flashQuad);

    // --- 2. Expanding shockwave sphere ---
    const shockGeo = new THREE.SphereGeometry(1, 48, 24);
    this.shockwaveMat = new THREE.ShaderMaterial({
      uniforms: {
        uExpand:  { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader:   SHOCKWAVE_VERT,
      fragmentShader: SHOCKWAVE_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.FrontSide,
      blending:       THREE.AdditiveBlending,
    });
    this.shockwaveMesh = new THREE.Mesh(shockGeo, this.shockwaveMat);
    this.shockwaveMesh.position.copy(SUPERNOVA_POS);
    this.shockwaveMesh.visible = false;
    this.scene.add(this.shockwaveMesh);

    // --- 3. Nebula remnant sphere (noise-based emission cloud) ---
    const remnantGeo = new THREE.SphereGeometry(1.8, 48, 24);
    this.nebulaRemnantMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:    { value: 0 },
        uOpacity: { value: 0 },
      },
      vertexShader:   NEBULA_REMNANT_VERT,
      fragmentShader: NEBULA_REMNANT_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      blending:       THREE.AdditiveBlending,
    });
    this.nebulaRemnantMesh = new THREE.Mesh(remnantGeo, this.nebulaRemnantMat);
    this.nebulaRemnantMesh.position.copy(SUPERNOVA_POS);
    this.nebulaRemnantMesh.visible = false;
    this.scene.add(this.nebulaRemnantMesh);
  }

  // -------------------------------------------------------------------------
  // Update — called every frame
  // -------------------------------------------------------------------------

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // Uniforms
    this.starMat.uniforms.uProgress.value = progress;
    this.starMat.uniforms.uTime.value     = globalTime;

    this.nebulaMat.uniforms.uProgress.value   = progress;
    this.nebulaMat.uniforms.uTime.value        = globalTime;
    this.nebulaMat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

    // Camera: start close-ish, pull back to reveal the full field as more stars ignite
    // Subtle lateral drift driven by globalTime for a floating feel
    const baseDist  = lerp(18, 30, smoothstep(0.0, 1.0, progress));
    const orbitAngle = globalTime * 0.025;
    const tiltAngle  = globalTime * 0.012;

    this.camera.position.x  = Math.sin(orbitAngle) * baseDist * 0.08;
    this.camera.position.y  = Math.sin(tiltAngle)  * baseDist * 0.04;
    this.camera.position.z  = baseDist;
    this.camera.lookAt(0, 0, 0);

    // Stars rotation — very slow drift of the entire field
    this.starPoints.rotation.y = globalTime * 0.004;
    this.starPoints.rotation.x = Math.sin(globalTime * 0.007) * 0.03;

    // Constellation lines — rotate in lockstep with the star field
    if (this.constellationLines) {
      this.constellationMat.uniforms.uProgress.value = progress;
      this.constellationMat.uniforms.uTime.value     = globalTime;
      this.constellationLines.rotation.y = this.starPoints.rotation.y;
      this.constellationLines.rotation.x = this.starPoints.rotation.x;
    }

    // ---- Supernova event ----
    this.updateSupernova(progress, globalTime);
  }

  private updateSupernova(progress: number, globalTime: number): void {
    // --- Flash quad: peaks at 0.70, decays 0.70→0.78 ---
    if (progress >= 0.68 && progress <= 0.80) {
      this.flashQuad.visible = true;
      // Rise sharply from 0.68→0.70, then decay 0.70→0.78
      const riseT  = smoothstep(0.68, 0.70, progress);
      const decayT = smoothstep(0.70, 0.78, progress);
      this.flashMat.uniforms.uFlashIntensity.value = riseT * (1.0 - decayT);
    } else {
      this.flashQuad.visible = false;
    }

    // --- Supernova star pre-flash brightening: 0.65→0.70 ---
    // Achieved by injecting an override brightness through the star position
    // attribute cannot be changed per-frame cheaply, so we scale the supernova
    // star's size via the shockwave sphere doubling as a pre-flash glow sphere.
    // We repurpose nebulaRemnantMesh as a "pre-glow" up to 0.70, then swap roles.
    // (The actual star point will naturally look bright due to aBrightness=1.4.)

    // --- Shockwave sphere: active 0.72→0.95 ---
    if (progress >= 0.72 && progress <= 0.95) {
      this.shockwaveMesh.visible = true;
      const t = smoothstep(0.72, 0.85, progress);        // 0→1 over the expand window
      const fadeOut = 1.0 - smoothstep(0.82, 0.95, progress);
      const shockRadius = lerp(0.5, 14.0, t);            // sphere grows outward
      this.shockwaveMesh.scale.setScalar(shockRadius);
      this.shockwaveMat.uniforms.uExpand.value  = t;
      this.shockwaveMat.uniforms.uOpacity.value = fadeOut;
    } else {
      this.shockwaveMesh.visible = false;
    }

    // --- Nebula remnant: fades in from 0.78 onward ---
    if (progress >= 0.78) {
      this.nebulaRemnantMesh.visible = true;
      const opacity = smoothstep(0.78, 0.95, progress);
      this.nebulaRemnantMat.uniforms.uOpacity.value = opacity;
      this.nebulaRemnantMat.uniforms.uTime.value    = globalTime;
    } else {
      this.nebulaRemnantMesh.visible = false;
    }
  }

  // -------------------------------------------------------------------------
  // Post-processing config
  // -------------------------------------------------------------------------

  getPostConfig(progress: number): PostConfig {
    // Bloom ramps from essentially zero at start (pure darkness) to heavy at end
    const bloom = lerp(0.0, 3.0, smoothstep(0.05, 0.9, progress));

    return {
      bloomStrength:       bloom,
      bloomRadius:         lerp(0.6, 0.9, progress),
      bloomThreshold:      0.05,
      chromaticAberration: lerp(0.004, 0.001, progress),
      filmGrain:           lerp(0.08, 0.03, progress), // more grain in darkness
      godRays:             progress > 0.2 && progress < 0.75,
      godRayIntensity:     lerp(0.0, 0.5, smoothstep(0.2, 0.4, progress)) *
                           lerp(1.0, 0.0, smoothstep(0.6, 0.75, progress)),
      vignetteStrength:    lerp(0.9, 0.5, smoothstep(0.0, 0.6, progress)),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  // -------------------------------------------------------------------------
  // Background colour
  // -------------------------------------------------------------------------

  getBackgroundColor(progress: number): THREE.Color {
    // ERA_PALETTES[4]: deep violet → blue-white → pink nebula → amber
    // At start: almost pure black → deep violet; at end: dark blue-violet
    return getEraColor(4, progress);
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    this.starGeo?.dispose();
    this.starMat?.dispose();
    this.nebulaMat?.dispose();
    (this.nebulaMesh?.geometry as THREE.BufferGeometry)?.dispose();
    (this.constellationLines?.geometry as THREE.BufferGeometry)?.dispose();
    this.constellationMat?.dispose();
    // Supernova
    this.flashMat?.dispose();
    (this.flashQuad?.geometry as THREE.BufferGeometry)?.dispose();
    this.shockwaveMat?.dispose();
    (this.shockwaveMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.nebulaRemnantMat?.dispose();
    (this.nebulaRemnantMesh?.geometry as THREE.BufferGeometry)?.dispose();
    super.dispose();
  }
}
