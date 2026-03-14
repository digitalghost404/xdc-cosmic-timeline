import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, easeInOutCubic, easeOutExpo } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Shared GLSL noise library — Ashima simplex 3D noise
// ---------------------------------------------------------------------------

const GLSL_SIMPLEX_3D = /* glsl */ `
  vec3 _mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _mod289_4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 _permute4(vec4 x) { return _mod289_4(((x * 34.0) + 1.0) * x); }
  vec4 _taylorInvSqrt4(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

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

    i = _mod289_3(i);
    vec4 p = _permute4(_permute4(_permute4(
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

    vec4 norm = _taylorInvSqrt4(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p) {
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
      val  += snoise(p * freq) * amp;
      freq *= 2.07;
      amp  *= 0.48;
    }
    return val;
  }
`;

// ---------------------------------------------------------------------------
// Protostar shaders
// ---------------------------------------------------------------------------

const PROTOSTAR_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PROTOSTAR_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  ${GLSL_SIMPLEX_3D}

  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float NdotV = clamp(dot(vNormal, viewDir), 0.0, 1.0);

    // Fresnel corona — stronger at grazing angles
    float fresnel = pow(1.0 - NdotV, 2.0);
    float corona = fresnel * 3.5;

    // Animated plasma surface
    float plasma = snoise(vNormal * 2.5 + uTime * 0.4) * 0.5 + 0.5;
    float plasma2 = snoise(vNormal * 5.0 - uTime * 0.6) * 0.5 + 0.5;
    float surface = mix(plasma, plasma2, 0.4);

    // Solar flares: noise-driven brightness spikes at edges
    float flareNoise = snoise(vNormal * 3.0 + uTime * 0.5);
    float flare = flareNoise * fresnel * 2.5;

    // Breathing pulse from globalTime
    float pulse = 1.0 + 0.08 * sin(uTime * 1.3) + 0.04 * sin(uTime * 3.7);

    // Core color: intense yellow-white
    vec3 coreColor   = vec3(1.0, 0.98, 0.85);
    // Corona color: deeper amber-orange
    vec3 coronaColor = vec3(1.0, 0.7, 0.2);

    vec3 color = mix(coreColor, coronaColor, fresnel * 0.5);
    // Surface variation — subtle mottling
    color *= 0.85 + 0.15 * surface;
    // Add corona and flare luminance
    color += coronaColor * corona;
    color += vec3(1.0, 0.5, 0.1) * max(flare, 0.0);
    color *= pulse;

    // Limb darkening — edges slightly darker to read as sphere
    float limb = mix(0.7, 1.0, NdotV * NdotV);
    color *= limb;

    // Alpha: solid core, fade at corona
    float alpha = mix(1.0, 0.6, fresnel * 0.5);

    gl_FragColor = vec4(color, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Accretion disk shaders
// ---------------------------------------------------------------------------

const DISK_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DISK_FRAG = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform float uProgress;
  uniform float uRotation;

  varying vec3 vWorldPos;
  varying vec2 vUv;

  ${GLSL_SIMPLEX_3D}

  void main() {
    float r = length(vWorldPos.xz);
    float angle = atan(vWorldPos.z, vWorldPos.x) + uRotation;

    // Spiral density waves — organic structure
    float spiral  = snoise(vec3(angle * 3.0 + r * 0.5, r * 2.0, uTime * 0.1));
    float spiral2 = snoise(vec3(angle * 1.5 - r * 0.3, r * 1.2, uTime * 0.07 + 5.0));
    float turbulence = fbm(vec3(vWorldPos.xz * 0.3, uTime * 0.05));

    // Radial density envelope: fade in from inner edge, fade out at outer edge
    float density = smoothstep(1.5, 2.5, r) * (1.0 - smoothstep(11.0, 13.5, r));
    density *= 0.45 + 0.35 * spiral + 0.2 * spiral2;
    density  = max(density, 0.0);

    // Clumps and knots from fbm
    density = mix(density, density * (0.7 + 0.6 * turbulence), 0.35);

    // Planetary gaps that deepen as progress advances
    float gap1 = 1.0 - smoothstep(0.0, 0.4, abs(r - 4.8) / 0.4) * uProgress;
    float gap2 = 1.0 - smoothstep(0.0, 0.4, abs(r - 8.2) / 0.6) * uProgress;
    float gap3 = 1.0 - smoothstep(0.0, 0.3, abs(r - 6.5) / 0.3) * uProgress * 0.6;
    density *= gap1 * gap2 * gap3;

    // Temperature gradient: hot amber near star, cooler brown at outer edge
    vec3 hotColor  = vec3(1.0, 0.85, 0.3);
    vec3 midColor  = vec3(0.9, 0.55, 0.15);
    vec3 coolColor = vec3(0.38, 0.22, 0.08);
    float tGrad = smoothstep(2.0, 11.0, r);
    vec3 color = mix(hotColor, midColor, smoothstep(0.0, 0.5, tGrad));
    color = mix(color, coolColor, smoothstep(0.4, 1.0, tGrad));

    // Emit brighter in dense clumps — HDR-ish
    float luminance = density * 1.8;
    color *= luminance;

    // Viewing angle semi-transparency — thinner appearance when seen edge-on
    float alpha = density * 0.9;

    if (alpha < 0.002) discard;

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

// ---------------------------------------------------------------------------
// Dust particle shaders
// ---------------------------------------------------------------------------

const DUST_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aRadius;
  attribute float aSpeed;
  attribute float aSize;
  attribute float aHeight;

  uniform float uTime;
  uniform float uProgress;

  varying float vAlpha;
  varying float vTemp;

  void main() {
    float angle = aPhase + uTime * aSpeed;

    // Keplerian-ish: faster at inner radii (1/sqrt(r) dependency)
    float keplerBoost = 1.0 / sqrt(max(aRadius, 0.5));
    angle += uTime * keplerBoost * 0.15;

    // Slowly spiral inward as disk accretes — visible motion toward star
    float r = aRadius - uTime * 0.003 * keplerBoost * (1.0 - uProgress * 0.5);
    r = max(r, 1.4); // clamp above inner edge

    vec3 pos = vec3(cos(angle) * r, aHeight, sin(angle) * r);

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float sz = aSize * (220.0 / -mvPos.z);
    gl_PointSize = clamp(sz, 0.3, 5.0);

    // Fade based on density region
    float inDisk = smoothstep(1.5, 2.2, r) * (1.0 - smoothstep(11.0, 13.0, r));
    float flicker = 0.75 + 0.25 * sin(uTime * 2.3 + aPhase * 17.0);
    vAlpha = inDisk * flicker * 0.65;

    // Heat proxy: inner dust is hotter
    vTemp = 1.0 - smoothstep(2.0, 10.0, r);
  }
`;

const DUST_FRAG = /* glsl */ `
  varying float vAlpha;
  varying float vTemp;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float soft = 1.0 - smoothstep(0.15, 0.5, d);

    // Color: hot inner = amber, cool outer = warm brown
    vec3 hotCol  = vec3(1.0, 0.82, 0.35);
    vec3 coolCol = vec3(0.45, 0.28, 0.12);
    vec3 color = mix(coolCol, hotCol, vTemp);

    gl_FragColor = vec4(color, soft * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DUST_COUNT = 20_000;

interface Planetesimal {
  mesh: THREE.Mesh;
  radius: number;
  angle: number;
  speed: number;
  baseScale: number;
}

// ---------------------------------------------------------------------------
// SolarSystemBirth Era
// ---------------------------------------------------------------------------

export class SolarSystemBirth extends BaseEra {
  // Protostar
  private protostarMesh!: THREE.Mesh;
  private protostarMat!: THREE.ShaderMaterial;
  private protostarGlow!: THREE.Mesh; // billboard sprite for extra glow

  // Disk
  private diskMesh!: THREE.Mesh;
  private diskMat!: THREE.ShaderMaterial;
  private diskRotation: number = 0;

  // Dust
  private dustGeo!: THREE.BufferGeometry;
  private dustMat!: THREE.ShaderMaterial;
  private dust!: THREE.Points;

  // Planetesimals
  private planetesimals: Planetesimal[] = [];

  // Lighting
  private starLight!: THREE.PointLight;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.buildProtostar();
    this.buildDisk();
    this.buildDust();
    this.buildPlanetesimals();
    this.buildLighting();

    this.camera.near = 0.01;
    this.camera.far = 500;
    this.camera.position.set(0, 22, 2);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.isInitialized = true;
  }

  // ----- Protostar -----

  private buildProtostar(): void {
    const geo = new THREE.SphereGeometry(1.4, 64, 64);
    this.protostarMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   PROTOSTAR_VERT,
      fragmentShader: PROTOSTAR_FRAG,
      transparent:    true,
      depthWrite:     true,
      blending:       THREE.AdditiveBlending,
    });
    this.protostarMesh = new THREE.Mesh(geo, this.protostarMat);
    this.scene.add(this.protostarMesh);

    // Wide low-opacity glow sprite — lens flare style
    const glowGeo = new THREE.SphereGeometry(3.5, 32, 32);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vNormal;
        void main() {
          vec3 viewDir = normalize(cameraPosition - vec3(0.0));
          float fresnel = pow(1.0 - clamp(dot(vNormal, viewDir), 0.0, 1.0), 3.0);
          float pulse = 1.0 + 0.1 * sin(uTime * 0.9);
          vec3 color = vec3(1.0, 0.85, 0.3) * fresnel * 2.0 * pulse;
          gl_FragColor = vec4(color, fresnel * 0.35);
        }
      `,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      side:        THREE.BackSide,
    });
    this.protostarGlow = new THREE.Mesh(glowGeo, glowMat);
    this.scene.add(this.protostarGlow);
  }

  // ----- Accretion disk -----

  private buildDisk(): void {
    // Custom annular geometry — single quad ring with many radial segments
    // so the shader can vary density continuously
    const innerR   = 1.6;
    const outerR   = 13.5;
    const rSegs    = 120;
    const thetaSegs = 256;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let ri = 0; ri <= rSegs; ri++) {
      const t = ri / rSegs;
      const r = lerp(innerR, outerR, t);
      for (let ti = 0; ti <= thetaSegs; ti++) {
        const angle = (ti / thetaSegs) * Math.PI * 2;
        positions.push(Math.cos(angle) * r, 0, Math.sin(angle) * r);
        uvs.push(t, ti / thetaSegs);
      }
    }

    for (let ri = 0; ri < rSegs; ri++) {
      for (let ti = 0; ti < thetaSegs; ti++) {
        const a = ri * (thetaSegs + 1) + ti;
        const b = a + 1;
        const c = a + (thetaSegs + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    this.diskMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
        uRotation: { value: 0 },
      },
      vertexShader:   DISK_VERT,
      fragmentShader: DISK_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      blending:       THREE.AdditiveBlending,
    });

    this.diskMesh = new THREE.Mesh(geo, this.diskMat);
    this.scene.add(this.diskMesh);
  }

  // ----- Dust particles -----

  private buildDust(): void {
    this.dustGeo = new THREE.BufferGeometry();

    const phases   = new Float32Array(DUST_COUNT);
    const radii    = new Float32Array(DUST_COUNT);
    const speeds   = new Float32Array(DUST_COUNT);
    const sizes    = new Float32Array(DUST_COUNT);
    const heights  = new Float32Array(DUST_COUNT);
    // Positions — set to origin; shader animates using attributes
    const positions = new Float32Array(DUST_COUNT * 3);

    for (let i = 0; i < DUST_COUNT; i++) {
      phases[i]  = Math.random() * Math.PI * 2;
      // Distribute in disk radii with bias toward middle
      const u    = Math.random();
      radii[i]   = lerp(1.8, 13.0, Math.pow(u, 0.6));
      speeds[i]  = 0.18 + Math.random() * 0.22;
      sizes[i]   = 0.15 + Math.random() * 0.55;
      // Disk thickness: thicker at outer radii, narrow near star
      const diskThick = lerp(0.04, 0.35, (radii[i] - 1.8) / 11.2);
      heights[i] = (Math.random() * 2 - 1) * diskThick;

      positions[i * 3]     = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
    }

    this.dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dustGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    this.dustGeo.setAttribute('aRadius',  new THREE.BufferAttribute(radii,     1));
    this.dustGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds,    1));
    this.dustGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
    this.dustGeo.setAttribute('aHeight',  new THREE.BufferAttribute(heights,   1));

    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.dust = new THREE.Points(this.dustGeo, this.dustMat);
    this.scene.add(this.dust);
  }

  // ----- Planetesimals -----

  private buildPlanetesimals(): void {
    const configs = [
      { radius: 3.2,  speed: 0.55, scale: 0.09, color: 0xcc7722 },
      { radius: 4.85, speed: 0.38, scale: 0.12, color: 0xdd9933 },
      { radius: 6.1,  speed: 0.28, scale: 0.14, color: 0xaa6611 },
      { radius: 7.4,  speed: 0.21, scale: 0.11, color: 0x997744 },
      { radius: 8.3,  speed: 0.17, scale: 0.18, color: 0xcc8833 },
      { radius: 9.6,  speed: 0.13, scale: 0.13, color: 0x886622 },
      { radius: 10.8, speed: 0.10, scale: 0.16, color: 0x775533 },
    ];

    configs.forEach((cfg, idx) => {
      const geo = new THREE.SphereGeometry(1, 20, 20);
      const mat = new THREE.MeshStandardMaterial({
        color:          new THREE.Color(cfg.color),
        emissive:       new THREE.Color(cfg.color),
        emissiveIntensity: idx < 3 ? 0.6 : 0.2, // inner ones glow more
        roughness:      0.75,
        metalness:      0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.scale.setScalar(cfg.scale);
      this.scene.add(mesh);

      this.planetesimals.push({
        mesh,
        radius: cfg.radius,
        angle: Math.random() * Math.PI * 2,
        speed: cfg.speed,
        baseScale: cfg.scale,
      });
    });
  }

  // ----- Lighting -----

  private buildLighting(): void {
    this.starLight = new THREE.PointLight(new THREE.Color(1.0, 0.9, 0.6), 8, 60);
    this.starLight.position.set(0, 0, 0);
    this.scene.add(this.starLight);

    const ambient = new THREE.AmbientLight(new THREE.Color(0.1, 0.08, 0.04), 0.5);
    this.scene.add(ambient);
  }

  // ----- Update -----

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // --- Disk rotation accumulates over time ---
    this.diskRotation += delta * 0.06;

    // --- Shader uniforms ---
    this.protostarMat.uniforms.uTime.value     = globalTime;
    this.protostarMat.uniforms.uProgress.value = progress;

    (this.protostarGlow.material as THREE.ShaderMaterial).uniforms.uTime.value = globalTime;

    this.diskMat.uniforms.uTime.value      = globalTime;
    this.diskMat.uniforms.uProgress.value  = progress;
    this.diskMat.uniforms.uRotation.value  = this.diskRotation;

    this.dustMat.uniforms.uTime.value      = globalTime;
    this.dustMat.uniforms.uProgress.value  = progress;

    // --- Protostar pulse ---
    const starPulse = 1.0 + 0.04 * Math.sin(globalTime * 1.1) + 0.02 * Math.sin(globalTime * 2.9);
    this.protostarMesh.scale.setScalar(starPulse);
    this.protostarGlow.scale.setScalar(starPulse);

    // --- Star light intensity breathes ---
    this.starLight.intensity = lerp(6.0, 10.0, 0.5 + 0.5 * Math.sin(globalTime * 0.7));

    // --- Planetesimals orbit and grow with progress ---
    this.planetesimals.forEach((p) => {
      // Keplerian speed: angular velocity ∝ 1/sqrt(r)
      const kepler = p.speed / Math.sqrt(p.radius);
      p.angle += delta * kepler;

      p.mesh.position.x = Math.cos(p.angle) * p.radius;
      p.mesh.position.z = Math.sin(p.angle) * p.radius;
      p.mesh.position.y = 0;

      // Grow as planets accrete mass with progress
      const growFactor = 1.0 + easeOutExpo(progress) * 2.5;
      p.mesh.scale.setScalar(p.baseScale * growFactor);

      // Self-rotation
      p.mesh.rotation.y += delta * 0.4;
    });

    // --- Camera path ---
    // progress 0.0-0.3: top-down, wide shot
    // progress 0.3-0.7: tilting and zooming in
    // progress 0.7-1.0: close pass proto-Earth (5th planetesimal index 4)
    this.updateCamera(progress, globalTime);
  }

  private updateCamera(progress: number, globalTime: number): void {
    const slowOrbit = globalTime * 0.04;

    if (progress < 0.3) {
      // Top-down overview
      const t = progress / 0.3;
      const dist = lerp(28, 24, t);
      const elevation = lerp(22, 20, t);
      this.camera.position.x = Math.sin(slowOrbit) * dist * 0.15;
      this.camera.position.y = elevation;
      this.camera.position.z = Math.cos(slowOrbit) * dist * 0.15 + dist * 0.1;
      this.camera.lookAt(0, 0, 0);

    } else if (progress < 0.7) {
      // Tilt to 30° angle, zoom in
      const t = easeInOutCubic((progress - 0.3) / 0.4);
      const dist     = lerp(23, 14, t);
      const tiltY    = lerp(20, 8, t);
      const tiltZ    = lerp(2, 12, t);
      this.camera.position.x = Math.sin(slowOrbit * 0.8) * 3.0;
      this.camera.position.y = tiltY;
      this.camera.position.z = tiltZ + dist * 0.2;
      this.camera.lookAt(0, 0, 0);

    } else {
      // Close pass of proto-Earth (5th planetesimal)
      const t = easeInOutCubic((progress - 0.7) / 0.3);
      const target = this.planetesimals[4];
      if (target) {
        const tx = target.mesh.position.x;
        const tz = target.mesh.position.z;
        const camDist = lerp(8, 4, t);
        this.camera.position.x = lerp(this.camera.position.x, tx + camDist * 0.6, 0.04);
        this.camera.position.y = lerp(this.camera.position.y, 3.5, 0.04);
        this.camera.position.z = lerp(this.camera.position.z, tz + camDist, 0.04);
        this.camera.lookAt(tx, 0, tz);
      }
    }

    this.camera.updateProjectionMatrix();
  }

  // ----- Post config -----

  getPostConfig(progress: number): PostConfig {
    // Heavy bloom on protostar region, moderate overall
    const bloomStrength = lerp(2.8, 1.6, smoothstep(0.0, 0.5, progress));
    return {
      bloomStrength,
      bloomRadius:         lerp(0.85, 0.55, progress),
      bloomThreshold:      0.15,
      chromaticAberration: lerp(0.004, 0.002, progress),
      filmGrain:           0.03,
      godRays:             progress < 0.5,
      godRayIntensity:     lerp(0.6, 0.0, smoothstep(0.2, 0.6, progress)),
      vignetteStrength:    0.5,
      lensingStrength: 0,
      lensingCenter: [0.5, 0.5],
      lensingRadius: 0.3,
    };
  }

  // ----- Background color -----

  getBackgroundColor(_progress: number): THREE.Color {
    // Very dark amber-black: #0A0800
    return new THREE.Color(0x0a0800);
  }

  // ----- Dispose -----

  override dispose(): void {
    this.protostarMat?.dispose();
    (this.protostarMesh?.geometry as THREE.BufferGeometry)?.dispose();
    (this.protostarGlow?.material as THREE.ShaderMaterial)?.dispose();
    (this.protostarGlow?.geometry as THREE.BufferGeometry)?.dispose();
    this.diskMat?.dispose();
    (this.diskMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.dustMat?.dispose();
    this.dustGeo?.dispose();
    this.planetesimals.forEach((p) => {
      (p.mesh.geometry as THREE.BufferGeometry).dispose();
      (p.mesh.material as THREE.Material).dispose();
    });
    this.planetesimals = [];
    super.dispose();
  }
}
