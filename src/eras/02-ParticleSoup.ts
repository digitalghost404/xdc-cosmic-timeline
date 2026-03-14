import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Fullscreen quad vertex shader — shared by the volumetric plasma pass
// ---------------------------------------------------------------------------

const PLASMA_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Raymarched volumetric plasma fragment shader
// ---------------------------------------------------------------------------

const PLASMA_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;
  uniform vec3  uHotColor;
  uniform vec3  uCoolColor;
  uniform vec3  uMidColor;

  varying vec2 vUv;

  // ---- Simplex 3D noise (full Ashima implementation) ----
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
    vec3  ns = n_ * D.wyz - D.xzx;

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

    vec4 norm = taylorInvSqrt4(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // ---- FBM with domain warping ----
  float fbm(vec3 p) {
    float val  = 0.0;
    float amp  = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 7; i++) {
      val  += snoise(p * freq) * amp;
      freq *= 2.13;
      amp  *= 0.47;
    }
    return val;
  }

  float warpedFbm(vec3 p) {
    // Two levels of domain warping for organic tendrils
    vec3 q = vec3(
      fbm(p + vec3(0.0,  0.0,  0.0)),
      fbm(p + vec3(5.2,  1.3,  2.7)),
      fbm(p + vec3(1.7, -3.8,  9.2))
    );
    vec3 r = vec3(
      fbm(p + 4.0 * q + vec3(1.7, 9.2, 3.1)),
      fbm(p + 4.0 * q + vec3(8.3, 2.8, 4.6)),
      fbm(p + 4.0 * q + vec3(2.4, 5.7, 1.9))
    );
    return fbm(p + 4.0 * r);
  }

  void main() {
    // Reconstruct ray from fullscreen UV
    vec2 uv = vUv * 2.0 - 1.0;
    // Slight fisheye feel — no explicit aspect needed (quad fills screen)
    vec3 ro = vec3(0.0, 0.0, -2.0);
    vec3 rd = normalize(vec3(uv, 1.5));

    // Slow camera drift driven by time
    float driftAngle = uTime * 0.06;
    mat2 camRot = mat2(cos(driftAngle), -sin(driftAngle), sin(driftAngle), cos(driftAngle));
    rd.xz = camRot * rd.xz;
    rd.yz = mat2(
      cos(uTime * 0.03), -sin(uTime * 0.03),
      sin(uTime * 0.03),  cos(uTime * 0.03)
    ) * rd.yz;

    // Raymarching
    float t        = 0.0;
    vec3  accColor = vec3(0.0);
    float accAlpha = 0.0;
    float stepSize = 0.12;

    for (int i = 0; i < 64; i++) {
      if (accAlpha > 0.95) break;

      vec3 p = ro + rd * t;

      // Animated domain-warped FBM
      float density = warpedFbm(p * 0.55 + vec3(uTime * 0.07, uTime * 0.04, uTime * 0.05));
      density = density * 0.5 + 0.5; // remap [-1,1] → [0,1]

      // Temperature gradient — hotter near centre of volume
      float distFromCentre = length(p) * 0.4;
      float tempBias = clamp(1.0 - distFromCentre, 0.0, 1.0);
      float temp = clamp(density * 1.2 + tempBias * 0.4, 0.0, 1.0);

      // Sample color from progress-shifted plasma palette
      vec3 sampleColor;
      if (temp > 0.5) {
        sampleColor = mix(uMidColor, uHotColor, (temp - 0.5) * 2.0);
      } else {
        sampleColor = mix(uCoolColor, uMidColor, temp * 2.0);
      }

      // Self-emission — hotter regions burn brighter
      float emission = temp * temp * 2.5;
      sampleColor *= emission;

      // Internal scattering glow
      float scatter = max(density - 0.3, 0.0) * 0.6;

      accColor += sampleColor * scatter * (1.0 - accAlpha);
      accAlpha += scatter * 0.09 * (1.0 - accAlpha);

      t += stepSize;
    }

    // Vignette falloff from edge
    float vignette = 1.0 - smoothstep(0.5, 1.4, length(uv));
    accColor *= vignette;
    accAlpha *= vignette;

    // Tone map — reinhard + exposure
    accColor = accColor / (accColor + vec3(1.0));
    accColor = pow(accColor, vec3(0.85));

    gl_FragColor = vec4(accColor, clamp(accAlpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Ember particle vertex shader
// ---------------------------------------------------------------------------

const EMBER_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute vec3  aDrift;

  uniform float uTime;
  uniform float uProgress;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    // Slow parallax drift — each particle has its own velocity
    vec3 pos = position + aDrift * uTime * aSpeed;

    // Wrap position into a finite box
    pos = mod(pos + 4.0, 8.0) - 4.0;

    // Gentle oscillation
    pos.y += sin(uTime * 0.7 + aPhase * 6.28) * 0.08;
    pos.x += cos(uTime * 0.5 + aPhase * 3.14) * 0.05;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float sz = aSize * (250.0 / -mvPos.z);
    gl_PointSize = clamp(sz, 0.5, 16.0);

    // Flicker
    float flicker = 0.6 + 0.4 * sin(uTime * 3.0 + aPhase * 17.3);
    vAlpha = flicker * smoothstep(0.0, 0.05, uProgress);
    vHeat  = aPhase; // repurpose as heat proxy
  }
`;

const EMBER_FRAG = /* glsl */ `
  uniform vec3  uHotColor;
  uniform vec3  uCoolColor;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float softEdge = 1.0 - smoothstep(0.1, 0.5, d);
    float core     = exp(-d * 12.0) * 3.0;

    vec3 col = mix(uCoolColor, uHotColor, vHeat);
    col += col * core;

    gl_FragColor = vec4(col, softEdge * vAlpha * 0.7);
  }
`;

// ---------------------------------------------------------------------------
// ParticleSoup Era
// ---------------------------------------------------------------------------

const EMBER_COUNT = 30_000;

export class ParticleSoup extends BaseEra {
  private plasmaMat!: THREE.ShaderMaterial;
  private plasmaQuad!: THREE.Mesh;

  private emberGeo!: THREE.BufferGeometry;
  private emberMat!: THREE.ShaderMaterial;
  private embers!: THREE.Points;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildPlasmaQuad();
    this.buildEmbers();

    this.camera.position.set(0, 0, 5);
    this.camera.near = 0.01;
    this.camera.far  = 1000;
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  // ----- Fullscreen plasma quad -----

  private buildPlasmaQuad(): void {
    // PlaneGeometry in NDC — rendered with depth disabled so it always fills screen
    const geo = new THREE.PlaneGeometry(2, 2);

    this.plasmaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uProgress:  { value: 0 },
        uHotColor:  { value: new THREE.Color(0xff6600) },
        uCoolColor: { value: new THREE.Color(0x220055) },
        uMidColor:  { value: new THREE.Color(0xee00aa) },
      },
      vertexShader:   PLASMA_VERT,
      fragmentShader: PLASMA_FRAG,
      transparent:    true,
      depthTest:      false,
      depthWrite:     false,
    });

    this.plasmaQuad = new THREE.Mesh(geo, this.plasmaMat);
    // Render at depth 0 — behind everything
    this.plasmaQuad.renderOrder = -1;
    this.scene.add(this.plasmaQuad);
  }

  // ----- Ember particles -----

  private buildEmbers(): void {
    this.emberGeo = new THREE.BufferGeometry();

    const positions = new Float32Array(EMBER_COUNT * 3);
    const sizes     = new Float32Array(EMBER_COUNT);
    const phases    = new Float32Array(EMBER_COUNT);
    const speeds    = new Float32Array(EMBER_COUNT);
    const drifts    = new Float32Array(EMBER_COUNT * 3);

    for (let i = 0; i < EMBER_COUNT; i++) {
      // Scatter randomly in a [-4, 4]^3 box around the camera
      positions[i * 3]     = (Math.random() - 0.5) * 8;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 8;

      // Each ember drifts in a randomised direction
      drifts[i * 3]     = (Math.random() - 0.5) * 0.15;
      drifts[i * 3 + 1] = (Math.random() - 0.5) * 0.15;
      drifts[i * 3 + 2] = (Math.random() - 0.5) * 0.08;

      sizes[i]  = 0.2 + Math.random() * 0.8;
      phases[i] = Math.random();
      speeds[i] = 0.4 + Math.random() * 0.8;
    }

    this.emberGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.emberGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
    this.emberGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    this.emberGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds,    1));
    this.emberGeo.setAttribute('aDrift',   new THREE.BufferAttribute(drifts,    3));

    this.emberMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:      { value: 0 },
        uProgress:  { value: 0 },
        uHotColor:  { value: new THREE.Color(0xff8833) },
        uCoolColor: { value: new THREE.Color(0xcc00ff) },
      },
      vertexShader:   EMBER_VERT,
      fragmentShader: EMBER_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.embers = new THREE.Points(this.emberGeo, this.emberMat);
    this.scene.add(this.embers);
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // Shift plasma palette along progress: orange → magenta → violet → blue-purple
    const hotColor  = new THREE.Color();
    const midColor  = new THREE.Color();
    const coolColor = new THREE.Color();

    // Hot: deep orange → magenta → violet → blue-white
    hotColor.setHSL(
      lerp(0.06, 0.75, smoothstep(0.0, 1.0, progress)),
      1.0,
      lerp(0.6, 0.45, progress),
    );
    // Mid: orange-red → deep magenta → mid violet
    midColor.setHSL(
      lerp(0.05, 0.82, smoothstep(0.0, 1.0, progress)),
      1.0,
      lerp(0.4, 0.3, progress),
    );
    // Cool: near-black orange → deep purple-black
    coolColor.setHSL(
      lerp(0.04, 0.78, smoothstep(0.0, 1.0, progress)),
      0.9,
      lerp(0.08, 0.05, progress),
    );

    this.plasmaMat.uniforms.uTime.value     = globalTime;
    this.plasmaMat.uniforms.uProgress.value = progress;
    this.plasmaMat.uniforms.uHotColor.value .copy(hotColor);
    this.plasmaMat.uniforms.uMidColor.value .copy(midColor);
    this.plasmaMat.uniforms.uCoolColor.value.copy(coolColor);

    // Ember hot/cool follows the same shift
    this.emberMat.uniforms.uTime.value    = globalTime;
    this.emberMat.uniforms.uProgress.value = progress;
    this.emberMat.uniforms.uHotColor.value .copy(hotColor);
    this.emberMat.uniforms.uCoolColor.value.copy(coolColor);

    // Slow camera drift — adds parallax against the volume
    this.camera.position.x = Math.sin(globalTime * 0.07) * 0.5;
    this.camera.position.y = Math.cos(globalTime * 0.05) * 0.3;
    this.camera.position.z = 5 + Math.sin(globalTime * 0.04) * 0.4;
    this.camera.lookAt(0, 0, 0);
  }

  getPostConfig(progress: number): PostConfig {
    return {
      bloomStrength:      lerp(2.5, 1.8, smoothstep(0.0, 1.0, progress)),
      bloomRadius:        lerp(0.7, 0.5, progress),
      bloomThreshold:     0.05,
      chromaticAberration: lerp(0.006, 0.002, progress),
      filmGrain:          0.05,
      godRays:            false,
      godRayIntensity:    0.0,
      vignetteStrength:   lerp(0.3, 0.5, progress),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  getBackgroundColor(progress: number): THREE.Color {
    return getEraColor(1, progress);
  }

  override dispose(): void {
    this.plasmaMat?.dispose();
    (this.plasmaQuad?.geometry as THREE.BufferGeometry)?.dispose();
    this.emberGeo?.dispose();
    this.emberMat?.dispose();
    super.dispose();
  }
}
