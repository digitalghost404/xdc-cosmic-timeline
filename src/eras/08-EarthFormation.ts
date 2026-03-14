import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutExpo, easeOutQuad } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Shared GLSL: Simplex 3D noise + Voronoi
// ---------------------------------------------------------------------------

const GLSL_NOISE_LIB = /* glsl */ `
  // ---- Simplex 3D noise (Ashima) ----
  vec3 _mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _permute(vec4 x)  { return _mod289v4(((x * 34.0) + 1.0) * x); }
  vec4 _taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

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

    i = _mod289v3(i);
    vec4 p = _permute(_permute(_permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

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

    vec4 norm = _taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  // FBM for surface detail
  float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      val  += snoise(p * freq) * amp;
      freq *= 2.11;
      amp  *= 0.49;
    }
    return val;
  }

  // ---- Voronoi (2D) ----
  vec2 _hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }

  // Returns distance to nearest Voronoi cell edge
  float voronoi(vec2 x) {
    vec2 ip = floor(x);
    vec2 fp = fract(x);
    float d = 1.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 b = vec2(float(i), float(j));
        vec2 o = _hash2(ip + b);
        vec2 r = b + o - fp;
        d = min(d, dot(r, r));
      }
    }
    return sqrt(d);
  }

  // Animated voronoi — cells drift over time
  float voronoiAnimated(vec2 x, float t) {
    vec2 ip = floor(x);
    vec2 fp = fract(x);
    float d = 1.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 b = vec2(float(i), float(j));
        vec2 seed = ip + b;
        // Time-animated cell centers — drift slowly
        vec2 o = _hash2(seed) + 0.25 * sin(_hash2(seed * 7.3 + 1.7) * 6.283 + t * 0.5);
        vec2 r = b + o - fp;
        d = min(d, dot(r, r));
      }
    }
    return sqrt(d);
  }
`;

// ---------------------------------------------------------------------------
// Molten Earth shaders
// ---------------------------------------------------------------------------

const EARTH_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv       = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const EARTH_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;
  uniform float uImpactFlash;     // 0-1 flash intensity for current impact
  uniform vec2  uImpactUv;        // UV position of latest impact
  uniform float uImpactAge;       // age of impact in seconds

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  ${GLSL_NOISE_LIB}

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float NdotV = clamp(dot(vNormal, viewDir), 0.0, 1.0);

    // --- Tectonic plate Voronoi ---
    // UV distortion: slow turbulent flow, mimics magma convection
    vec2 distort = vec2(
      snoise(vec3(vUv * 3.0, uTime * 0.08)),
      snoise(vec3(vUv * 3.0 + vec2(4.3, 1.7), uTime * 0.06))
    ) * 0.18;

    vec2 animUv = vUv * 6.0 + distort + uTime * 0.015;
    float dist = voronoiAnimated(animUv, uTime);

    // Crack width narrows as planet cools (progress 0→1)
    float crackWidth = mix(0.32, 0.07, uProgress);
    float crack = smoothstep(crackWidth, crackWidth * 0.4, dist);

    // Surface noise: gives crust some texture and imperfection
    float crustNoise = fbm(vec3(vUv * 8.0, uTime * 0.02)) * 0.5 + 0.5;
    float crustDetail = 0.75 + 0.25 * crustNoise;

    // --- Colors ---
    // Dark cooling basaltic crust
    vec3 crustBase = vec3(0.15, 0.12, 0.08);
    vec3 crust = crustBase * crustDetail;

    // Hot magma: animated flicker in cracks
    float magmaFlicker = 1.5 + 0.35 * sin(uTime * 2.0 + vUv.x * 10.0 + vUv.y * 7.3);
    vec3 magma = vec3(1.0, 0.28, 0.02) * magmaFlicker;
    // Deeper/cooler magma layer: dark red
    vec3 deepMagma = vec3(0.55, 0.05, 0.0);
    // Blend by crack depth
    magma = mix(deepMagma, magma, smoothstep(0.0, crackWidth * 0.8, dist) * crack + crack * 0.5);

    // Subsurface glow at plate edges — rims of cracks
    float subsurface = smoothstep(crackWidth * 2.0, crackWidth * 0.2, dist) * 0.45
                     * (1.0 - crack);  // only the crust near edges
    vec3 subGlow = vec3(0.9, 0.35, 0.0) * subsurface;

    // Blend crust and magma based on crack
    vec3 color = mix(crust, magma, crack) + subGlow;

    // As planet cools (progress → 1), surface darkens and crust dominates
    float coolFactor = 1.0 - uProgress * 0.4;
    color *= coolFactor;

    // Limb darkening
    float limb = mix(0.55, 1.0, NdotV * NdotV);
    color *= limb;

    // --- Impact ring flash ---
    float impactDist = distance(vUv, uImpactUv);
    // Expanding ring: ring radius grows with impact age
    float ringR  = uImpactAge * 0.35;
    float ringW  = 0.04;
    float ring   = smoothstep(ringW, 0.0, abs(impactDist - ringR)) * uImpactFlash;
    ring *= smoothstep(0.5, 0.1, ringR); // fade as ring expands
    color += vec3(1.0, 0.6, 0.1) * ring * 3.0;

    // Impact brightens surrounding magma
    float impactGlow = smoothstep(0.3, 0.0, impactDist) * uImpactFlash * 0.5;
    color += vec3(1.0, 0.4, 0.05) * impactGlow;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Atmosphere shaders
// ---------------------------------------------------------------------------

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float NdotV = clamp(dot(vNormal, viewDir), 0.0, 1.0);

    // Fresnel atmospheric limb glow
    float fresnel = pow(1.0 - NdotV, 3.0);

    // Color: opaque brown-orange haze early → translucent blue as planet cools
    vec3 earlyAtmo = vec3(0.6, 0.28, 0.08);
    vec3 lateAtmo  = vec3(0.22, 0.48, 0.82);
    vec3 atmoColor = mix(earlyAtmo, lateAtmo, uProgress);

    // Thickness: dense early, thinner and more transparent as atmosphere evolves
    float atmoAlpha = fresnel * mix(0.85, 0.38, uProgress);

    // Breathing/variation
    float pulse = 1.0 + 0.05 * sin(uTime * 0.6) + 0.03 * sin(uTime * 1.7);
    atmoAlpha *= pulse;

    gl_FragColor = vec4(atmoColor, clamp(atmoAlpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Impact flash shaders — expanding ring sprite
// ---------------------------------------------------------------------------

const IMPACT_RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const IMPACT_RING_FRAG = /* glsl */ `
  precision highp float;

  uniform float uAge;       // seconds since impact
  uniform float uIntensity; // 0-1

  varying vec2 vUv;

  void main() {
    vec2 centered = vUv - 0.5;
    float d = length(centered);

    float ringR = uAge * 0.4;
    float ringW = 0.03 + uAge * 0.01;
    float ring  = smoothstep(ringW, 0.0, abs(d - ringR));
    float fade  = smoothstep(0.5, 0.0, ringR) * uIntensity;

    // Hot core flash at impact center
    float core = exp(-d * 18.0) * max(1.0 - uAge * 3.0, 0.0);

    vec3 color = vec3(1.0, 0.7, 0.2) * (ring + core * 4.0);
    float alpha = (ring * 0.8 + core * 0.9) * fade;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Moon shaders
// ---------------------------------------------------------------------------

const MOON_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vNormal   = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv       = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MOON_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  ${GLSL_NOISE_LIB}

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float NdotV = clamp(dot(vNormal, viewDir), 0.0, 1.0);

    // Crater noise — multiple scales of voronoi overlay
    float craters  = voronoi(vUv * 8.0);
    float craters2 = voronoi(vUv * 18.0 + vec2(4.7, 2.1));
    float craters3 = voronoi(vUv * 45.0 + vec2(1.3, 8.6));

    // Crater pits: dark at cell center, bright rim
    float pit  = smoothstep(0.18, 0.0, craters)  * 0.6;
    float pit2 = smoothstep(0.10, 0.0, craters2) * 0.3;
    float pit3 = smoothstep(0.06, 0.0, craters3) * 0.15;

    // Surface albedo — grey lunar regolith
    float surface = fbm(vec3(vUv * 5.0, 1.3)) * 0.5 + 0.5;
    vec3 baseColor = vec3(0.42, 0.40, 0.38) * (0.7 + 0.3 * surface);

    // Apply crater darkening
    vec3 color = baseColor * (1.0 - pit - pit2 - pit3);
    color = max(color, vec3(0.05));

    // Diffuse lighting (approximation — light from star direction)
    vec3 lightDir = normalize(vec3(1.0, 0.3, 0.5));
    float diff = clamp(dot(vNormal, lightDir), 0.1, 1.0);
    color *= diff;

    // Limb darkening
    color *= mix(0.5, 1.0, NdotV);

    // Fade in as moon forms post-Theia
    float moonVisibility = smoothstep(0.48, 0.62, uProgress);
    gl_FragColor = vec4(color, moonVisibility);
  }
`;

// ---------------------------------------------------------------------------
// Types and constants
// ---------------------------------------------------------------------------

interface ImpactEvent {
  progress: number;    // era progress at which it triggers
  uvPos: THREE.Vector2;
}

interface ActiveImpact {
  age: number;
  uvPos: THREE.Vector2;
  light: THREE.PointLight;
  ringMesh: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  triggered: boolean;
}

const IMPACT_EVENTS: ImpactEvent[] = [
  { progress: 0.20, uvPos: new THREE.Vector2(0.32, 0.61) },
  { progress: 0.40, uvPos: new THREE.Vector2(0.68, 0.44) },
  { progress: 0.60, uvPos: new THREE.Vector2(0.21, 0.29) },
];

const IMPACT_DURATION = 2.8; // seconds

// ---------------------------------------------------------------------------
// EarthFormation Era
// ---------------------------------------------------------------------------

export class EarthFormation extends BaseEra {
  // Planet
  private earthMesh!: THREE.Mesh;
  private earthMat!: THREE.ShaderMaterial;

  // Atmosphere
  private atmoMesh!: THREE.Mesh;
  private atmoMat!: THREE.ShaderMaterial;

  // Moon
  private moonMesh!: THREE.Mesh;
  private moonMat!: THREE.ShaderMaterial;
  private moonAngle: number = 0.8;

  // Impacts
  private impacts: ActiveImpact[] = [];
  private impactTriggered: boolean[] = [false, false, false];

  // Lighting
  private sunLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;

  // Camera orbit state
  private cameraAngle: number = 0;
  private cameraZoom: number = 8;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildEarth();
    this.buildAtmosphere();
    this.buildMoon();
    this.buildLighting();
    this.prepareImpacts();

    this.camera.near = 0.01;
    this.camera.far  = 200;
    this.camera.position.set(0, 3, 9);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  // ----- Molten Earth -----

  private buildEarth(): void {
    const geo = new THREE.SphereGeometry(3, 128, 128);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:        { value: 0 },
        uProgress:    { value: 0 },
        uImpactFlash: { value: 0 },
        uImpactUv:    { value: new THREE.Vector2(0.5, 0.5) },
        uImpactAge:   { value: 0 },
      },
      vertexShader:   EARTH_VERT,
      fragmentShader: EARTH_FRAG,
      transparent:    false,
      depthWrite:     true,
    });
    this.earthMesh = new THREE.Mesh(geo, this.earthMat);
    this.scene.add(this.earthMesh);
  }

  // ----- Atmosphere sphere -----

  private buildAtmosphere(): void {
    const geo = new THREE.SphereGeometry(3.35, 64, 64);
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.FrontSide,
      blending:       THREE.AdditiveBlending,
    });
    this.atmoMesh = new THREE.Mesh(geo, this.atmoMat);
    this.scene.add(this.atmoMesh);
  }

  // ----- Moon -----

  private buildMoon(): void {
    const geo = new THREE.SphereGeometry(0.85, 48, 48);
    this.moonMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   MOON_VERT,
      fragmentShader: MOON_FRAG,
      transparent:    true,
      depthWrite:     true,
    });
    this.moonMesh = new THREE.Mesh(geo, this.moonMat);
    this.scene.add(this.moonMesh);
  }

  // ----- Lighting -----

  private buildLighting(): void {
    // Sun — directional key light from upper right
    this.sunLight = new THREE.DirectionalLight(new THREE.Color(1.0, 0.92, 0.75), 2.5);
    this.sunLight.position.set(8, 5, 3);
    this.scene.add(this.sunLight);

    // Fill ambient — warm deep red from all the magma
    this.ambientLight = new THREE.AmbientLight(new THREE.Color(0.18, 0.06, 0.02), 1.2);
    this.scene.add(this.ambientLight);
  }

  // ----- Pre-build impact ring meshes -----

  private prepareImpacts(): void {
    IMPACT_EVENTS.forEach((_event) => {
      const geo = new THREE.PlaneGeometry(8, 8);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uAge:       { value: 0 },
          uIntensity: { value: 0 },
        },
        vertexShader:   IMPACT_RING_VERT,
        fragmentShader: IMPACT_RING_FRAG,
        transparent:    true,
        depthWrite:     false,
        blending:       THREE.AdditiveBlending,
        side:           THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);

      const light = new THREE.PointLight(new THREE.Color(1.0, 0.55, 0.1), 0, 15);
      this.scene.add(light);

      this.impacts.push({
        age:       0,
        uvPos:     _event.uvPos.clone(),
        light,
        ringMesh:  mesh,
        ringMat:   mat,
        triggered: false,
      });
    });
  }

  // ----- Trigger an impact -----

  private triggerImpact(idx: number, globalTime: number): void {
    const impact = this.impacts[idx];
    impact.age       = 0;
    impact.triggered = true;
    impact.ringMesh.visible = true;

    // Position ring mesh on planet surface at approximate UV location
    // Convert UV to spherical position on the planet
    const phi   = impact.uvPos.x * Math.PI * 2;
    const theta = impact.uvPos.y * Math.PI;
    const r     = 3.05;
    impact.ringMesh.position.set(
      r * Math.sin(theta) * Math.cos(phi),
      r * Math.cos(theta),
      r * Math.sin(theta) * Math.sin(phi),
    );
    // Orient ring to face outward from sphere center
    impact.ringMesh.lookAt(0, 0, 0);
    impact.ringMesh.rotateX(Math.PI); // flip to face outward

    // Update earth shader impact position
    this.earthMat.uniforms.uImpactUv.value.copy(impact.uvPos);
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // --- Check impact triggers ---
    IMPACT_EVENTS.forEach((event, idx) => {
      if (!this.impactTriggered[idx] && progress >= event.progress) {
        this.impactTriggered[idx] = true;
        this.triggerImpact(idx, globalTime);
      }
    });

    // --- Tick active impacts ---
    let latestFlash  = 0;
    let latestUv     = new THREE.Vector2(0.5, 0.5);
    let latestAge    = 0;

    this.impacts.forEach((impact) => {
      if (!impact.triggered) return;

      impact.age += delta;
      const t = impact.age / IMPACT_DURATION;

      if (t > 1.0) {
        // Impact finished
        impact.ringMesh.visible = false;
        impact.light.intensity  = 0;
        return;
      }

      // Flash intensity: sharp spike then decay
      const flash = Math.max(0, 1.0 - t * 1.4) * easeOutExpo(1.0 - t * 0.8);

      // Update ring shader
      impact.ringMat.uniforms.uAge.value       = impact.age;
      impact.ringMat.uniforms.uIntensity.value = flash;

      // Point light flare
      impact.light.position.copy(impact.ringMesh.position);
      impact.light.intensity = flash * 12.0;

      // Track the most intense impact for earth shader
      if (flash > latestFlash) {
        latestFlash = flash;
        latestUv    = impact.uvPos;
        latestAge   = impact.age;
      }
    });

    // --- Earth shader uniforms ---
    this.earthMat.uniforms.uTime.value        = globalTime;
    this.earthMat.uniforms.uProgress.value    = progress;
    this.earthMat.uniforms.uImpactFlash.value = latestFlash;
    this.earthMat.uniforms.uImpactAge.value   = latestAge;
    if (latestFlash > 0) {
      this.earthMat.uniforms.uImpactUv.value.copy(latestUv);
    }

    // --- Atmosphere ---
    this.atmoMat.uniforms.uTime.value     = globalTime;
    this.atmoMat.uniforms.uProgress.value = progress;

    // --- Earth slow rotation ---
    this.earthMesh.rotation.y += delta * 0.04;
    this.atmoMesh.rotation.y  += delta * 0.035; // slight differential

    // --- Moon: appears after Theia impact at progress 0.5, grows in ---
    this.moonMat.uniforms.uTime.value     = globalTime;
    this.moonMat.uniforms.uProgress.value = progress;

    const moonVisibility = smoothstep(0.48, 0.65, progress);
    if (moonVisibility > 0.01) {
      this.moonAngle += delta * 0.08;
      const moonOrbitR = lerp(5.5, 7.5, smoothstep(0.5, 1.0, progress));
      const moonScale  = lerp(0.3, 1.0, easeOutQuad(smoothstep(0.5, 0.75, progress)));
      this.moonMesh.position.set(
        Math.cos(this.moonAngle) * moonOrbitR,
        Math.sin(this.moonAngle * 0.15) * 0.8,
        Math.sin(this.moonAngle) * moonOrbitR,
      );
      this.moonMesh.scale.setScalar(moonScale);
      this.moonMesh.rotation.y += delta * 0.02;
    }

    // --- Ambient light cools as planet does ---
    const ambientColor = new THREE.Color();
    ambientColor.setRGB(
      lerp(0.18, 0.04, progress),
      lerp(0.06, 0.02, progress),
      lerp(0.02, 0.04, progress),
    );
    this.ambientLight.color.copy(ambientColor);
    this.ambientLight.intensity = lerp(1.4, 0.7, progress);

    // --- Camera: slow orbit, zoom for impacts, pull back for moon ---
    this.updateCamera(progress, delta, globalTime, latestFlash);
  }

  private updateCamera(
    progress: number,
    delta: number,
    globalTime: number,
    impactFlash: number,
  ): void {
    // Base orbit — slow drift around planet
    this.cameraAngle += delta * (0.06 + impactFlash * 0.0);

    // Zoom: normal = 9 units, impact zoom-in = 6, moon reveal = 11
    const moonPull     = smoothstep(0.5, 0.8, progress) * 3.5;
    const impactPull   = impactFlash * 2.0;
    const targetZoom   = 9.0 - impactPull + moonPull;
    this.cameraZoom    = lerp(this.cameraZoom, targetZoom, delta * 1.5);

    const elevation = lerp(3.5, 5.5, smoothstep(0.5, 1.0, progress));

    this.camera.position.x = Math.sin(this.cameraAngle) * this.cameraZoom;
    this.camera.position.y = elevation + Math.sin(globalTime * 0.12) * 0.4;
    this.camera.position.z = Math.cos(this.cameraAngle) * this.cameraZoom;

    // During close impact zoom: look slightly toward impact area
    if (impactFlash > 0.3) {
      const activeImpact = this.impacts.find(
        (imp) => imp.triggered && imp.age < IMPACT_DURATION && imp.age > 0,
      );
      if (activeImpact) {
        const target = activeImpact.ringMesh.position.clone().multiplyScalar(0.4);
        this.camera.lookAt(target);
      } else {
        this.camera.lookAt(0, 0, 0);
      }
    } else {
      this.camera.lookAt(0, 0, 0);
    }

    this.camera.updateProjectionMatrix();
  }

  // ----- Post config -----

  getPostConfig(progress: number): PostConfig {
    // Bloom on magma cracks; atmospheric glow; warm→cool color grade
    const hasActiveImpact = this.impacts.some(
      (imp) => imp.triggered && imp.age < IMPACT_DURATION,
    );

    return {
      bloomStrength:       lerp(2.2, 1.2, smoothstep(0.0, 0.8, progress)) + (hasActiveImpact ? 0.8 : 0),
      bloomRadius:         lerp(0.6, 0.35, progress),
      bloomThreshold:      lerp(0.1, 0.25, progress),
      chromaticAberration: lerp(0.005, 0.002, progress) + (hasActiveImpact ? 0.004 : 0),
      filmGrain:           lerp(0.04, 0.025, progress),
      godRays:             false,
      godRayIntensity:     0.0,
      vignetteStrength:    lerp(0.55, 0.45, progress),
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  // ----- Background color -----

  getBackgroundColor(_progress: number): THREE.Color {
    // Very dark, near black: #0A0A0A
    return new THREE.Color(0x0a0a0a);
  }

  // ----- Dispose -----

  override dispose(): void {
    this.earthMat?.dispose();
    (this.earthMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.atmoMat?.dispose();
    (this.atmoMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.moonMat?.dispose();
    (this.moonMesh?.geometry as THREE.BufferGeometry)?.dispose();

    this.impacts.forEach((imp) => {
      imp.ringMat?.dispose();
      (imp.ringMesh?.geometry as THREE.BufferGeometry)?.dispose();
    });
    this.impacts = [];
    this.impactTriggered = [false, false, false];

    super.dispose();
  }
}
