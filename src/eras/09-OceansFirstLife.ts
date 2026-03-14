import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, randomInSphere } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Shared GLSL: full simplex 3D noise (Stefan Gustavson, public domain)
// ---------------------------------------------------------------------------

const GLSL_SIMPLEX3 = /* glsl */ `
  vec3 _mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _permute(vec4 x)  { return _mod289v4(((x * 34.0) + 1.0) * x); }
  vec4 _taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

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

    i = _mod289v3(i);
    vec4 p = _permute(_permute(_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;

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

    vec4 norm = _taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p, int oct) {
    float v = 0.0; float a = 0.5; float f = 1.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      v += a * snoise(p * f);
      f *= 2.1; a *= 0.48;
    }
    return v;
  }
`;

// ---------------------------------------------------------------------------
// Planet surface — vertex shader
// ---------------------------------------------------------------------------

const PLANET_VERT = /* glsl */ `
  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vPosition = position;
    vNormal   = normalize(normalMatrix * normal);
    vUv       = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Planet surface — fragment shader
// Rocky → water world based on uProgress. Clouds driven by time.
// ---------------------------------------------------------------------------

const PLANET_FRAG = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uProgress;
  uniform float uTime;

  varying vec3 vPosition;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    // Continent mask via simplex noise on sphere surface
    float land = smoothstep(0.48, 0.52, snoise(vPosition * 2.0 + 0.5));
    float ocean = 1.0 - land;
    ocean = mix(0.0, ocean, smoothstep(0.0, 0.3, uProgress));

    vec3 landColor  = vec3(0.3, 0.25, 0.15);
    // Subtle terrain variation
    landColor += snoise(vPosition * 6.0) * 0.05;
    vec3 oceanColor = mix(vec3(0.0, 0.08, 0.25), vec3(0.0, 0.2, 0.45),
                          snoise(vPosition * 3.0 + vec3(uTime * 0.01)) * 0.5 + 0.5);

    vec3 color = mix(landColor, oceanColor, ocean * smoothstep(0.0, 0.3, uProgress));

    // Specular shimmer on ocean
    vec3 lightDir = normalize(vec3(1.0, 0.5, 1.0));
    float spec = pow(max(dot(vNormal, lightDir), 0.0), 32.0);
    color += vec3(0.2, 0.4, 0.6) * spec * ocean * 0.6;

    // Diffuse lighting
    float diff = max(dot(vNormal, lightDir), 0.0);
    color *= mix(0.15, 1.0, diff);

    // Animated cloud layer
    float clouds = smoothstep(0.3, 0.7,
      snoise(vPosition * 4.0 + vec3(uTime * 0.04, uTime * 0.03, 0.0)));
    clouds = clouds * 0.45 * smoothstep(0.1, 0.3, uProgress);
    color = mix(color, vec3(0.95, 0.97, 1.0), clouds);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Atmosphere shell — vertex + fragment (fresnel rim glow)
// ---------------------------------------------------------------------------

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vNormal  = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const ATMO_FRAG = /* glsl */ `
  uniform float uProgress;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 3.5);
    vec3 atmoColor = mix(vec3(0.3, 0.6, 1.0), vec3(0.1, 0.4, 0.9), fresnel);
    float alpha = fresnel * 0.7 * smoothstep(0.05, 0.2, uProgress);
    gl_FragColor = vec4(atmoColor, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Underwater environment — fullscreen quad
// God rays + caustics + deep colour grade
// ---------------------------------------------------------------------------

const WATER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const WATER_FRAG = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uTime;
  uniform float uProgress;   // local era progress
  uniform float uDepth;      // 0 = surface, 1 = deep

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // God rays from surface
    float rays = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float centerX = 0.15 + fi * 0.14 + sin(uTime * 0.07 + fi) * 0.06;
      float rayAngle = (uv.x - centerX) * (8.0 + fi * 1.2);
      float rayStrength = exp(-abs(rayAngle) * (6.0 + fi));
      // Rays originate from top, fade toward bottom
      rayStrength *= smoothstep(1.0, 0.0, uv.y);
      // Animate brightness
      rayStrength *= 0.6 + 0.4 * sin(uTime * 0.4 + fi * 1.9);
      rays += rayStrength * 0.12;
    }

    // Deep-water base colour (bluer/darker with depth)
    float depthFactor = mix(0.3, 1.0, uDepth);
    vec3 waterColor = mix(
      vec3(0.0, 0.14, 0.28),   // surface-like — lighter teal
      vec3(0.0, 0.04, 0.10),   // abyss — near black
      depthFactor * uv.y
    );
    waterColor += vec3(0.05, 0.18, 0.3) * rays;

    // Caustic patterns (most visible mid-water, not at total abyss)
    float c1 = abs(sin(uv.x * 22.0 + uTime * 0.9) * sin(uv.y * 18.0 + uTime * 0.6));
    float c2 = abs(sin(uv.x * 17.0 - uTime * 0.7) * sin(uv.y * 25.0 + uTime * 0.8));
    float caustic = (c1 + c2) * 0.5;
    caustic *= smoothstep(1.0, 0.4, uv.y);   // only upper portion
    caustic *= (1.0 - depthFactor * 0.8);
    waterColor += vec3(0.0, 0.18, 0.25) * caustic * 0.25;

    // Distant murk / fog scattering
    float murk = snoise(vec3(uv * 1.8, uTime * 0.05)) * 0.5 + 0.5;
    waterColor = mix(waterColor, vec3(0.0, 0.06, 0.12), murk * 0.12 * uDepth);

    float alpha = smoothstep(0.48, 0.55, uProgress);
    gl_FragColor = vec4(waterColor, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Surface ripple overlay — brief transition effect
// ---------------------------------------------------------------------------

const RIPPLE_FRAG = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uTime;
  uniform float uRipple;   // 0..1, peaks around transition moment

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv - 0.5;
    float r = length(uv);

    // Expanding ring pattern from centre
    float ring = sin(r * 30.0 - uTime * 8.0) * 0.5 + 0.5;
    ring *= exp(-r * 3.0);
    ring *= exp(-abs(r - uRipple * 0.8) * 10.0);

    float rippleNoise = snoise(vec3(vUv * 8.0, uTime * 2.0)) * 0.5 + 0.5;
    float alpha = ring * uRipple * 0.7 + rippleNoise * uRipple * 0.1;

    gl_FragColor = vec4(vec3(0.4, 0.7, 1.0), clamp(alpha, 0.0, 0.8));
  }
`;

// ---------------------------------------------------------------------------
// Seabed plane — vertex shader with displacement
// ---------------------------------------------------------------------------

const SEABED_VERT = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uTime;
  varying vec3  vPos;
  varying float vHeight;

  void main() {
    vPos = position;
    // Displaced rocky terrain
    float disp = snoise(position * 0.6) * 0.8
               + snoise(position * 1.8 + vec3(0.5)) * 0.3
               + snoise(position * 5.0 + vec3(1.2)) * 0.12;
    vHeight = disp;
    vec3 displaced = position + normal * disp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`;

const SEABED_FRAG = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uTime;
  varying vec3  vPos;
  varying float vHeight;

  void main() {
    // Rocky dark basalt look
    float rock = snoise(vPos * 4.0) * 0.5 + 0.5;
    vec3 color = mix(vec3(0.05, 0.04, 0.04), vec3(0.12, 0.10, 0.08), rock);

    // Thin bioluminescent mineral veins
    float vein = smoothstep(0.44, 0.46, snoise(vPos * 9.0 + vec3(uTime * 0.01)));
    color += vec3(0.0, 0.3, 0.25) * vein * 0.4;

    // Rim lighting to show terrain edges
    float rim = 1.0 - smoothstep(0.0, 0.5, vHeight + 0.5);
    color = mix(color, vec3(0.0, 0.12, 0.18), rim * 0.3);

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Bioluminescent particle system — vertex + fragment
// ---------------------------------------------------------------------------

const BIO_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aFreq;
  attribute float aAppear;   // progress threshold to appear
  attribute float aSize;

  uniform float uProgress;
  uniform float uTime;

  varying float vPulse;
  varying float vVisible;
  varying float aPhaseV;

  void main() {
    // Drift gently in 3D — offset position per particle via phase
    vec3 pos = position;
    pos.x += sin(uTime * 0.3 + aPhase * 6.28) * 0.25;
    pos.y += sin(uTime * 0.5 + aPhase * 3.14) * 0.18
           + cos(uTime * 0.2 + aFreq)          * 0.12;
    pos.z += cos(uTime * 0.4 + aPhase * 4.71) * 0.2;

    float visible = smoothstep(aAppear, aAppear + 0.05, uProgress);
    vVisible = visible;

    float pulse  = 0.6 + 0.4 * sin(uTime * aFreq + aPhase * 6.28318);
    vPulse = pulse;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    float dist  = -mvPos.z;
    gl_PointSize = clamp(aSize * (350.0 / dist) * pulse * visible, 0.0, 80.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const BIO_FRAG = /* glsl */ `
  varying float vPulse;
  varying float vVisible;

  uniform float uTime;

  void main() {
    if (vVisible < 0.01) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float core = exp(-d * 10.0);
    float halo = exp(-d *  3.5) * 0.5;
    float intensity = (core + halo) * vPulse * vVisible;

    // Alternate between cyan and green per fragment based on a stable selector
    // We use gl_PointCoord to pseudo-randomly tint
    float tint = step(0.5, fract(gl_PointCoord.x * 7.3 + gl_PointCoord.y * 4.1));
    vec3 cyan  = vec3(0.0, 1.0, 0.8);
    vec3 green = vec3(0.27, 1.0, 0.53);
    vec3 col   = mix(cyan, green, tint);

    gl_FragColor = vec4(col * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// Hydrothermal vent smoke — vertex + fragment
// ---------------------------------------------------------------------------

const VENT_VERT = /* glsl */ `
  attribute float aLife;     // 0=fresh, 1=old
  attribute float aSeed;
  attribute float aVentIdx;  // which vent

  uniform float uTime;

  varying float vLife;
  varying float vAlpha;

  void main() {
    // Rise and expand as life increases
    vec3 pos = position;
    float rise   = aLife * 4.0;
    float spread = aLife * (0.8 + aSeed * 0.4);

    pos.y += rise;
    pos.x += sin(aSeed * 12.566 + uTime * 0.6 + aVentIdx) * spread;
    pos.z += cos(aSeed * 9.425  + uTime * 0.5 + aVentIdx) * spread;

    vLife  = aLife;
    vAlpha = (1.0 - aLife) * (1.0 - aLife); // fade as it rises

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = clamp((8.0 + aLife * 30.0) * (200.0 / -mvPos.z), 1.0, 100.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const VENT_FRAG = /* glsl */ `
  varying float vLife;
  varying float vAlpha;

  void main() {
    if (vAlpha < 0.01) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float alpha = exp(-d * 4.0) * vAlpha;
    // Dark brown-grey smoke, slightly warm near vent, cold at top
    vec3 color = mix(vec3(0.35, 0.28, 0.22), vec3(0.18, 0.17, 0.18), vLife);
    gl_FragColor = vec4(color, alpha * 0.6);
  }
`;

// ---------------------------------------------------------------------------
// DNA Helix — vertex + fragment shaders
// ---------------------------------------------------------------------------

const DNA_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aHeight;   // 0 at bottom, 1 at top — for reveal animation

  uniform float uReveal;     // 0–1, how much of the helix is visible
  uniform float uTime;

  varying float vGlow;

  void main() {
    // Only show particles below the reveal threshold
    float visible = smoothstep(uReveal - 0.05, uReveal, 1.0 - aHeight);
    if (visible < 0.01) {
      gl_Position = vec4(0.0, 0.0, -999.0, 1.0);
      gl_PointSize = 0.0;
      vGlow = 0.0;
      return;
    }

    // Gentle rotation around Y axis
    float angle = uTime * 0.3;
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec3 pos = position;
    float newX = pos.x * cosA - pos.z * sinA;
    float newZ = pos.x * sinA + pos.z * cosA;
    pos.x = newX;
    pos.z = newZ;

    // Pulse
    float pulse = 0.8 + 0.2 * sin(uTime * 2.0 + aPhase);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;
    float ps = 3.0 * pulse * (150.0 / -mvPos.z);
    gl_PointSize = clamp(ps, 0.5, 6.0);

    vGlow = visible * pulse;
  }
`;

const DNA_FRAG = /* glsl */ `
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = exp(-d * 8.0);
    // Cyan-green bio glow
    vec3 col = mix(vec3(0.0, 1.0, 0.8), vec3(0.2, 0.8, 1.0), d * 2.0);
    gl_FragColor = vec4(col * soft * vGlow, soft * vGlow);
  }
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BIO_COUNT  = 600;
const VENT_COUNT = 5;
const SMOKE_PER_VENT = 120;
const TOTAL_SMOKE = VENT_COUNT * SMOKE_PER_VENT;

// ---------------------------------------------------------------------------
// OceansFirstLife Era
// ---------------------------------------------------------------------------

export class OceansFirstLife extends BaseEra {
  // --- Act 1: planet
  private planetMesh!: THREE.Mesh;
  private planetMat!:  THREE.ShaderMaterial;
  private atmoMesh!:   THREE.Mesh;
  private atmoMat!:    THREE.ShaderMaterial;

  // --- Act 2 / 3: underwater quad
  private waterQuad!:    THREE.Mesh;
  private waterMat!:     THREE.ShaderMaterial;
  private rippleQuad!:   THREE.Mesh;
  private rippleMat!:    THREE.ShaderMaterial;

  // --- Act 3: seabed
  private seabedMesh!:  THREE.Mesh;
  private seabedMat!:   THREE.ShaderMaterial;

  // --- Act 3: bioluminescent particles
  private bioGeo!:      THREE.BufferGeometry;
  private bioMat!:      THREE.ShaderMaterial;
  private bioPoints!:   THREE.Points;

  // --- Act 3: vent smoke
  private ventGeo!:     THREE.BufferGeometry;
  private ventMat!:     THREE.ShaderMaterial;
  private ventPoints!:  THREE.Points;
  private ventAgeArr!:  Float32Array;

  // --- Act 3: DNA double helix
  private helixGeo!:    THREE.BufferGeometry;
  private helixMat!:    THREE.ShaderMaterial;
  private helixPoints!: THREE.Points;

  // Internal state
  private ventPositions!: THREE.Vector3[];

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.camera.fov  = 70;
    this.camera.near = 0.01;
    this.camera.far  = 5000;
    this.camera.position.set(0, 0, 15);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.buildPlanet();
    this.buildAtmosphere();
    this.buildWaterQuad();
    this.buildRippleOverlay();
    this.buildSeabed();
    this.buildBioParticles();
    this.buildVentSmoke();
    this.buildDNAHelix();

    this.isInitialized = true;
  }

  // -------------------------------------------------------------------------

  private buildPlanet(): void {
    const geo = new THREE.SphereGeometry(5, 128, 64);
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      side: THREE.FrontSide,
    });
    this.planetMesh = new THREE.Mesh(geo, this.planetMat);
    this.scene.add(this.planetMesh);
  }

  private buildAtmosphere(): void {
    const geo = new THREE.SphereGeometry(5.35, 64, 32);
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { uProgress: { value: 0 } },
      vertexShader:   ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite:  false,
      side:        THREE.BackSide,
      blending:    THREE.AdditiveBlending,
    });
    this.atmoMesh = new THREE.Mesh(geo, this.atmoMat);
    this.scene.add(this.atmoMesh);
  }

  private buildWaterQuad(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
        uDepth:    { value: 0 },
      },
      vertexShader:   WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite:  false,
      depthTest:   false,
    });
    this.waterQuad = new THREE.Mesh(geo, this.waterMat);
    this.waterQuad.frustumCulled = false;
    this.waterQuad.renderOrder   = -2;
    this.scene.add(this.waterQuad);
  }

  private buildRippleOverlay(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.rippleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:   { value: 0 },
        uRipple: { value: 0 },
      },
      vertexShader:   WATER_VERT,
      fragmentShader: RIPPLE_FRAG,
      transparent: true,
      depthWrite:  false,
      depthTest:   false,
      blending:    THREE.AdditiveBlending,
    });
    this.rippleQuad = new THREE.Mesh(geo, this.rippleMat);
    this.rippleQuad.frustumCulled = false;
    this.rippleQuad.renderOrder   = 5;
    this.scene.add(this.rippleQuad);
  }

  private buildSeabed(): void {
    // High-resolution plane for displacement
    const geo = new THREE.PlaneGeometry(24, 24, 120, 120);
    geo.rotateX(-Math.PI / 2);
    this.seabedMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader:   SEABED_VERT,
      fragmentShader: SEABED_FRAG,
      side: THREE.FrontSide,
    });
    this.seabedMesh = new THREE.Mesh(geo, this.seabedMat);
    this.seabedMesh.position.set(0, -4.5, 0);
    this.scene.add(this.seabedMesh);
  }

  private buildBioParticles(): void {
    this.bioGeo = new THREE.BufferGeometry();

    const positions = new Float32Array(BIO_COUNT * 3);
    const phases    = new Float32Array(BIO_COUNT);
    const freqs     = new Float32Array(BIO_COUNT);
    const appears   = new Float32Array(BIO_COUNT);
    const sizes     = new Float32Array(BIO_COUNT);

    for (let i = 0; i < BIO_COUNT; i++) {
      // Scatter in a volume around the seabed
      positions[i * 3]     = (Math.random() - 0.5) * 20;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 6  - 1.5; // mid-water to near seabed
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20;

      phases[i]  = Math.random() * Math.PI * 2;
      freqs[i]   = 0.8 + Math.random() * 2.2;
      // First few appear at 0.6, rest spread to 0.95
      appears[i] = 0.6 + (i / BIO_COUNT) * 0.35;
      sizes[i]   = 4.0 + Math.random() * 10.0;
    }

    this.bioGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.bioGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    this.bioGeo.setAttribute('aFreq',    new THREE.BufferAttribute(freqs,     1));
    this.bioGeo.setAttribute('aAppear',  new THREE.BufferAttribute(appears,   1));
    this.bioGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));

    this.bioMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   BIO_VERT,
      fragmentShader: BIO_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.bioPoints = new THREE.Points(this.bioGeo, this.bioMat);
    this.scene.add(this.bioPoints);
  }

  private buildVentSmoke(): void {
    // Place vents across the seabed
    this.ventPositions = [];
    const ventXZ = [
      [-3, -2], [2, -4], [-5, 3], [4, 2], [0, -5],
    ];
    for (const [x, z] of ventXZ) {
      this.ventPositions.push(new THREE.Vector3(x, -4.0, z));
    }

    this.ventGeo = new THREE.BufferGeometry();

    const positions = new Float32Array(TOTAL_SMOKE * 3);
    const lives     = new Float32Array(TOTAL_SMOKE);
    const seeds     = new Float32Array(TOTAL_SMOKE);
    const ventIdxs  = new Float32Array(TOTAL_SMOKE);

    this.ventAgeArr = lives;

    for (let v = 0; v < VENT_COUNT; v++) {
      const vp = this.ventPositions[v];
      for (let p = 0; p < SMOKE_PER_VENT; p++) {
        const idx = v * SMOKE_PER_VENT + p;
        positions[idx * 3]     = vp.x;
        positions[idx * 3 + 1] = vp.y;
        positions[idx * 3 + 2] = vp.z;

        // Stagger lifetimes so particles continuously stream
        lives[idx]    = (p / SMOKE_PER_VENT);
        seeds[idx]    = Math.random();
        ventIdxs[idx] = v;
      }
    }

    this.ventGeo.setAttribute('position',  new THREE.BufferAttribute(positions, 3));
    this.ventGeo.setAttribute('aLife',     new THREE.BufferAttribute(lives,     1));
    this.ventGeo.setAttribute('aSeed',     new THREE.BufferAttribute(seeds,     1));
    this.ventGeo.setAttribute('aVentIdx',  new THREE.BufferAttribute(ventIdxs,  1));

    this.ventMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader:   VENT_VERT,
      fragmentShader: VENT_FRAG,
      transparent:    true,
      depthWrite:     false,
    });

    this.ventPoints = new THREE.Points(this.ventGeo, this.ventMat);
    this.scene.add(this.ventPoints);
  }

  // -------------------------------------------------------------------------
  // DNA double helix — rises from the ocean floor during progress 0.65–0.9
  // -------------------------------------------------------------------------

  private buildDNAHelix(): void {
    const pointsPerStrand = 3000;
    const totalPoints     = pointsPerStrand * 2;

    const helixRadius = 0.3;
    const helixPitch  = 0.15; // vertical rise per radian
    const totalTurns  = 8;

    // We'll also add rung particles connecting the two strands.
    // One rung every 30 points along strand 0, bridged with 5 particles each.
    const rungInterval   = 30;
    const rungParticles  = 5;
    const rungCount      = Math.floor(pointsPerStrand / rungInterval);
    const totalRungPts   = rungCount * rungParticles;
    const grandTotal     = totalPoints + totalRungPts;

    const positions = new Float32Array(grandTotal * 3);
    const phases    = new Float32Array(grandTotal);
    const heights   = new Float32Array(grandTotal);

    for (let strand = 0; strand < 2; strand++) {
      const offset = strand * Math.PI; // 180° phase for double helix

      for (let i = 0; i < pointsPerStrand; i++) {
        const idx   = strand * pointsPerStrand + i;
        const t     = i / pointsPerStrand;
        const angle = t * totalTurns * Math.PI * 2 + offset;
        const y     = t * totalTurns * helixPitch * Math.PI * 2 - 3; // start below origin

        positions[idx * 3]     = Math.cos(angle) * helixRadius;
        positions[idx * 3 + 1] = y;
        positions[idx * 3 + 2] = Math.sin(angle) * helixRadius;

        phases[idx]  = Math.random() * Math.PI * 2;
        heights[idx] = t; // 0=bottom, 1=top
      }
    }

    // Rung particles
    for (let r = 0; r < rungCount; r++) {
      const i       = r * rungInterval;
      const t       = i / pointsPerStrand;
      const angle0  = t * totalTurns * Math.PI * 2;          // strand 0 angle
      const angle1  = angle0 + Math.PI;                       // strand 1 angle (180° offset)
      const y       = t * totalTurns * helixPitch * Math.PI * 2 - 3;

      const ax = Math.cos(angle0) * helixRadius;
      const az = Math.sin(angle0) * helixRadius;
      const bx = Math.cos(angle1) * helixRadius;
      const bz = Math.sin(angle1) * helixRadius;

      for (let p = 0; p < rungParticles; p++) {
        const lerpT  = (p + 1) / (rungParticles + 1);
        const rungIdx = totalPoints + r * rungParticles + p;

        positions[rungIdx * 3]     = ax + (bx - ax) * lerpT;
        positions[rungIdx * 3 + 1] = y;
        positions[rungIdx * 3 + 2] = az + (bz - az) * lerpT;

        phases[rungIdx]  = Math.random() * Math.PI * 2;
        heights[rungIdx] = t;
      }
    }

    this.helixGeo = new THREE.BufferGeometry();
    this.helixGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.helixGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    this.helixGeo.setAttribute('aHeight',  new THREE.BufferAttribute(heights,   1));

    this.helixMat = new THREE.ShaderMaterial({
      uniforms: {
        uReveal: { value: 0 },
        uTime:   { value: 0 },
      },
      vertexShader:   DNA_VERT,
      fragmentShader: DNA_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.helixPoints = new THREE.Points(this.helixGeo, this.helixMat);
    // Position near the hydrothermal vent cluster (centre-front of seabed)
    this.helixPoints.position.set(0, -2.5, -1);
    this.helixPoints.visible = false;
    this.scene.add(this.helixPoints);
  }

  // -------------------------------------------------------------------------
  // Update — orchestrates the three acts
  // -------------------------------------------------------------------------

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // ---- Shared uniform updates ----
    this.planetMat.uniforms.uTime.value     = globalTime;
    this.planetMat.uniforms.uProgress.value = progress;
    this.atmoMat.uniforms.uProgress.value   = progress;
    this.waterMat.uniforms.uTime.value      = globalTime;
    this.waterMat.uniforms.uProgress.value  = progress;
    this.rippleMat.uniforms.uTime.value     = globalTime;
    this.seabedMat.uniforms.uTime.value     = globalTime;
    this.bioMat.uniforms.uTime.value        = globalTime;
    this.bioMat.uniforms.uProgress.value    = progress;
    this.ventMat.uniforms.uTime.value       = globalTime;

    // ---- Vent smoke: advance particle lifetimes ----
    {
      const lifeAttr = this.ventGeo.getAttribute('aLife') as THREE.BufferAttribute;
      const lifeArr  = lifeAttr.array as Float32Array;
      for (let i = 0; i < TOTAL_SMOKE; i++) {
        lifeArr[i] += delta * 0.25;
        if (lifeArr[i] > 1.0) lifeArr[i] -= 1.0;
      }
      lifeAttr.needsUpdate = true;
    }

    // ---- Visibility: show/hide per act ----
    const act1 = progress < 0.3;
    const act2 = progress >= 0.3 && progress < 0.5;
    const act3 = progress >= 0.5;

    this.planetMesh.visible = progress < 0.52;
    this.atmoMesh.visible   = progress < 0.52;
    this.waterQuad.visible  = progress >= 0.42;
    this.seabedMesh.visible = act3;
    this.bioPoints.visible  = act3;
    this.ventPoints.visible = act3;

    // Ripple effect: brief window around the surface break (0.46–0.56)
    const rippleProgress = clamp((progress - 0.46) / 0.10, 0.0, 1.0);
    const ripplePeak     = 1.0 - Math.abs(rippleProgress - 0.5) * 2.0;
    this.rippleMat.uniforms.uRipple.value = ripplePeak;
    this.rippleQuad.visible = rippleProgress > 0 && rippleProgress < 1;

    // Underwater depth factor: 0 near surface, 1 deep
    const depthFactor = clamp((progress - 0.5) / 0.5, 0.0, 1.0);
    this.waterMat.uniforms.uDepth.value = depthFactor;

    // ---- Camera ----
    if (act1) {
      // Orbiting the planet at distance 15
      const t     = progress / 0.3;
      const orbit = globalTime * 0.08;
      const dist  = 15.0;
      this.camera.position.set(
        Math.sin(orbit) * dist * 0.15,
        Math.sin(globalTime * 0.05) * 2.0,
        dist,
      );
      this.camera.lookAt(0, 0, 0);

      // Gentle planet rotation
      this.planetMesh.rotation.y = globalTime * 0.03;
      this.atmoMesh.rotation.y   = globalTime * 0.028;

    } else if (act2) {
      // Zoom toward surface then below water
      const t = (progress - 0.3) / 0.2;
      // Exponential zoom: 15 → 0.5
      const dist = lerp(15.0, 0.5, t * t * t);
      this.camera.position.set(
        Math.sin(globalTime * 0.1) * dist * 0.05,
        Math.cos(globalTime * 0.07) * dist * 0.04,
        dist,
      );
      this.camera.lookAt(0, 0, 0);

      this.planetMesh.rotation.y = globalTime * 0.03;
      this.atmoMesh.rotation.y   = globalTime * 0.028;

    } else {
      // Act 3: underwater drifting camera
      const t = (progress - 0.5) / 0.5;

      // Slowly drift forward and gently look around
      const driftX = Math.sin(globalTime * 0.12) * 2.5;
      const driftY = Math.sin(globalTime * 0.08) * 0.8 - 1.0; // slightly below center
      const driftZ = 8.0 + Math.sin(globalTime * 0.05) * 1.5;

      this.camera.position.set(driftX, driftY, driftZ);

      // Look slightly downward toward the seabed
      const lookAtY = lerp(0.0, -2.5, smoothstep(0.5, 1.0, progress));
      this.camera.lookAt(
        Math.sin(globalTime * 0.06) * 1.5,
        lookAtY,
        0,
      );
    }

    // ---- DNA helix: visible during progress 0.65–0.9 ----
    if (progress >= 0.65 && progress <= 0.95) {
      this.helixPoints.visible = true;
      // Map 0.65→0.9 to uReveal 0→1
      const reveal = smoothstep(0.65, 0.90, progress);
      this.helixMat.uniforms.uReveal.value = reveal;
      this.helixMat.uniforms.uTime.value   = globalTime;
    } else {
      this.helixPoints.visible = false;
    }
  }

  // -------------------------------------------------------------------------
  // Post config
  // -------------------------------------------------------------------------

  getPostConfig(progress: number): PostConfig {
    const act3T = clamp((progress - 0.5) / 0.5, 0.0, 1.0);

    // Bloom: moderate in act1, increased on bioluminescence
    const bloom = progress < 0.5
      ? lerp(0.6, 1.0, progress / 0.5)
      : lerp(1.0, 1.5, act3T);

    return {
      bloomStrength:       bloom,
      bloomRadius:         lerp(0.5, 0.7, act3T),
      bloomThreshold:      lerp(0.3, 0.15, act3T),
      chromaticAberration: lerp(0.002, 0.006, smoothstep(0.3, 0.5, progress)),
      filmGrain:           lerp(0.03, 0.05, act3T),
      godRays:             progress > 0.5,
      godRayIntensity:     lerp(0.0, 0.5, smoothstep(0.5, 0.65, progress)),
      vignetteStrength:    lerp(0.4, 0.7, act3T),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  // -------------------------------------------------------------------------
  // Background colour
  // -------------------------------------------------------------------------

  getBackgroundColor(progress: number): THREE.Color {
    // Ocean blue (#003366) → mid-teal (#004444) → deep teal (#002222)
    const oceanBlue = new THREE.Color(0x003366);
    const midTeal   = new THREE.Color(0x004444);
    const deepTeal  = new THREE.Color(0x002222);

    if (progress < 0.5) {
      return oceanBlue.clone().lerp(midTeal, progress / 0.5);
    }
    return midTeal.clone().lerp(deepTeal, (progress - 0.5) / 0.5);
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    this.planetMat?.dispose();
    this.atmoMat?.dispose();
    this.waterMat?.dispose();
    this.rippleMat?.dispose();
    this.seabedMat?.dispose();
    this.bioGeo?.dispose();
    this.bioMat?.dispose();
    this.ventGeo?.dispose();
    this.ventMat?.dispose();
    (this.planetMesh?.geometry as THREE.BufferGeometry)?.dispose();
    (this.atmoMesh?.geometry as THREE.BufferGeometry)?.dispose();
    (this.waterQuad?.geometry as THREE.BufferGeometry)?.dispose();
    (this.rippleQuad?.geometry as THREE.BufferGeometry)?.dispose();
    (this.seabedMesh?.geometry as THREE.BufferGeometry)?.dispose();
    // DNA helix
    this.helixGeo?.dispose();
    this.helixMat?.dispose();
    super.dispose();
  }
}
