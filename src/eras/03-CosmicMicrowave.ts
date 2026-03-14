import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutExpo } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// CMB sphere vertex shader — animated wobble via noise displacement
// ---------------------------------------------------------------------------

const CMB_VERT = /* glsl */ `
  attribute float aNoiseOffset;

  uniform float uTime;
  uniform float uProgress;

  varying vec3  vPosition;
  varying float vDisplacement;

  // Fast hash-based value noise for vertex displacement
  float hash31(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p.zxy, p.yxz + 19.19);
    return fract(p.x * p.y * p.z);
  }

  float valueNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep interpolation

    return mix(
      mix(
        mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
        f.y
      ),
      mix(
        mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
        f.y
      ),
      f.z
    );
  }

  void main() {
    vPosition = position;

    // Multi-octave wobble displacement
    float wobble  = valueNoise(normal * 3.0 + uTime * 0.2) * 0.5
                  + valueNoise(normal * 7.0 + uTime * 0.15) * 0.25;
    wobble       *= 0.6; // keep amplitude subtle

    // Suppress displacement during punch-through
    float punchT = smoothstep(0.38, 0.62, uProgress);
    wobble *= 1.0 - punchT * 0.6;

    vec3 disp = normal * wobble;
    vDisplacement = wobble;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + disp, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// CMB sphere fragment shader — temperature ramp + fluctuation noise
// ---------------------------------------------------------------------------

const CMB_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;
  uniform float uOpacity;

  varying vec3  vPosition;
  varying float vDisplacement;

  // ---- Simplex 3D noise ----
  vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289_4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute4(vec4 x) { return mod289_4(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289_3(i);
    vec4 p = permute4(permute4(permute4(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3  ns  = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x  = x_ * ns.x + ns.yyyy;
    vec4 y  = y_ * ns.x + ns.yyyy;
    vec4 h  = 1.0 - abs(x) - abs(y);

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

    vec4 norm = taylorInvSqrt4(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  // ---- CMB iconic temperature-to-color ramp ----
  // 0.0 = deep blue, 0.25 = cyan, 0.5 = green, 0.75 = yellow, 1.0 = red
  vec3 cmbRamp(float t) {
    t = clamp(t, 0.0, 1.0);

    vec3 deepBlue = vec3(0.0,   0.0,   0.4);
    vec3 cyan     = vec3(0.0,   0.667, 0.8);
    vec3 green    = vec3(0.0,   0.8,   0.267);
    vec3 yellow   = vec3(0.867, 0.8,   0.0);
    vec3 red      = vec3(0.8,   0.133, 0.0);

    if (t < 0.25) return mix(deepBlue, cyan,   t / 0.25);
    if (t < 0.5)  return mix(cyan,     green,  (t - 0.25) / 0.25);
    if (t < 0.75) return mix(green,    yellow, (t - 0.5)  / 0.25);
                  return mix(yellow,   red,    (t - 0.75) / 0.25);
  }

  // ---- CMB angular power spectrum approximation ----
  // The real CMB is a Gaussian random field whose power spectrum peaks near
  // multipole l≈200 (~1° angular scale). We weight noise octaves to match
  // that spectral shape: suppressed large scales, dominant intermediate peak,
  // falling damping tail at fine scales.
  float cmbPattern(vec3 pos) {
    float pattern = 0.0;

    // Large scale (low l) — quadrupole, octupole
    pattern += snoise(pos * 1.5) * 0.15;

    // Medium scale (l ~ 10-50)
    pattern += snoise(pos * 4.0) * 0.25;

    // Peak scale (l ~ 100-300) — THE dominant signal
    pattern += snoise(pos * 12.0) * 0.35;
    pattern += snoise(pos * 20.0) * 0.20;

    // Fine scale (l > 500) — damping tail (Silk damping)
    pattern += snoise(pos * 40.0) * 0.05;

    return pattern;
  }

  void main() {
    vec3 p = normalize(vPosition);

    // Physically-motivated CMB temperature fluctuation pattern
    float temp = cmbPattern(p);

    // Subtle temporal breathing — the CMB is static but we animate gently
    temp += snoise(p * 1.5 + uTime * 0.03) * 0.04;

    float normalised = clamp(temp * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = cmbRamp(normalised);

    // Slight self-glow on the hotter patches
    float hot = smoothstep(0.7, 1.0, normalised);
    col += col * hot * 0.6;

    // Fade edge of sphere at punch-through
    float punchAlpha = 1.0 - smoothstep(0.55, 0.75, uProgress);

    gl_FragColor = vec4(col, uOpacity * punchAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Photon streak vertex shader — long thin streaks rushing past camera
// ---------------------------------------------------------------------------

const STREAK_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aSpeed;

  uniform float uTime;
  uniform float uProgress;

  varying float vAlpha;
  varying float vAlong; // 0 = tail, 1 = head

  void main() {
    // Each streak is a line segment — position.y encodes [0,1] along streak
    vAlong = position.y * 0.5 + 0.5;

    // Streaks travel along -z (toward camera)
    float life   = mod(aPhase * 47.3 + uTime * aSpeed, 12.0);
    vec3  pos    = vec3(position.x * 6.0, position.z * 6.0, -life + 8.0);

    // Fade in/out
    float visWindow = smoothstep(0.38, 0.46, uProgress) * (1.0 - smoothstep(0.60, 0.70, uProgress));

    vAlpha = visWindow * (1.0 - abs(position.y)) * smoothstep(0.0, 2.0, life) * smoothstep(12.0, 9.0, life);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const STREAK_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vAlong;

  void main() {
    // Streaks are brighter at the head (vAlong == 1)
    float brightness = vAlong * vAlong;
    vec3  col = mix(vec3(0.3, 0.6, 1.0), vec3(1.0, 1.0, 1.0), brightness);
    gl_FragColor = vec4(col * 2.5, vAlpha * brightness * 0.8);
  }
`;

// ---------------------------------------------------------------------------
// CosmicMicrowave Era
// ---------------------------------------------------------------------------

const STREAK_COUNT = 800;

export class CosmicMicrowave extends BaseEra {
  private cmbSphere!: THREE.Mesh;
  private cmbMat!: THREE.ShaderMaterial;

  private streakGeo!: THREE.BufferGeometry;
  private streakMat!: THREE.ShaderMaterial;
  private streaks!: THREE.LineSegments;

  private dataLabel: HTMLElement | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildCmbSphere();
    this.buildPhotonStreaks();
    this.buildDataLabel();

    // Camera starts inside the sphere
    this.camera.position.set(0, 0, 0);
    this.camera.near   = 0.01;
    this.camera.far    = 2000;
    this.camera.fov    = 80;
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  // ----- CMB sphere -----

  private buildCmbSphere(): void {
    // High-segment sphere so vertex displacement looks smooth
    const geo = new THREE.SphereGeometry(50, 128, 64);

    // Pre-generate per-vertex noise offsets (used by vertex shader for variation)
    const count       = geo.attributes.position.count;
    const noiseOffset = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      noiseOffset[i] = Math.random();
    }
    geo.setAttribute('aNoiseOffset', new THREE.BufferAttribute(noiseOffset, 1));

    this.cmbMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
        uOpacity:  { value: 1.0 },
      },
      vertexShader:   CMB_VERT,
      fragmentShader: CMB_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.BackSide, // render inside of sphere
      blending:       THREE.NormalBlending,
    });

    this.cmbSphere = new THREE.Mesh(geo, this.cmbMat);
    this.scene.add(this.cmbSphere);
  }

  // ----- Data attribution label -----

  private buildDataLabel(): void {
    // Inject styles once — guard against double-injection on hot reload
    const STYLE_ID = 'cmb-data-label-style';
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .cmb-data-label {
          position: fixed;
          top: 60px;
          right: 20px;
          font-size: 0.55rem;
          font-weight: 300;
          letter-spacing: 0.1em;
          color: rgba(255,255,255,0.25);
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.8s;
          z-index: 15;
        }
      `;
      document.head.appendChild(style);
    }

    this.dataLabel = document.createElement('div');
    this.dataLabel.className = 'cmb-data-label';
    this.dataLabel.textContent =
      'Pattern based on CMB angular power spectrum \u00b7 ESA Planck mission';
    document.getElementById('ui-overlay')?.appendChild(this.dataLabel);
  }

  // ----- Photon streaks -----

  private buildPhotonStreaks(): void {
    // Each streak = one LineSegment (2 vertices per streak)
    const positions = new Float32Array(STREAK_COUNT * 2 * 3);
    const phases    = new Float32Array(STREAK_COUNT * 2);
    const speeds    = new Float32Array(STREAK_COUNT * 2);

    for (let i = 0; i < STREAK_COUNT; i++) {
      const phase = Math.random();
      const speed = 3.0 + Math.random() * 5.0;

      // x, z hold screen-space scatter; y encodes tail (-1) and head (+1)
      const sx = (Math.random() - 0.5);
      const sz = (Math.random() - 0.5);

      // Tail vertex
      positions[(i * 2)     * 3]     = sx;
      positions[(i * 2)     * 3 + 1] = -1.0; // tail marker
      positions[(i * 2)     * 3 + 2] = sz;

      // Head vertex (same x/z, different y)
      positions[(i * 2 + 1) * 3]     = sx;
      positions[(i * 2 + 1) * 3 + 1] = 1.0;  // head marker
      positions[(i * 2 + 1) * 3 + 2] = sz;

      phases[i * 2]     = phase;
      phases[i * 2 + 1] = phase;
      speeds[i * 2]     = speed;
      speeds[i * 2 + 1] = speed;
    }

    this.streakGeo = new THREE.BufferGeometry();
    this.streakGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.streakGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    this.streakGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds,    1));

    this.streakMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.streaks = new THREE.LineSegments(this.streakGeo, this.streakMat);
    this.scene.add(this.streaks);
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // Camera motion: starts at origin, punches forward through sphere at 0.4-0.7
    const punch    = smoothstep(0.35, 0.72, progress);
    const camZ     = easeInOutCubic(punch) * 110.0;
    const camWobble = (1.0 - punch) * 0.4;

    this.camera.position.set(
      Math.sin(globalTime * 0.08) * camWobble,
      Math.cos(globalTime * 0.06) * camWobble * 0.7,
      camZ,
    );
    this.camera.lookAt(
      Math.sin(globalTime * 0.04) * camWobble * 0.3,
      Math.cos(globalTime * 0.03) * camWobble * 0.3,
      camZ + 10,
    );

    // Sphere slowly rotates around Y
    this.cmbSphere.rotation.y = globalTime * 0.012;
    this.cmbSphere.rotation.x = Math.sin(globalTime * 0.007) * 0.04;

    // Update uniforms
    this.cmbMat.uniforms.uTime.value     = globalTime;
    this.cmbMat.uniforms.uProgress.value = progress;
    // Opacity fades as camera moves through the shell
    this.cmbMat.uniforms.uOpacity.value  = clamp(1.0 - smoothstep(0.55, 0.80, progress) * 0.95, 0.05, 1.0);

    this.streakMat.uniforms.uTime.value     = globalTime;
    this.streakMat.uniforms.uProgress.value = progress;

    // Show/hide the data attribution label while this era is active
    if (this.dataLabel) {
      this.dataLabel.style.opacity = this.isActive ? '1' : '0';
    }
  }

  getPostConfig(progress: number): PostConfig {
    const punchWindow = smoothstep(0.38, 0.50, progress) * (1.0 - smoothstep(0.60, 0.72, progress));

    return {
      bloomStrength:       lerp(1.2, 0.8, smoothstep(0.0, 1.0, progress)),
      bloomRadius:         lerp(0.5, 0.3, progress),
      bloomThreshold:      lerp(0.3, 0.5, progress),
      chromaticAberration: punchWindow * 0.012,
      filmGrain:           lerp(0.03, 0.02, progress),
      godRays:             punchWindow > 0.05,
      godRayIntensity:     punchWindow * 0.5,
      vignetteStrength:    lerp(0.4, 0.6, progress),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  getBackgroundColor(progress: number): THREE.Color {
    return getEraColor(2, progress);
  }

  override dispose(): void {
    this.cmbMat?.dispose();
    (this.cmbSphere?.geometry as THREE.BufferGeometry)?.dispose();
    this.streakGeo?.dispose();
    this.streakMat?.dispose();

    if (this.dataLabel) {
      this.dataLabel.remove();
      this.dataLabel = null;
    }

    super.dispose();
  }
}
