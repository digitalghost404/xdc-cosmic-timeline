import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, easeOutExpo } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Fullscreen quad vertex shader — shared for the hydrogen cloud pass
// ---------------------------------------------------------------------------

const DARK_VERT = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Raymarched hydrogen cloud fragment shader — ultra-low opacity
// ---------------------------------------------------------------------------

const DARK_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;
  uniform float uFirstStarGlow;

  varying vec2 vUv;

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

    vec4 j  = p - 49.0 * floor(p * ns.z * ns.z);
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
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  // FBM — kept at low frequencies for vast, slow structures
  float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 6; i++) {
      val  += snoise(p * freq) * amp;
      freq *= 1.97;
      amp  *= 0.51;
    }
    return val;
  }

  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    vec3 ro = vec3(0.0, 0.0, -2.0);
    vec3 rd = normalize(vec3(uv, 1.4));

    // Glacially slow rotation of the volume
    float angle = uTime * 0.008;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    rd.xz = rot * rd.xz;

    vec3  accColor = vec3(0.0);
    float accAlpha = 0.0;

    for (int i = 0; i < 48; i++) {
      if (accAlpha > 0.12) break; // hard cap — we never want to accumulate much

      float t = 0.15 + float(i) * 0.12;
      vec3  p = ro + rd * t;

      // Domain-warped density at very low scale
      vec3 q = vec3(
        fbm(p * 0.3 + vec3(uTime * 0.008)),
        fbm(p * 0.3 + vec3(1.7, 9.2, 2.3)),
        fbm(p * 0.3 + vec3(8.3, 2.8, 4.6))
      );
      float density = fbm(p * 0.3 + q * 0.4 + uTime * 0.01) * 0.5 + 0.5;

      // ULTRA low multiplier — clouds are barely there
      density = max(density - 0.55, 0.0) * 0.035;

      // Hydrogen cloud color: barely warm dark grey-blue
      vec3 cloudCol = vec3(0.04, 0.028, 0.022) * density * 4.0;

      accColor += cloudCol * (1.0 - accAlpha);
      accAlpha += density * 0.6 * (1.0 - accAlpha);
    }

    vec3 finalColor = accColor;

    // ---- First-star foreshadowing glow ----
    if (uFirstStarGlow > 0.0) {
      float d = length(uv);
      // Tiny warm pixel at centre that blooms as progress → 1
      float glow  = exp(-d * d / (0.0002 + uFirstStarGlow * 0.04)) * uFirstStarGlow;
      vec3  starCol = mix(vec3(0.8, 0.5, 0.1), vec3(1.0, 0.85, 0.4), uFirstStarGlow);
      finalColor += starCol * glow * 1.5;
      accAlpha   += glow * 0.6;
    }

    gl_FragColor = vec4(finalColor, clamp(accAlpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Cosmic web filament vertex shader
// ---------------------------------------------------------------------------

const FILAMENT_VERT = /* glsl */ `
  attribute float aPhase;

  uniform float uTime;
  uniform float uProgress;

  varying float vAlpha;

  void main() {
    // Filaments drift imperceptibly slowly
    vec3 pos = position;
    pos.x += sin(uTime * 0.004 + aPhase * 3.14) * 0.3;
    pos.y += cos(uTime * 0.003 + aPhase * 6.28) * 0.2;

    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_Position  = projectionMatrix * mvPos;
    gl_PointSize = 1.0;

    // Filaments are nearly invisible — faint flicker in the void
    float flicker = 0.3 + 0.7 * abs(sin(uTime * 0.2 + aPhase * 29.3));
    vAlpha = 0.04 * flicker * smoothstep(0.0, 0.1, uProgress);
  }
`;

const FILAMENT_FRAG = /* glsl */ `
  varying float vAlpha;

  void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float d  = length(uv);
    if (d > 0.5) discard;

    float edge = 1.0 - smoothstep(0.0, 0.5, d);
    // Barely warm white — almost grey
    gl_FragColor = vec4(vec3(0.55, 0.48, 0.42), edge * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// DarkAges Era
// ---------------------------------------------------------------------------

const FILAMENT_COUNT = 500;

// Flickering point lights that appear and fade in the void
interface VoidFlicker {
  position: THREE.Vector3;
  phase:    number;
  speed:    number;
  color:    THREE.Color;
}

export class DarkAges extends BaseEra {
  private cloudMat!: THREE.ShaderMaterial;
  private cloudQuad!: THREE.Mesh;

  private filamentGeo!: THREE.BufferGeometry;
  private filamentMat!: THREE.ShaderMaterial;
  private filaments!: THREE.Points;

  private flickerLights: VoidFlicker[] = [];
  private flickerMeshes: THREE.Points[]  = [];
  private flickerMats:   THREE.ShaderMaterial[] = [];

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildCloudQuad();
    this.buildFilaments();
    this.buildFlickerLights();

    this.camera.position.set(0, 0, 5);
    this.camera.near   = 0.001;
    this.camera.far    = 1000;
    this.camera.fov    = 75;
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  // ----- Hydrogen cloud fullscreen quad -----

  private buildCloudQuad(): void {
    const geo = new THREE.PlaneGeometry(2, 2);

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:          { value: 0 },
        uProgress:      { value: 0 },
        uFirstStarGlow: { value: 0 },
      },
      vertexShader:   DARK_VERT,
      fragmentShader: DARK_FRAG,
      transparent:    true,
      depthTest:      false,
      depthWrite:     false,
    });

    this.cloudQuad = new THREE.Mesh(geo, this.cloudMat);
    this.cloudQuad.renderOrder = -1;
    this.scene.add(this.cloudQuad);
  }

  // ----- Cosmic web filament points -----

  private buildFilaments(): void {
    const positions = new Float32Array(FILAMENT_COUNT * 3);
    const phases    = new Float32Array(FILAMENT_COUNT);

    for (let i = 0; i < FILAMENT_COUNT; i++) {
      // Filaments distributed in a large sphere around the viewer
      const r     = 4 + Math.random() * 60;
      const theta = Math.random() * Math.PI;
      const phi   = Math.random() * Math.PI * 2;

      positions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.cos(theta);
      positions[i * 3 + 2] = r * Math.sin(theta) * Math.sin(phi);

      phases[i] = Math.random();
    }

    this.filamentGeo = new THREE.BufferGeometry();
    this.filamentGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.filamentGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));

    this.filamentMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   FILAMENT_VERT,
      fragmentShader: FILAMENT_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.filaments = new THREE.Points(this.filamentGeo, this.filamentMat);
    this.scene.add(this.filaments);
  }

  // ----- Void flicker lights -----
  // Tiny dim glowing points that randomly pulse in the darkness

  private buildFlickerLights(): void {
    // Use a tiny single-point geometry per flicker so each can fade independently
    const FLICKER_COUNT = 12;

    for (let i = 0; i < FLICKER_COUNT; i++) {
      const r     = 3 + Math.random() * 12;
      const theta = Math.random() * Math.PI;
      const phi   = Math.random() * Math.PI * 2;

      const pos = new THREE.Vector3(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.cos(theta),
        r * Math.sin(theta) * Math.sin(phi),
      );

      // Dim, barely-warm hues — blue-grey, deep violet
      const hue = 0.6 + Math.random() * 0.15;
      const col = new THREE.Color().setHSL(hue, 0.3, 0.08);

      this.flickerLights.push({
        position: pos,
        phase:    Math.random() * Math.PI * 2,
        speed:    0.3 + Math.random() * 0.6,
        color:    col,
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([pos.x, pos.y, pos.z]), 3));

      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime:     { value: 0 },
          uPhase:    { value: this.flickerLights[i].phase },
          uSpeed:    { value: this.flickerLights[i].speed },
          uColor:    { value: col },
          uProgress: { value: 0 },
        },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform float uPhase;
          uniform float uSpeed;
          uniform float uProgress;
          varying float vFlicker;

          void main() {
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            gl_Position  = projectionMatrix * mvPos;

            // Visible size — intentionally tiny so it looks distant
            float dist = length(mvPos.xyz);
            gl_PointSize = clamp(80.0 / dist, 0.5, 4.0);

            // Irregular pulsing
            float f1 = sin(uTime * uSpeed + uPhase);
            float f2 = sin(uTime * uSpeed * 2.7 + uPhase * 3.1);
            vFlicker = clamp((f1 * f2) * 0.5 + 0.5, 0.0, 1.0);
            vFlicker *= 0.35; // overall dim cap
            vFlicker *= smoothstep(0.0, 0.15, uProgress);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3  uColor;
          varying float vFlicker;

          void main() {
            vec2  uv = gl_PointCoord - 0.5;
            float d  = length(uv);
            if (d > 0.5) discard;

            float soft = exp(-d * 6.0);
            gl_FragColor = vec4(uColor * 2.0, soft * vFlicker);
          }
        `,
        transparent: true,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
      });

      const pts = new THREE.Points(geo, mat);
      this.scene.add(pts);
      this.flickerMeshes.push(pts);
      this.flickerMats.push(mat);
    }
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // First-star foreshadowing: grows from 0 → 1 over progress [0.95, 1.0]
    const firstStarGlow = easeOutExpo(smoothstep(0.95, 1.0, progress));

    this.cloudMat.uniforms.uTime.value          = globalTime;
    this.cloudMat.uniforms.uProgress.value      = progress;
    this.cloudMat.uniforms.uFirstStarGlow.value = firstStarGlow;

    this.filamentMat.uniforms.uTime.value     = globalTime;
    this.filamentMat.uniforms.uProgress.value = progress;

    // Glacially slow filament rotation — barely perceptible
    this.filaments.rotation.y = globalTime * 0.003;
    this.filaments.rotation.x = Math.sin(globalTime * 0.002) * 0.02;

    // Update flicker light uniforms
    for (const mat of this.flickerMats) {
      mat.uniforms.uTime.value     = globalTime;
      mat.uniforms.uProgress.value = progress;
    }

    // Camera drifts imperceptibly in the void — emphasises scale and emptiness
    const driftScale = lerp(0.08, 0.02, progress); // calms down as era progresses
    this.camera.position.x = Math.sin(globalTime * 0.015) * driftScale;
    this.camera.position.y = Math.cos(globalTime * 0.011) * driftScale * 0.6;
    this.camera.position.z = 5 + Math.sin(globalTime * 0.009) * 0.1;
    this.camera.lookAt(0, 0, 0);
  }

  getPostConfig(progress: number): PostConfig {
    // At progress 0.95+, the first-star glow needs a tiny bloom to sell the moment
    const starBloom = smoothstep(0.95, 1.0, progress) * 0.6;

    return {
      bloomStrength:       starBloom,
      bloomRadius:         0.3,
      bloomThreshold:      0.8, // high threshold — nothing should bloom except the star
      chromaticAberration: 0.0,
      filmGrain:           0.08, // grain is the texture in the blackness
      godRays:             false,
      godRayIntensity:     0.0,
      vignetteStrength:    lerp(0.6, 0.85, smoothstep(0.0, 1.0, progress)),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  getBackgroundColor(progress: number): THREE.Color {
    return getEraColor(3, progress);
  }

  override dispose(): void {
    this.cloudMat?.dispose();
    (this.cloudQuad?.geometry as THREE.BufferGeometry)?.dispose();
    this.filamentGeo?.dispose();
    this.filamentMat?.dispose();

    for (let i = 0; i < this.flickerMeshes.length; i++) {
      this.flickerMeshes[i].geometry.dispose();
      this.flickerMats[i].dispose();
    }
    this.flickerMeshes = [];
    this.flickerMats   = [];

    super.dispose();
  }
}
