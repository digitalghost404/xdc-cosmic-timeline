import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, randomInSphere } from '../utils/math';
import { getEraColor } from '../utils/color';

// ---------------------------------------------------------------------------
// Galaxy star particles — vertex shader
// Transitions from scattered random positions → logarithmic spiral arms
// ---------------------------------------------------------------------------

const GALAXY_STAR_VERT = /* glsl */ `
  attribute vec3  aTargetPos;   // spiral arm position
  attribute vec3  aColor;       // per-star colour (warm core / cool arms)
  attribute float aSize;
  attribute float aPhase;       // random offset for breathing

  uniform float uProgress;      // local era progress [0, 1]
  uniform float uTime;          // global time for rotation + breathing
  uniform float uMorphT;        // smoothstepped 0→1 transition to spiral

  varying vec3  vColor;
  varying float vBrightness;

  void main() {
    // Interpolate between random starting cloud and final spiral position
    vec3 pos = mix(position, aTargetPos, uMorphT);

    // Continuous galaxy rotation around Y axis (whole-galaxy spin)
    float rotSpeed = 0.05;
    float angle = uTime * rotSpeed;
    float cosA = cos(angle);
    float sinA = sin(angle);
    vec3 rotPos = vec3(
      pos.x * cosA - pos.z * sinA,
      pos.y,
      pos.x * sinA + pos.z * cosA
    );

    // Breathing — subtle size pulse, more pronounced for arm stars
    float breathe = 1.0 + 0.07 * sin(uTime * 1.6 + aPhase * 6.2831853);

    vColor      = aColor;
    vBrightness = breathe;

    vec4 mvPosition = modelViewMatrix * vec4(rotPos, 1.0);
    float pointSize  = aSize * breathe * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(pointSize, 0.3, 64.0);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

// ---------------------------------------------------------------------------
// Galaxy star particles — fragment shader
// Soft gaussian glow per point
// ---------------------------------------------------------------------------

const GALAXY_STAR_FRAG = /* glsl */ `
  varying vec3  vColor;
  varying float vBrightness;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float glow = exp(-d * 6.0);
    // Bright core
    float core = exp(-d * 20.0) * 0.6;

    gl_FragColor = vec4(vColor * (glow + core) * vBrightness, glow);
  }
`;

// ---------------------------------------------------------------------------
// Dust lane — fullscreen quad, rendered behind stars
// Darkens regions along spiral arms using FBM spiral mask
// ---------------------------------------------------------------------------

const DUST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

// Full simplex 3D noise + spiral dust mask fragment
const DUST_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uMorphT;
  uniform vec2  uResolution;

  varying vec2 vUv;

  // --- Simplex 3D noise (Stefan Gustavson, public domain) ---

  vec3 mod289v3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289v4(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x)  { return mod289v4(((x * 34.0) + 1.0) * x); }
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
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * snoise(p);
      p *= 2.1;
      a *= 0.48;
    }
    return v;
  }

  // Returns how strongly this world-space 2D point lies in a spiral arm.
  // angle: azimuthal angle, radius: distance from centre
  float spiralArmMask(float angle, float radius, float numArms, float time) {
    // Logarithmic spiral: theta = log(1+r) * windingFactor
    float winding = log(1.0 + radius) * 1.5;
    // Distance to nearest arm in angular space
    float armSpacing = 6.28318530718 / numArms;
    float armAngle   = mod(angle - winding + time * 0.03, armSpacing);
    // Wrap to [-armSpacing/2, armSpacing/2]
    if (armAngle > armSpacing * 0.5) armAngle -= armSpacing;
    // Tighten arms at larger radii
    float armWidth = 0.35 / (1.0 + radius * 0.05);
    return 1.0 - smoothstep(0.0, armWidth, abs(armAngle));
  }

  void main() {
    vec2 aspect = vec2(uResolution.x / uResolution.y, 1.0);
    vec2 uv = (vUv - 0.5) * aspect;

    // Map screen UV to galaxy disc coordinates
    // The galaxy occupies roughly [-1, 1] in both axes at face-on view
    vec2 galUV = uv * 3.5;
    float radius = length(galUV);
    float angle  = atan(galUV.y, galUV.x);

    // Spiral arm mask
    float armMask = spiralArmMask(angle, radius, 4.0, uTime);

    // Radial falloff — dust is dense in the disc, fades outward
    float radialFade = exp(-radius * 0.35);

    // FBM turbulence to break up the dust lanes visually
    float noise = fbm(vec3(galUV * 0.6, uTime * 0.01)) * 0.5 + 0.5;
    noise = clamp(noise, 0.0, 1.0);

    float dustDensity = armMask * radialFade * noise;
    dustDensity = pow(dustDensity, 1.6);

    // Dust colour: very dark brown/red — it absorbs light
    vec3 dustColor = vec3(0.03, 0.01, 0.005);

    // Fade in with morph progress — dust lanes only visible once spiral forms
    float visibility = smoothstep(0.3, 0.8, uMorphT);

    gl_FragColor = vec4(dustColor, dustDensity * visibility * 0.65);
  }
`;

// ---------------------------------------------------------------------------
// Distant background galaxies — vertex shader (simple points)
// ---------------------------------------------------------------------------

const BG_GALAXY_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;
  uniform float uProgress;

  varying float vAlpha;

  void main() {
    // Fade in background galaxies in second half of era
    vAlpha = smoothstep(0.5, 0.8, uProgress);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (200.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 4.0);
    gl_Position  = projectionMatrix * mvPosition;
  }
`;

const BG_GALAXY_FRAG = /* glsl */ `
  varying float vAlpha;

  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float glow = exp(-d * 8.0);
    // Distant galaxies have a faint warm-white to blue tint
    vec3 col = mix(vec3(1.0, 0.9, 0.75), vec3(0.7, 0.8, 1.0), d * 2.0);
    gl_FragColor = vec4(col * glow, glow * vAlpha * 0.6);
  }
`;

// ---------------------------------------------------------------------------
// Cosmic web filaments — vertex + fragment shaders
// ---------------------------------------------------------------------------

const COSMIC_WEB_VERT = /* glsl */ `
  varying float vDist;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;
    vDist = -mvPos.z;
  }
`;

const COSMIC_WEB_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying float vDist;
  void main() {
    float fade = 1.0 / (1.0 + vDist * 0.01);
    vec3 col = vec3(0.8, 0.7, 0.4); // warm golden
    gl_FragColor = vec4(col, uOpacity * fade * 0.1);
  }
`;

// Node glow points — simple additive splats
const COSMIC_NODE_VERT = /* glsl */ `
  uniform float uOpacity;
  varying float vOpacity;
  void main() {
    vOpacity = uOpacity;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(4.0 * (200.0 / -mvPos.z), 0.5, 5.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const COSMIC_NODE_FRAG = /* glsl */ `
  varying float vOpacity;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float glow = exp(-d * 8.0);
    vec3 col = vec3(0.9, 0.8, 0.5);
    gl_FragColor = vec4(col * glow, glow * vOpacity * 0.6);
  }
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAR_COUNT       = 100_000;
const BG_GALAXY_COUNT  = 500;
const NUM_ARMS         = 4;

// ---------------------------------------------------------------------------
// GalaxyFormation Era
// ---------------------------------------------------------------------------

export class GalaxyFormation extends BaseEra {
  // Main galaxy star system
  private galaxyGeo!: THREE.BufferGeometry;
  private galaxyMat!: THREE.ShaderMaterial;
  private galaxyPoints!: THREE.Points;

  // Volumetric dust lane quad
  private dustMesh!: THREE.Mesh;
  private dustMat!: THREE.ShaderMaterial;

  // Distant background galaxies
  private bgGalaxyGeo!: THREE.BufferGeometry;
  private bgGalaxyMat!: THREE.ShaderMaterial;
  private bgGalaxyPoints!: THREE.Points;

  // Large-scale structure: cosmic web filaments + cluster nodes
  private cosmicWeb!: THREE.LineSegments;
  private cosmicWebMat!: THREE.ShaderMaterial;
  private cosmicNodes!: THREE.Points;
  private cosmicNodeMat!: THREE.ShaderMaterial;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.camera.near  = 0.1;
    this.camera.far   = 5000;
    this.camera.fov   = 60;
    this.camera.position.set(0, 28, 2);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.buildDustLanes();
    this.buildGalaxy();
    this.buildBackgroundGalaxies();
    this.buildCosmicWeb();

    this.isInitialized = true;
  }

  // -------------------------------------------------------------------------
  // Dust lanes — rendered first (renderOrder -1)
  // -------------------------------------------------------------------------

  private buildDustLanes(): void {
    const geo = new THREE.PlaneGeometry(2, 2);
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uProgress:   { value: 0 },
        uMorphT:     { value: 0 },
        uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      },
      vertexShader:   DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
      // Subtractive-style: multiply mode isn't available as a Three.js constant,
      // so we use NormalBlending with very low alpha and dark colour to darken the scene
      blending:       THREE.NormalBlending,
    });

    this.dustMesh = new THREE.Mesh(geo, this.dustMat);
    this.dustMesh.renderOrder  = -1;
    this.dustMesh.frustumCulled = false;
    this.scene.add(this.dustMesh);
  }

  // -------------------------------------------------------------------------
  // Galaxy star system — 100K particles
  // -------------------------------------------------------------------------

  private buildGalaxy(): void {
    this.galaxyGeo = new THREE.BufferGeometry();

    // Interleaved attribute arrays
    const randomPositions = new Float32Array(STAR_COUNT * 3);
    const spiralPositions = new Float32Array(STAR_COUNT * 3);
    const colors          = new Float32Array(STAR_COUNT * 3);
    const sizes           = new Float32Array(STAR_COUNT);
    const phases          = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      // --- Random start position: dispersed cloud ---
      const startPos = randomInSphere(18);
      randomPositions[i * 3]     = startPos.x;
      randomPositions[i * 3 + 1] = startPos.y;
      randomPositions[i * 3 + 2] = startPos.z;

      // --- Spiral arm target position ---
      const arm        = i % NUM_ARMS;
      const armAngle   = (arm / NUM_ARMS) * Math.PI * 2;
      const radius     = 0.5 + Math.random() * 15;
      const winding    = armAngle + Math.log(1 + radius) * 1.5;
      const spread     = (Math.random() - 0.5) * 0.8 / (1 + radius * 0.1);

      const spiralX = Math.cos(winding + spread) * radius;
      const spiralY = (Math.random() - 0.5) * 0.3 / (1 + radius * 0.2); // thin disc
      const spiralZ = Math.sin(winding + spread) * radius;

      spiralPositions[i * 3]     = spiralX;
      spiralPositions[i * 3 + 1] = spiralY;
      spiralPositions[i * 3 + 2] = spiralZ;

      // --- Per-star colour ---
      // Centre stars: old Population II — warm yellow/orange
      // Arm stars: young Population I — blue/white
      const normRadius = clamp(radius / 15, 0, 1);
      const warmR = lerp(1.0,  0.55, normRadius);
      const warmG = lerp(0.75, 0.70, normRadius);
      const warmB = lerp(0.35, 1.0,  normRadius);

      colors[i * 3]     = warmR;
      colors[i * 3 + 1] = warmG;
      colors[i * 3 + 2] = warmB;

      // Larger stars near centre (bulge) and the brightest arm clusters
      const isBrightCluster = Math.random() < 0.02; // 2% giant HII region stars
      sizes[i]  = isBrightCluster ? (3.0 + Math.random() * 3.0) : (0.8 + Math.random() * 1.8);
      phases[i] = Math.random() * Math.PI * 2;
    }

    // position attribute = random starting cloud
    this.galaxyGeo.setAttribute('position',   new THREE.BufferAttribute(randomPositions, 3));
    this.galaxyGeo.setAttribute('aTargetPos', new THREE.BufferAttribute(spiralPositions, 3));
    this.galaxyGeo.setAttribute('aColor',     new THREE.BufferAttribute(colors,          3));
    this.galaxyGeo.setAttribute('aSize',      new THREE.BufferAttribute(sizes,           1));
    this.galaxyGeo.setAttribute('aPhase',     new THREE.BufferAttribute(phases,          1));

    this.galaxyMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
        uMorphT:   { value: 0 },
      },
      vertexShader:   GALAXY_STAR_VERT,
      fragmentShader: GALAXY_STAR_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.galaxyPoints = new THREE.Points(this.galaxyGeo, this.galaxyMat);
    this.scene.add(this.galaxyPoints);
  }

  // -------------------------------------------------------------------------
  // Background galaxies — 500 tiny distant points
  // -------------------------------------------------------------------------

  private buildBackgroundGalaxies(): void {
    this.bgGalaxyGeo = new THREE.BufferGeometry();

    const positions = new Float32Array(BG_GALAXY_COUNT * 3);
    const sizes     = new Float32Array(BG_GALAXY_COUNT);
    const phases    = new Float32Array(BG_GALAXY_COUNT);

    for (let i = 0; i < BG_GALAXY_COUNT; i++) {
      // Distant shell around the galaxy, outside its disc
      const r   = 60 + Math.random() * 200;
      const pos = randomInSphere(r);
      // Push them away from centre to avoid overlap with main galaxy
      if (pos.length() < 60) pos.normalize().multiplyScalar(60 + Math.random() * 20);

      positions[i * 3]     = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      sizes[i]  = 0.5 + Math.random() * 1.5;
      phases[i] = Math.random() * Math.PI * 2;
    }

    this.bgGalaxyGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.bgGalaxyGeo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
    this.bgGalaxyGeo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));

    this.bgGalaxyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uProgress: { value: 0 },
      },
      vertexShader:   BG_GALAXY_VERT,
      fragmentShader: BG_GALAXY_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.bgGalaxyPoints = new THREE.Points(this.bgGalaxyGeo, this.bgGalaxyMat);
    this.scene.add(this.bgGalaxyPoints);
  }

  // -------------------------------------------------------------------------
  // Cosmic web filaments — large-scale structure visible at progress 0.6–1.0
  // -------------------------------------------------------------------------

  private buildCosmicWeb(): void {
    const nodeCount = 200;
    const nodes: THREE.Vector3[] = [];

    for (let i = 0; i < nodeCount; i++) {
      nodes.push(new THREE.Vector3(
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200,
        (Math.random() - 0.5) * 200,
      ));
    }

    // Connect each node to its 2–3 nearest neighbours
    const lines: number[] = [];
    for (const node of nodes) {
      const sorted = [...nodes]
        .filter(n => n !== node)
        .sort((a, b) => a.distanceTo(node) - b.distanceTo(node));

      const connectCount = 2 + Math.floor(Math.random() * 2);
      for (let j = 0; j < connectCount && j < sorted.length; j++) {
        lines.push(node.x, node.y, node.z);
        lines.push(sorted[j].x, sorted[j].y, sorted[j].z);
      }
    }

    const webGeo = new THREE.BufferGeometry();
    webGeo.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));

    this.cosmicWebMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
      },
      vertexShader:   COSMIC_WEB_VERT,
      fragmentShader: COSMIC_WEB_FRAG,
    });

    this.cosmicWeb = new THREE.LineSegments(webGeo, this.cosmicWebMat);
    this.scene.add(this.cosmicWeb);

    // Node glow points at each cluster position
    const nodePosArr = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      nodePosArr[i * 3]     = nodes[i].x;
      nodePosArr[i * 3 + 1] = nodes[i].y;
      nodePosArr[i * 3 + 2] = nodes[i].z;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePosArr, 3));

    this.cosmicNodeMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      uniforms: {
        uOpacity: { value: 0 },
      },
      vertexShader:   COSMIC_NODE_VERT,
      fragmentShader: COSMIC_NODE_FRAG,
    });

    this.cosmicNodes = new THREE.Points(nodeGeo, this.cosmicNodeMat);
    this.scene.add(this.cosmicNodes);
  }

  // -------------------------------------------------------------------------
  // Update — called every frame
  // -------------------------------------------------------------------------

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // Morph T: scatter → spiral arm, using smooth 0→0.5 window of progress
    const morphT = smoothstep(0.0, 0.5, progress);

    // Uniforms
    this.galaxyMat.uniforms.uProgress.value = progress;
    this.galaxyMat.uniforms.uTime.value      = globalTime;
    this.galaxyMat.uniforms.uMorphT.value    = morphT;

    this.dustMat.uniforms.uProgress.value   = progress;
    this.dustMat.uniforms.uTime.value        = globalTime;
    this.dustMat.uniforms.uMorphT.value      = morphT;
    this.dustMat.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);

    this.bgGalaxyMat.uniforms.uTime.value     = globalTime;
    this.bgGalaxyMat.uniforms.uProgress.value = progress;

    // ----- Camera choreography -----
    // progress 0.0 → 0.3:  face-on top view, pulling back
    // progress 0.3 → 0.5:  tilt from 90° (top) to 30° (diagonal)
    // progress 0.5 → 0.7:  edge-on (nearly 0° from XZ plane)
    // progress 0.7 → 1.0:  pull back to see full galaxy + background galaxies

    // Elevation angle in radians: 90° face-on → 5° nearly edge-on
    const elevFaceOn  = Math.PI * 0.5;        // 90°
    const elevDiag    = Math.PI * (30 / 180); // 30°
    const elevEdgeOn  = Math.PI * (5  / 180); // 5°

    let elevation: number;
    if (progress < 0.3) {
      elevation = elevFaceOn;
    } else if (progress < 0.5) {
      const t = (progress - 0.3) / 0.2;
      elevation = lerp(elevFaceOn, elevDiag, smoothstep(0, 1, t));
    } else if (progress < 0.7) {
      const t = (progress - 0.5) / 0.2;
      elevation = lerp(elevDiag, elevEdgeOn, smoothstep(0, 1, t));
    } else {
      elevation = elevEdgeOn;
    }

    // Distance: close at start, far at end to include background galaxies
    const camDist = lerp(28, 65, smoothstep(0.6, 1.0, progress));

    // Slow azimuthal orbit driven by globalTime
    const azimuth = globalTime * 0.018;

    const camX = Math.cos(azimuth) * Math.cos(elevation) * camDist;
    const camY = Math.sin(elevation) * camDist;
    const camZ = Math.sin(azimuth) * Math.cos(elevation) * camDist;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(0, 0, 0);

    // ---- Cosmic web filaments: fade in 0.6→0.8, hold through 1.0 ----
    const webOpacity = smoothstep(0.6, 0.8, progress);
    this.cosmicWebMat.uniforms.uOpacity.value  = webOpacity;
    this.cosmicNodeMat.uniforms.uOpacity.value = webOpacity;
    this.cosmicWeb.visible   = webOpacity > 0;
    this.cosmicNodes.visible = webOpacity > 0;
  }

  // -------------------------------------------------------------------------
  // Post-processing config
  // -------------------------------------------------------------------------

  getPostConfig(progress: number): PostConfig {
    // Moderate bloom throughout; slightly stronger while the galaxy is coalescing
    const bloomPeak = lerp(1.8, 1.2, smoothstep(0.3, 0.7, progress));

    // --- Gravitational lensing schedule ---
    // 0.0–0.3 : off — stars still scattered, no mass concentration
    // 0.3–0.5 : fade in as spiral arms and central bulge condense
    // 0.5–0.7 : peak strength while galaxy is fully formed and face-on
    // 0.7–1.0 : fade out as camera pulls back for the wide-field view
    let lensingStrength: number;
    if (progress < 0.3) {
      lensingStrength = 0;
    } else if (progress < 0.5) {
      lensingStrength = lerp(0, 0.4, smoothstep(0.3, 0.5, progress));
    } else if (progress < 0.7) {
      lensingStrength = 0.4;
    } else {
      lensingStrength = lerp(0.4, 0, smoothstep(0.7, 1.0, progress));
    }

    // Lensing radius tightens slightly as the galaxy condenses, then widens
    // as the camera retreats to give a broad, softer lens halo.
    const lensingRadius = lerp(0.28, 0.38, smoothstep(0.5, 1.0, progress));

    return {
      bloomStrength:       bloomPeak,
      bloomRadius:         0.5,
      bloomThreshold:      0.15,
      chromaticAberration: 0.002,
      filmGrain:           0.03,
      godRays:             false,
      godRayIntensity:     0.0,
      // Warm vignette framing — evokes looking through an optical telescope
      vignetteStrength:    lerp(0.5, 0.35, smoothstep(0.5, 1.0, progress)),
      // Gravitational lensing — galaxy core acts as the mass center
      lensingStrength,
      lensingCenter:       [0.5, 0.5],
      lensingRadius,
    };
  }

  // -------------------------------------------------------------------------
  // Background colour
  // -------------------------------------------------------------------------

  getBackgroundColor(progress: number): THREE.Color {
    // ERA_PALETTES[5]: warm amber → stellar white → blue-white
    // Kept very dark — actual scene background is nearly black
    const baseColor = getEraColor(5, progress);
    // Scale it down dramatically so it reads as deep space
    baseColor.multiplyScalar(0.04);
    return baseColor;
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    this.galaxyGeo?.dispose();
    this.galaxyMat?.dispose();
    this.dustMat?.dispose();
    this.bgGalaxyGeo?.dispose();
    this.bgGalaxyMat?.dispose();
    (this.dustMesh?.geometry as THREE.BufferGeometry)?.dispose();
    // Cosmic web
    this.cosmicWebMat?.dispose();
    (this.cosmicWeb?.geometry as THREE.BufferGeometry)?.dispose();
    this.cosmicNodeMat?.dispose();
    (this.cosmicNodes?.geometry as THREE.BufferGeometry)?.dispose();
    super.dispose();
  }
}
