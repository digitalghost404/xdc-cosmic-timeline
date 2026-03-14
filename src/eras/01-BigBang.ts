import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, randomInSphere, easeOutExpo } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Pre-bang void — breathing dark cosmos with pulsing singularity
// ---------------------------------------------------------------------------

const VOID_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const VOID_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 397.297));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);

    float dust1 = fbm(vUv * 3.0 + uTime * 0.02);
    float dust2 = fbm(vUv * 5.0 - uTime * 0.015 + 10.0);
    float dust = pow(dust1 * dust2, 2.0) * 0.15;
    vec3 dustCol = mix(vec3(0.02, 0.005, 0.04), vec3(0.04, 0.01, 0.06), dust1) * dust * 6.0;

    float filament = pow(smoothstep(0.45, 0.55, fbm(vUv * 8.0 + uTime * 0.01 + 5.0)), 4.0) * 0.04;
    dustCol += vec3(0.03, 0.02, 0.05) * filament;

    float pulse = 0.7 + 0.3 * sin(uTime * 1.2) * sin(uTime * 0.7 + 0.5);
    float singularity = exp(-dist * dist / 0.003) * pulse;
    float ring1 = exp(-pow(dist - 0.04, 2.0) / 0.0004) * 0.15 * pulse;
    float ring2 = exp(-pow(dist - 0.08, 2.0) / 0.0008) * 0.08 * (0.5 + 0.5 * sin(uTime * 0.8));

    vec3 singCol = vec3(1.0, 0.95, 0.85) * singularity * 1.5;
    singCol += vec3(0.4, 0.3, 1.0) * ring1;
    singCol += vec3(0.6, 0.2, 0.8) * ring2;

    float angle = atan(center.y, center.x);
    float rays = sin(angle * 8.0 + uTime * 0.3) * 0.5 + 0.5;
    rays *= sin(angle * 13.0 - uTime * 0.2) * 0.5 + 0.5;
    rays *= exp(-dist * 6.0) * 0.06 * pulse;
    singCol += vec3(0.5, 0.3, 0.8) * rays;

    vec3 col = (dustCol + singCol) * (1.0 - smoothstep(0.0, 0.15, uProgress));
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Cinematic explosion flash — fullscreen detonation effect
// White-hot flash → radial blast lines → energy dissipation
// ---------------------------------------------------------------------------

const EXPLOSION_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const EXPLOSION_FRAG = /* glsl */ `
  uniform float uDetonation; // 0 = nothing, peaks at 1, then decays
  uniform float uTime;
  uniform float uProgress;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 397.297));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }

  void main() {
    vec2 center = vUv - 0.5;
    float dist = length(center);
    float angle = atan(center.y, center.x);
    float det = uDetonation;

    if (det < 0.001) { discard; return; }

    // === WHITE FLASH — blinding core that fades ===
    float flashIntensity = pow(max(det, 0.0), 0.3) * exp(-dist * 2.0);
    // Add screen-filling flash that peaks then fades
    float screenFlash = pow(max(det, 0.0), 0.5) * (1.0 - dist * 0.5);
    screenFlash = max(screenFlash, 0.0);

    // === RADIAL BLAST LINES — streaks radiating from center ===
    float numRays = 48.0;
    float rayPattern = 0.0;
    // Multiple ray frequencies for complexity
    rayPattern += pow(abs(sin(angle * numRays * 0.5 + 1.0)), 20.0);
    rayPattern += pow(abs(sin(angle * numRays + 3.0)), 30.0) * 0.5;
    rayPattern += pow(abs(sin(angle * numRays * 2.0 + 7.0)), 40.0) * 0.25;
    // Rays extend outward as detonation progresses
    float rayExtent = det * 1.5;
    float rayFalloff = exp(-dist / (rayExtent + 0.001)) * det;
    float rays = rayPattern * rayFalloff * 0.6;

    // === EXPANDING RING — a bright energy wavefront ===
    float ringRadius = det * 0.8;
    float ringWidth = 0.015 + det * 0.02;
    float ring = exp(-pow(dist - ringRadius, 2.0) / (ringWidth * ringWidth));
    // Second ring (slightly behind, fainter)
    float ring2Radius = det * 0.6;
    float ring2 = exp(-pow(dist - ring2Radius, 2.0) / (ringWidth * ringWidth * 2.0)) * 0.4;
    // Third ring
    float ring3Radius = det * 0.4;
    float ring3 = exp(-pow(dist - ring3Radius, 2.0) / (ringWidth * ringWidth * 3.0)) * 0.2;

    // === CHROMATIC DISPERSION on rings ===
    vec3 ringColor = vec3(0.0);
    float dispOffset = 0.008 * det;
    float ringR = exp(-pow(dist - ringRadius + dispOffset, 2.0) / (ringWidth * ringWidth));
    float ringB = exp(-pow(dist - ringRadius - dispOffset, 2.0) / (ringWidth * ringWidth));
    ringColor.r = ringR * 1.2;
    ringColor.g = ring * 1.0;
    ringColor.b = ringB * 1.5;

    // === VOLUMETRIC GOD RAYS — radial light shafts ===
    float godRays = 0.0;
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float rayAngle = fi * 1.047 + uTime * 0.2 + fi * 0.5; // ~60° apart, slowly rotating
      float angleDiff = abs(mod(angle - rayAngle + 3.14159, 6.28318) - 3.14159);
      float shaft = exp(-angleDiff * angleDiff / 0.01) * exp(-dist * 3.0);
      godRays += shaft;
    }
    godRays *= det * 0.4;

    // === ENERGY TENDRILS — noise-driven filaments ===
    float tendrils = noise(vec2(angle * 8.0 + uTime, dist * 5.0 - det * 10.0));
    tendrils = pow(tendrils, 3.0) * exp(-dist * 4.0) * det * 0.3;

    // === COMPOSE ===
    // Color: white-hot core → golden → amber at edges
    vec3 coreColor = vec3(1.0, 1.0, 1.0);
    vec3 midColor = vec3(1.0, 0.85, 0.5);
    vec3 edgeColor = vec3(1.0, 0.5, 0.15);

    vec3 col = vec3(0.0);
    // Screen flash
    col += coreColor * screenFlash * 0.7;
    // Central flash
    col += mix(coreColor, midColor, dist * 3.0) * flashIntensity;
    // Radial blast lines
    col += mix(midColor, edgeColor, dist * 2.0) * rays;
    // Rings with chromatic dispersion
    col += ringColor * (ring + ring2 + ring3) * 1.5;
    // God rays
    col += mix(coreColor, midColor, 0.5) * godRays;
    // Energy tendrils
    col += edgeColor * tendrils;

    float alpha = clamp(screenFlash * 0.8 + flashIntensity + rays + (ring + ring2 + ring3) * 0.8 + godRays + tendrils, 0.0, 1.0);

    gl_FragColor = vec4(col, alpha * det);
  }
`;

// ---------------------------------------------------------------------------
// Particle explosion
// ---------------------------------------------------------------------------

const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aVelocity;
  attribute float aBaseTemp;
  attribute float aPhase;

  uniform float uProgress;
  uniform float uTime;
  uniform float uExpansion;
  uniform float uCoolingFactor;
  uniform float uScrollVelocity;

  varying float vTemp;
  varying float vAlpha;
  varying float vDist;

  void main() {
    vTemp = aBaseTemp * uCoolingFactor;

    float phaseMod = 1.0 + aPhase * 0.25;
    vec3 pos = position + aVelocity * uExpansion * phaseMod;

    float turbStrength = (1.0 - uProgress) * 0.08;
    pos += aVelocity * sin(uTime * 2.0 + aPhase * 6.283) * turbStrength;
    pos.y += cos(uTime * 1.5 + aPhase * 4.0) * turbStrength * 0.5;

    float shake = abs(uScrollVelocity) * 0.03;
    pos.x += sin(uTime * 30.0) * shake;
    pos.y += cos(uTime * 25.0) * shake;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    vDist = length(pos);

    float sizeScale = mix(8.0, 1.2, smoothstep(0.0, 0.6, uProgress));
    gl_PointSize = aSize * sizeScale * (350.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 80.0);

    float fadeIn = smoothstep(0.03, 0.1, uProgress);
    float fadeOut = 1.0 - smoothstep(0.85, 1.0, uProgress);
    vAlpha = fadeIn * fadeOut;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform float uProgress;
  varying float vTemp;
  varying float vAlpha;
  varying float vDist;

  vec3 blackbody(float kelvin) {
    float t = kelvin / 100.0;
    float r, g, b;
    if (t <= 66.0) { r = 1.0; }
    else { r = clamp(329.698727446 * pow(t - 60.0, -0.1332047592) / 255.0, 0.0, 1.0); }
    if (t <= 66.0) { g = clamp((99.4708025861 * log(t) - 161.1195681661) / 255.0, 0.0, 1.0); }
    else { g = clamp(288.1221695283 * pow(t - 60.0, -0.0755148492) / 255.0, 0.0, 1.0); }
    if (t >= 66.0) { b = 1.0; }
    else if (t <= 19.0) { b = 0.0; }
    else { b = clamp((138.5177312231 * log(t - 10.0) - 305.0447927307) / 255.0, 0.0, 1.0); }
    return vec3(r, g, b);
  }

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float softEdge = 1.0 - smoothstep(0.15, 0.5, d);
    vec3 col = blackbody(vTemp);

    float coreIntensity = mix(3.0, 1.0, smoothstep(0.0, 0.5, uProgress));
    col += col * exp(-d * 8.0) * coreIntensity;

    float dispersion = smoothstep(0.3, 0.5, d) * (1.0 - uProgress) * 0.3;
    col.r += dispersion * 0.5;
    col.b += dispersion * 0.8;

    gl_FragColor = vec4(col, softEdge * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Shockwave sphere
// ---------------------------------------------------------------------------

const SHOCKWAVE_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalMatrix * normal;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHOCKWAVE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 4.0);
    float edge = fresnel * 2.5;
    vec3 col = vec3(edge * 1.2, edge * 0.9, edge * 1.8);
    col *= 0.9 + 0.1 * sin(uTime * 15.0 + fresnel * 20.0);
    col += vec3(pow(fresnel, 8.0) * 3.0);
    gl_FragColor = vec4(col, fresnel * uOpacity);
  }
`;

// ---------------------------------------------------------------------------
// Debris trails — hot embers with motion trails
// ---------------------------------------------------------------------------

const DEBRIS_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aVelocity;
  attribute float aPhase;
  attribute float aTrailLen;

  uniform float uProgress;
  uniform float uTime;
  uniform float uExpansion;

  varying float vAlpha;
  varying float vHeat;

  void main() {
    float phaseMod = 1.0 + aPhase * 0.3;
    vec3 pos = position + aVelocity * uExpansion * phaseMod * 1.3;

    // Extra velocity for debris (faster than main particles)
    pos += aVelocity * sin(uTime * 3.0 + aPhase * 4.0) * 0.03;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float sizeScale = mix(4.0, 0.5, smoothstep(0.0, 0.7, uProgress));
    gl_PointSize = aSize * sizeScale * (250.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 32.0);

    float fadeIn = smoothstep(0.04, 0.12, uProgress);
    float fadeOut = 1.0 - smoothstep(0.6, 0.9, uProgress);
    vAlpha = fadeIn * fadeOut;
    vHeat = 1.0 - smoothstep(0.0, 0.5, uProgress);
  }
`;

const DEBRIS_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vHeat;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Elongated shape — stretched along one axis for motion trail feel
    float streak = exp(-abs(uv.y) * 12.0) * exp(-abs(uv.x) * 4.0);
    float core = exp(-d * 10.0);
    float shape = max(streak * 0.7, core);

    // Hot white-yellow → cooling orange-red
    vec3 col = mix(vec3(1.0, 0.4, 0.05), vec3(1.0, 0.95, 0.8), vHeat);
    col *= shape * 2.0;

    gl_FragColor = vec4(col, shape * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// BigBang Era
// ---------------------------------------------------------------------------

const PARTICLE_COUNT = 350_000;
const DEBRIS_COUNT = 15_000;

export class BigBang extends BaseEra {
  private particleMat!: THREE.ShaderMaterial;
  private particleGeo!: THREE.BufferGeometry;
  private particles!: THREE.Points;

  private singularityMesh!: THREE.Mesh;
  private singularityMat!: THREE.ShaderMaterial;

  private shockwaveMesh!: THREE.Mesh;
  private shockwaveMat!: THREE.ShaderMaterial;

  private shockwave2Mesh!: THREE.Mesh;
  private shockwave2Mat!: THREE.ShaderMaterial;

  private voidQuad!: THREE.Mesh;
  private voidMat!: THREE.ShaderMaterial;

  private explosionQuad!: THREE.Mesh;
  private explosionMat!: THREE.ShaderMaterial;

  private debrisPoints!: THREE.Points;
  private debrisMat!: THREE.ShaderMaterial;
  private debrisGeo!: THREE.BufferGeometry;

  private scrollVelocity: number = 0;

  // Narration-synced detonation: explosion is driven by elapsed time
  // after detonate() is called, NOT by scroll progress.
  private detonated: boolean = false;
  private detonationElapsed: number = -1; // seconds since detonate() call, -1 = not yet
  private readonly DETONATE_DURATION = 6.0; // total explosion animation length in seconds

  /** Called by App when the narration cue fires ("And then, it erupted.") */
  detonate(): void {
    if (this.detonated) return;
    this.detonated = true;
    this.detonationElapsed = 0;
  }

  /** Normalized detonation progress 0-1 over DETONATE_DURATION seconds. */
  private get detonationProgress(): number {
    if (this.detonationElapsed < 0) return 0;
    return clamp(this.detonationElapsed / this.DETONATE_DURATION, 0, 1);
  }

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildVoidBackground();
    this.buildExplosionFlash();
    this.buildSingularity();
    this.buildShockwaves();
    this.buildParticles();
    this.buildDebris();

    this.camera.near = 0.01;
    this.camera.far = 250;
    this.camera.position.set(0, 0, 8);
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  private buildVoidBackground(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.voidMat = new THREE.ShaderMaterial({
      transparent: false, depthWrite: false, depthTest: false,
      uniforms: { uTime: { value: 0 }, uProgress: { value: 0 } },
      vertexShader: VOID_VERT, fragmentShader: VOID_FRAG,
    });
    this.voidQuad = new THREE.Mesh(geo, this.voidMat);
    this.voidQuad.frustumCulled = false;
    this.voidQuad.renderOrder = -10;
    this.scene.add(this.voidQuad);
  }

  private buildExplosionFlash(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.explosionMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uDetonation: { value: 0 },
        uTime: { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader: EXPLOSION_VERT, fragmentShader: EXPLOSION_FRAG,
    });
    this.explosionQuad = new THREE.Mesh(geo, this.explosionMat);
    this.explosionQuad.frustumCulled = false;
    this.explosionQuad.renderOrder = 50;
    this.scene.add(this.explosionQuad);
  }

  private buildSingularity(): void {
    const geo = new THREE.SphereGeometry(0.12, 32, 32);
    this.singularityMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uProgress: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal; varying vec3 vWorldPos;
        void main() {
          vNormal = normalMatrix * normal;
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uProgress; uniform float uTime;
        varying vec3 vNormal; varying vec3 vWorldPos;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float fresnel = pow(1.0 - abs(dot(vNormal, viewDir)), 2.0);
          float pulse = 0.7 + 0.3 * sin(uTime * 1.5) * sin(uTime * 0.8 + 0.5);
          float preFlash = 1.0 - smoothstep(0.0, 0.04, uProgress);
          float flash = exp(-pow(uProgress - 0.04, 2.0) / 0.001) * 8.0;
          float postFade = 1.0 - smoothstep(0.06, 0.2, uProgress);
          float brightness = preFlash * pulse * 0.6 + flash + postFade * 0.3;
          float alpha = (fresnel * 0.5 + 0.5) * brightness;
          vec3 preCol = mix(vec3(0.8, 0.6, 1.0), vec3(1.0, 0.9, 0.7), fresnel);
          vec3 col = mix(preCol, vec3(1.0), smoothstep(0.02, 0.05, uProgress));
          gl_FragColor = vec4(col * brightness * 2.0, clamp(alpha, 0.0, 1.0));
        }
      `,
    });
    this.singularityMesh = new THREE.Mesh(geo, this.singularityMat);
    this.scene.add(this.singularityMesh);
  }

  private buildShockwaves(): void {
    // Primary shockwave
    const geo1 = new THREE.SphereGeometry(1, 64, 64);
    this.shockwaveMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: SHOCKWAVE_VERT, fragmentShader: SHOCKWAVE_FRAG,
    });
    this.shockwaveMesh = new THREE.Mesh(geo1, this.shockwaveMat);
    this.scene.add(this.shockwaveMesh);

    // Second shockwave (delayed, different size)
    const geo2 = new THREE.SphereGeometry(1, 48, 48);
    this.shockwave2Mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: SHOCKWAVE_VERT, fragmentShader: SHOCKWAVE_FRAG,
    });
    this.shockwave2Mesh = new THREE.Mesh(geo2, this.shockwave2Mat);
    this.scene.add(this.shockwave2Mesh);
  }

  private buildParticles(): void {
    this.particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const baseTemps = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.01;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.01;

      const dir = randomInSphere(1);
      dir.normalize().multiplyScalar(0.3 + Math.random() * 2.0);
      velocities[i * 3] = dir.x;
      velocities[i * 3 + 1] = dir.y;
      velocities[i * 3 + 2] = dir.z;

      baseTemps[i] = lerp(12000, 40000, Math.random());
      sizes[i] = 0.2 + Math.random() * 1.0;
      phases[i] = Math.random() * Math.PI * 2;
    }

    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleGeo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    this.particleGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.particleGeo.setAttribute('aBaseTemp', new THREE.BufferAttribute(baseTemps, 1));
    this.particleGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 }, uTime: { value: 0 },
        uExpansion: { value: 0 }, uCoolingFactor: { value: 1 }, uScrollVelocity: { value: 0 },
      },
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(this.particleGeo, this.particleMat);
    this.scene.add(this.particles);
  }

  private buildDebris(): void {
    this.debrisGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(DEBRIS_COUNT * 3);
    const velocities = new Float32Array(DEBRIS_COUNT * 3);
    const sizes = new Float32Array(DEBRIS_COUNT);
    const phases = new Float32Array(DEBRIS_COUNT);
    const trailLens = new Float32Array(DEBRIS_COUNT);

    for (let i = 0; i < DEBRIS_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.005;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 0.005;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.005;

      const dir = randomInSphere(1);
      dir.normalize().multiplyScalar(1.0 + Math.random() * 3.0); // faster than main particles
      velocities[i * 3] = dir.x;
      velocities[i * 3 + 1] = dir.y;
      velocities[i * 3 + 2] = dir.z;

      sizes[i] = 0.5 + Math.random() * 2.0;
      phases[i] = Math.random() * Math.PI * 2;
      trailLens[i] = 0.5 + Math.random() * 1.5;
    }

    this.debrisGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.debrisGeo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3));
    this.debrisGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.debrisGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.debrisGeo.setAttribute('aTrailLen', new THREE.BufferAttribute(trailLens, 1));

    this.debrisMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 }, uTime: { value: 0 }, uExpansion: { value: 0 },
      },
      vertexShader: DEBRIS_VERT, fragmentShader: DEBRIS_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.debrisPoints = new THREE.Points(this.debrisGeo, this.debrisMat);
    this.scene.add(this.debrisPoints);
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // Advance detonation timer if triggered
    if (this.detonated && this.detonationElapsed >= 0) {
      this.detonationElapsed += delta;
    }

    // dp = detonation progress (0-1 over DETONATE_DURATION, time-based)
    const dp = this.detonationProgress;
    // Use dp for all explosion visuals; use scroll progress for post-explosion cooling
    const effectiveProgress = this.detonated ? dp : 0;

    const expansion = easeOutExpo(clamp(dp, 0, 1)) * 14.0;
    const cooling = 1.0 - smoothstep(0.0, 0.9, dp) * 0.98;

    // Void background — fades out once detonation starts
    this.voidMat.uniforms.uTime.value = globalTime;
    this.voidMat.uniforms.uProgress.value = effectiveProgress;

    // Cinematic explosion flash — driven by detonation elapsed time
    let detonationRaw = 0;
    if (this.detonated) {
      const t = this.detonationElapsed;
      if (t < 0.3) {
        detonationRaw = smoothstep(0, 0.15, t); // rapid build
      } else if (t < 0.6) {
        detonationRaw = 1.0; // PEAK — blinding white
      } else {
        detonationRaw = Math.max(0, 1.0 - smoothstep(0.6, 3.5, t)); // slow decay
      }
    }
    this.explosionMat.uniforms.uDetonation.value = Math.sqrt(Math.max(detonationRaw, 0));
    this.explosionMat.uniforms.uTime.value = globalTime;
    this.explosionMat.uniforms.uProgress.value = effectiveProgress;

    // Particles — expand based on detonation time
    this.particleMat.uniforms.uProgress.value = dp;
    this.particleMat.uniforms.uTime.value = globalTime;
    this.particleMat.uniforms.uExpansion.value = expansion;
    this.particleMat.uniforms.uCoolingFactor.value = cooling;
    this.particleMat.uniforms.uScrollVelocity.value = this.scrollVelocity;

    // Debris
    this.debrisMat.uniforms.uProgress.value = dp;
    this.debrisMat.uniforms.uTime.value = globalTime;
    this.debrisMat.uniforms.uExpansion.value = expansion;

    // Singularity — pulsing pre-detonation, explodes at detonation
    this.singularityMat.uniforms.uProgress.value = dp;
    this.singularityMat.uniforms.uTime.value = globalTime;
    const singScale = !this.detonated
      ? 1.0
      : this.detonationElapsed < 0.3
        ? 1.0 + this.detonationElapsed * 30.0 // rapid expansion
        : Math.max(0, 1.0 - smoothstep(0.3, 1.5, this.detonationElapsed)) * 3.0;
    this.singularityMesh.scale.setScalar(singScale);

    // Primary shockwave — starts 0.2s after detonation
    if (this.detonated) {
      const shock1T = clamp((this.detonationElapsed - 0.2) / 3.0, 0, 1);
      const shock1R = easeOutExpo(shock1T) * 22.0;
      const shock1O = smoothstep(0.0, 0.15, shock1T) * (1.0 - smoothstep(0.5, 0.9, shock1T));
      this.shockwaveMesh.scale.setScalar(Math.max(shock1R, 0.001));
      this.shockwaveMat.uniforms.uTime.value = globalTime;
      this.shockwaveMat.uniforms.uOpacity.value = shock1O;

      // Second shockwave — starts 0.8s after detonation
      const shock2T = clamp((this.detonationElapsed - 0.8) / 2.5, 0, 1);
      const shock2R = easeOutExpo(shock2T) * 15.0;
      const shock2O = smoothstep(0.0, 0.2, shock2T) * (1.0 - smoothstep(0.4, 0.8, shock2T)) * 0.6;
      this.shockwave2Mesh.scale.setScalar(Math.max(shock2R, 0.001));
      this.shockwave2Mat.uniforms.uTime.value = globalTime;
      this.shockwave2Mat.uniforms.uOpacity.value = shock2O;
    } else {
      this.shockwaveMesh.scale.setScalar(0.001);
      this.shockwaveMat.uniforms.uOpacity.value = 0;
      this.shockwave2Mesh.scale.setScalar(0.001);
      this.shockwave2Mat.uniforms.uOpacity.value = 0;
    }

    // Camera — pre-detonation: close and intimate. Post: pulls back
    const angle = dp * Math.PI * 0.3 + globalTime * 0.015;
    let camDist: number;
    if (!this.detonated) {
      // Gently breathing, waiting
      camDist = 8 + Math.sin(globalTime * 0.3) * 0.3;
    } else {
      const t = this.detonationElapsed;
      if (t < 0.3) {
        camDist = lerp(8, 4, t / 0.3); // zoom IN toward the flash
      } else if (t < 0.8) {
        camDist = lerp(4, 8, (t - 0.3) / 0.5); // snap back
      } else {
        camDist = lerp(8, 20, smoothstep(0.8, 5.0, t)); // slow pull-back
      }
    }
    this.camera.position.x = Math.sin(angle) * camDist * 0.12;
    this.camera.position.z = camDist;
    this.camera.position.y = Math.sin(globalTime * 0.08) * 0.3;
    this.camera.lookAt(0, 0, 0);
  }

  setScrollVelocity(v: number): void {
    this.scrollVelocity = v;
  }

  getPostConfig(_progress: number): PostConfig {
    const dp = this.detonationProgress;
    const t = this.detonationElapsed;
    const preBoom = !this.detonated;
    const duringFlash = this.detonated && t < 1.0;

    const bloomStrength = preBoom
      ? 1.2
      : duringFlash
        ? lerp(5.0, 2.0, t) // MASSIVE during flash
        : lerp(2.0, 0.8, smoothstep(0.15, 0.7, dp));

    const aberration = preBoom
      ? 0.003
      : duringFlash
        ? lerp(0.025, 0.008, t)
        : lerp(0.008, 0.002, smoothstep(0.15, 0.5, dp));

    return {
      bloomStrength,
      bloomRadius: preBoom ? 0.5 : duringFlash ? 1.0 : lerp(0.8, 0.35, dp),
      bloomThreshold: preBoom ? 0.2 : duringFlash ? 0.02 : 0.08,
      chromaticAberration: aberration,
      filmGrain: lerp(0.07, 0.03, dp),
      godRays: false,
      godRayIntensity: 0,
      vignetteStrength: preBoom ? 0.7 : lerp(0.85, 0.45, dp),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5] as [number, number],
      lensingRadius: 0.3,
    };
  }

  getBackgroundColor(progress: number): THREE.Color {
    if (progress < 0.15) return new THREE.Color(0x000000);
    return getEraColor(0, progress);
  }

  override dispose(): void {
    this.particleGeo?.dispose();
    this.particleMat?.dispose();
    this.debrisGeo?.dispose();
    this.debrisMat?.dispose();
    this.singularityMat?.dispose();
    this.singularityMesh?.geometry?.dispose();
    this.shockwaveMat?.dispose();
    this.shockwaveMesh?.geometry?.dispose();
    this.shockwave2Mat?.dispose();
    this.shockwave2Mesh?.geometry?.dispose();
    this.voidMat?.dispose();
    this.voidQuad?.geometry?.dispose();
    this.explosionMat?.dispose();
    this.explosionQuad?.geometry?.dispose();
    super.dispose();
  }
}
