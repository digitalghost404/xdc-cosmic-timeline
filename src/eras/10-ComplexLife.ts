import * as THREE from 'three';
import { BaseEra, PostConfig } from './BaseEra';
import { clamp, lerp, smoothstep, easeOutExpo, easeInOutCubic } from '../utils/math';
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
`;

// ---------------------------------------------------------------------------
// Branch type definitions (CPU side)
// ---------------------------------------------------------------------------

interface Branch {
  start: THREE.Vector3;
  end:   THREE.Vector3;
  depth: number;
  type:  number; // 0=plant, 1=animal, 2=fungi
}

// ---------------------------------------------------------------------------
// Tree branch CPU generation
// ---------------------------------------------------------------------------

function generateTree(maxDepth: number): Branch[] {
  const branches: Branch[] = [];

  function grow(start: THREE.Vector3, dir: THREE.Vector3, depth: number): void {
    if (depth > maxDepth) return;

    const length = 2.0 / (1.0 + depth * 0.5);
    const end    = start.clone().add(dir.clone().multiplyScalar(length));
    branches.push({ start: start.clone(), end: end.clone(), depth, type: depth % 3 });

    const numBranches = depth < 3 ? 3 : 2;
    for (let i = 0; i < numBranches; i++) {
      const angle  = (i - (numBranches - 1) / 2) * 0.6;
      const newDir = dir.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
      // Inject slight z-axis waver to give 3D sense
      newDir.z += (Math.random() - 0.5) * 0.15;
      newDir.y += 0.2;
      newDir.normalize();
      grow(end, newDir, depth + 1);
    }
  }

  grow(new THREE.Vector3(0, -6, 0), new THREE.Vector3(0, 1, 0), 0);
  return branches;
}

// ---------------------------------------------------------------------------
// Tree of Life — vertex shader
// Each segment gets a growProgress; unborn segments collapse to start point.
// ---------------------------------------------------------------------------

const TREE_VERT = /* glsl */ `
  attribute float aGrowThreshold;  // progress at which this branch fully appears
  attribute float aType;           // 0=plant, 1=animal, 2=fungi
  attribute vec3  aSegmentStart;   // world start of this segment's line
  attribute vec3  aSegmentEnd;     // world end

  uniform float uProgress;
  uniform float uTime;

  varying float vType;
  varying float vGrow;

  void main() {
    // Local grow factor [0,1] for this specific branch segment
    float grow = smoothstep(aGrowThreshold, aGrowThreshold + 0.04, uProgress);
    vGrow = grow;
    vType = aType;

    // Interpolate: collapsed to start when grow=0, full length at grow=1
    vec3 pos = mix(aSegmentStart, position, grow);

    // Subtle breathing sway driven by globalTime
    float sway = sin(uTime * 0.4 + aSegmentStart.y * 0.8) * 0.03 * grow;
    pos.x += sway;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const TREE_FRAG = /* glsl */ `
  varying float vType;
  varying float vGrow;

  uniform float uTime;

  void main() {
    if (vGrow < 0.01) discard;

    // Colour by branch type
    vec3 plantColor  = vec3(0.18, 0.85, 0.32);   // green
    vec3 animalColor = vec3(1.0,  0.65, 0.15);   // amber
    vec3 fungiColor  = vec3(0.35, 0.55, 1.0);    // blue

    vec3 col;
    float t = vType;
    if (t < 0.5) {
      col = plantColor;
    } else if (t < 1.5) {
      col = animalColor;
    } else {
      col = fungiColor;
    }

    // Gentle brightness pulse
    float pulse = 0.85 + 0.15 * sin(uTime * 0.9 + vType * 2.1);
    col *= pulse * vGrow;

    gl_FragColor = vec4(col, vGrow * 0.9);
  }
`;

// ---------------------------------------------------------------------------
// Earth night — planet sphere
// ---------------------------------------------------------------------------

const PLANET_NIGHT_VERT = /* glsl */ `
  varying vec3 vPosition;
  varying vec3 vNormal;

  void main() {
    vPosition   = position;
    vNormal     = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PLANET_NIGHT_FRAG = /* glsl */ `
  ${GLSL_SIMPLEX3}

  uniform float uProgress;
  uniform float uTime;

  varying vec3 vPosition;
  varying vec3 vNormal;

  void main() {
    float land = smoothstep(0.45, 0.55, snoise(vPosition * 1.8));

    // City lights: noise-derived clusters on land
    float cityBase  = snoise(vPosition * 8.0) * 0.5 + 0.5;
    float cityFine  = snoise(vPosition * 15.0) * 0.5 + 0.5;
    float cities    = land * pow(cityBase, 3.0) * smoothstep(0.0, 0.5, cityFine);

    // Dark nightside base
    vec3 color = vec3(0.0, 0.02, 0.06);
    color = mix(color, vec3(0.008, 0.025, 0.01), land * 0.5);
    color += vec3(1.0, 0.8, 0.3) * cities * 0.8;

    // Diffuse sun rim from the side
    vec3 lightDir = normalize(vec3(1.0, 0.3, 0.5));
    float diff    = max(dot(vNormal, lightDir), 0.0);
    // Very faint sunlit crescent only
    vec3 dayColor = mix(vec3(0.01, 0.04, 0.02), vec3(0.06, 0.08, 0.04), land);
    color = mix(color, dayColor, diff * diff * 0.35);

    // Fresnel atmosphere glow
    vec3 viewDir = normalize(-vNormal); // approximation from vertex
    float fresnel = 1.0 - abs(dot(vNormal, normalize(vec3(0.0, 0.0, 1.0))));
    fresnel = pow(fresnel, 4.0);
    color += vec3(0.2, 0.45, 1.0) * fresnel * 0.5;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// Atmosphere shell — vertex + fragment (shared with era 09 style)
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
  uniform float uAlpha;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 3.5);
    vec3 atmoColor = vec3(0.25, 0.55, 1.0);
    gl_FragColor = vec4(atmoColor, fresnel * 0.75 * uAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Deep space starfield — points
// ---------------------------------------------------------------------------

const STARS_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;

  uniform float uTime;
  uniform float uVisibility;

  varying float vAlpha;

  void main() {
    float twinkle = 0.7 + 0.3 * sin(uTime * 1.2 + aPhase * 6.28318);
    vAlpha = twinkle * uVisibility;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(aSize * (300.0 / -mvPos.z), 0.5, 6.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const STARS_FRAG = /* glsl */ `
  varying float vAlpha;

  void main() {
    if (vAlpha < 0.01) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float core = exp(-d * 12.0);
    float halo = exp(-d *  4.0) * 0.4;
    float intensity = (core + halo) * vAlpha;

    // Subtle blue-white tint
    vec3 color = mix(vec3(0.85, 0.90, 1.0), vec3(1.0, 0.95, 0.8), d * 1.5);
    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// Galaxy spiral — points rendered as a flattened disk with arm shape
// ---------------------------------------------------------------------------

const GALAXY_VERT = /* glsl */ `
  attribute float aPhase;
  attribute float aArmR;    // radial distance

  uniform float uTime;
  uniform float uVisibility;

  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    float twinkle = 0.6 + 0.4 * sin(uTime * 0.6 + aPhase * 6.28);
    vAlpha = twinkle * uVisibility;

    // Colour: core warm, arms cool
    vec3 coreColor = vec3(1.0, 0.85, 0.55);
    vec3 armColor  = vec3(0.6, 0.75, 1.0);
    vColor = mix(coreColor, armColor, clamp(aArmR, 0.0, 1.0));

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float sz = (1.5 - aArmR) * 3.0;
    gl_PointSize = clamp(sz * (400.0 / -mvPos.z), 0.5, 8.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const GALAXY_FRAG = /* glsl */ `
  varying vec3  vColor;
  varying float vAlpha;

  void main() {
    if (vAlpha < 0.01) discard;
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float intensity = exp(-d * 8.0) * vAlpha;
    gl_FragColor = vec4(vColor * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// Final convergence point — a single pulsing bright dot
// ---------------------------------------------------------------------------

const POINT_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uVisibility;
  uniform float uPulse;

  varying float vAlpha;

  void main() {
    float pulse = 1.0 + uPulse * 0.4 * sin(uTime * 2.0);
    vAlpha = uVisibility;

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp(40.0 * pulse * uVisibility, 1.0, 120.0);
    gl_Position  = projectionMatrix * mvPos;
  }
`;

const POINT_FRAG = /* glsl */ `
  varying float vAlpha;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    float core  = exp(-d * 14.0);
    float inner = exp(-d *  6.0) * 0.6;
    float outer = exp(-d *  2.5) * 0.3;
    float intensity = (core + inner + outer) * vAlpha;

    // Warm white with blue-violet tinge in the halo
    vec3 color = mix(vec3(1.0, 1.0, 1.0), vec3(0.7, 0.8, 1.0), d * 1.5);
    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

// ---------------------------------------------------------------------------
// Text morph — vertex shader
// Morphs particles from scattered positions into "YOU ARE HERE" glyphs,
// then collapses them to a singularity.
// ---------------------------------------------------------------------------

const TEXT_MORPH_VERT = /* glsl */ `
  attribute vec3  aTextTarget;
  attribute float aPhase;

  uniform float uMorphProgress; // 0 = scattered, 1 = text formed
  uniform float uTime;
  uniform float uFinalFade;     // 0 = text visible, 1 = collapsed to origin

  varying float vAlpha;

  void main() {
    float morph = smoothstep(0.0, 1.0, uMorphProgress);
    vec3 pos = mix(position, aTextTarget, morph);

    // Collapse to origin for the final singularity
    pos = mix(pos, vec3(0.0), uFinalFade);

    // Subtle float animation that damps out as we collapse
    float floatAmt = (1.0 - uFinalFade);
    pos += vec3(
      sin(uTime * 0.5 + aPhase) * 0.02 * floatAmt,
      cos(uTime * 0.3 + aPhase * 2.0) * 0.02 * floatAmt,
      0.0
    );

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Size: slightly larger when text is fully formed
    float sz = mix(1.5, 2.5, morph) * (200.0 / -mvPos.z);
    gl_PointSize = clamp(sz, 0.5, 8.0);

    // Alpha: fade in as morph starts, fade out partially during collapse
    vAlpha = smoothstep(0.0, 0.1, uMorphProgress) * (1.0 - uFinalFade * 0.8);
  }
`;

const TEXT_MORPH_FRAG = /* glsl */ `
  varying float vAlpha;

  void main() {
    if (vAlpha < 0.004) discard;

    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;

    float glow = exp(-d * 6.0);

    // Cool white — slightly blue-tinted to match the starfield palette
    vec3 color = vec3(0.90, 0.92, 1.0);
    gl_FragColor = vec4(color * glow, glow * vAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TREE_MAX_DEPTH      = 7;
const STAR_COUNT          = 3000;
const GALAXY_COUNT        = 2000;
const TEXT_PARTICLE_COUNT = 8000;

// ---------------------------------------------------------------------------
// ComplexLife Era
// ---------------------------------------------------------------------------

export class ComplexLife extends BaseEra {
  // --- Act 1: Tree of Life
  private treeSegments!:  THREE.LineSegments;
  private treeMat!:       THREE.ShaderMaterial;
  private branchData!:    Branch[];

  // --- Act 2: Earth at Night
  private earthMesh!:     THREE.Mesh;
  private earthMat!:      THREE.ShaderMaterial;
  private atmoMesh!:      THREE.Mesh;
  private atmoMat!:       THREE.ShaderMaterial;

  // --- Act 3: Deep space
  private starPoints!:    THREE.Points;
  private starMat!:       THREE.ShaderMaterial;
  private galaxyPoints!:  THREE.Points;
  private galaxyMat!:     THREE.ShaderMaterial;

  // Final convergence point
  private finalPoint!:    THREE.Points;
  private finalMat!:      THREE.ShaderMaterial;

  // --- Act 4: Text morph ("YOU ARE HERE")
  private textMorphPoints!: THREE.Points;
  private textMorphMat!:    THREE.ShaderMaterial;

  async init(): Promise<void> {
    if (this.isInitialized) return;

    this.camera.fov  = 70;
    this.camera.near = 0.01;
    this.camera.far  = 50000;
    this.camera.position.set(0, 0, 14);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    this.buildTree();
    this.buildEarth();
    this.buildStarfield();
    this.buildGalaxy();
    this.buildFinalPoint();
    this.buildTextMorph();

    this.isInitialized = true;
  }

  // -------------------------------------------------------------------------

  private buildTree(): void {
    this.branchData = generateTree(TREE_MAX_DEPTH);
    const branches  = this.branchData;
    const N         = branches.length;

    // LineSegments needs 2 vertices per segment
    const positions      = new Float32Array(N * 2 * 3);
    const segStarts      = new Float32Array(N * 2 * 3); // aSegmentStart per vertex
    const growThresholds = new Float32Array(N * 2);
    const types          = new Float32Array(N * 2);

    // Depth ranges: depth 0 at progress 0, maxDepth at progress 0.35
    const depthToProgress = (depth: number) =>
      (depth / TREE_MAX_DEPTH) * 0.33;

    for (let i = 0; i < N; i++) {
      const b     = branches[i];
      const vi    = i * 2;     // vertex index base
      const pi    = vi * 3;    // position array base

      // Start vertex
      positions[pi]     = b.start.x;
      positions[pi + 1] = b.start.y;
      positions[pi + 2] = b.start.z;

      // End vertex
      positions[pi + 3] = b.end.x;
      positions[pi + 4] = b.end.y;
      positions[pi + 5] = b.end.z;

      // Both vertices of this segment share the same start anchor (for collapse)
      for (let v = 0; v < 2; v++) {
        segStarts[(vi + v) * 3]     = b.start.x;
        segStarts[(vi + v) * 3 + 1] = b.start.y;
        segStarts[(vi + v) * 3 + 2] = b.start.z;
      }

      const thresh = depthToProgress(b.depth);
      growThresholds[vi]     = thresh;
      growThresholds[vi + 1] = thresh;
      types[vi]     = b.type;
      types[vi + 1] = b.type;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',      new THREE.BufferAttribute(positions,      3));
    geo.setAttribute('aSegmentStart', new THREE.BufferAttribute(segStarts,      3));
    geo.setAttribute('aGrowThreshold',new THREE.BufferAttribute(growThresholds, 1));
    geo.setAttribute('aType',         new THREE.BufferAttribute(types,          1));

    this.treeMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   TREE_VERT,
      fragmentShader: TREE_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
      linewidth:       1, // clamped to 1 on most WebGL implementations
    });

    this.treeSegments = new THREE.LineSegments(geo, this.treeMat);
    this.scene.add(this.treeSegments);
  }

  private buildEarth(): void {
    // Planet
    const geo = new THREE.SphereGeometry(5, 128, 64);
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uTime:     { value: 0 },
      },
      vertexShader:   PLANET_NIGHT_VERT,
      fragmentShader: PLANET_NIGHT_FRAG,
      side: THREE.FrontSide,
    });
    this.earthMesh = new THREE.Mesh(geo, this.earthMat);
    this.scene.add(this.earthMesh);

    // Atmosphere
    const atmoGeo = new THREE.SphereGeometry(5.4, 64, 32);
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0 } },
      vertexShader:   ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.BackSide,
      blending:       THREE.AdditiveBlending,
    });
    this.atmoMesh = new THREE.Mesh(atmoGeo, this.atmoMat);
    this.scene.add(this.atmoMesh);
  }

  private buildStarfield(): void {
    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes     = new Float32Array(STAR_COUNT);
    const phases    = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      // Distribute in a large sphere shell (not inside camera near zone)
      const r     = 200 + Math.random() * 800;
      const theta = Math.acos(2.0 * Math.random() - 1.0);
      const phi   = Math.random() * Math.PI * 2;

      positions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      positions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      positions[i * 3 + 2] = r * Math.cos(theta);

      sizes[i]  = 0.5 + Math.random() * 2.0;
      phases[i] = Math.random() * Math.PI * 2;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes,     1));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));

    this.starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uVisibility: { value: 0 },
      },
      vertexShader:   STARS_VERT,
      fragmentShader: STARS_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.starPoints = new THREE.Points(geo, this.starMat);
    this.scene.add(this.starPoints);
  }

  private buildGalaxy(): void {
    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array(GALAXY_COUNT * 3);
    const phases    = new Float32Array(GALAXY_COUNT);
    const armRs     = new Float32Array(GALAXY_COUNT);

    const ARMS      = 2;
    const SPREAD    = 0.25;

    for (let i = 0; i < GALAXY_COUNT; i++) {
      const r    = Math.pow(Math.random(), 0.5); // cluster toward centre
      const arm  = Math.floor(Math.random() * ARMS);
      const armAngle = (arm / ARMS) * Math.PI * 2;
      // Logarithmic spiral
      const theta = r * Math.PI * 3 + armAngle;
      const scatter = (Math.random() - 0.5) * SPREAD * r;

      const x = r * Math.cos(theta + scatter) * 80;
      const y = (Math.random() - 0.5) * 6 * (1.0 - r);
      const z = r * Math.sin(theta + scatter) * 80;

      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      phases[i] = Math.random() * Math.PI * 2;
      armRs[i]  = r;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aPhase',   new THREE.BufferAttribute(phases,    1));
    geo.setAttribute('aArmR',    new THREE.BufferAttribute(armRs,     1));

    this.galaxyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uVisibility: { value: 0 },
      },
      vertexShader:   GALAXY_VERT,
      fragmentShader: GALAXY_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.galaxyPoints = new THREE.Points(geo, this.galaxyMat);
    // Offset and tilt galaxy so it sits in the distance
    this.galaxyPoints.position.set(0, -30, -400);
    this.galaxyPoints.rotation.x = Math.PI * 0.08;
    this.scene.add(this.galaxyPoints);
  }

  private buildFinalPoint(): void {
    const geo       = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.finalMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:       { value: 0 },
        uVisibility: { value: 0 },
        uPulse:      { value: 0 },
      },
      vertexShader:   POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.finalPoint = new THREE.Points(geo, this.finalMat);
    // Will be positioned at scene centre, deep in z as camera pulls back
    this.scene.add(this.finalPoint);
  }

  // -------------------------------------------------------------------------
  // Text morph helpers
  // -------------------------------------------------------------------------

  /**
   * Rasterise `text` onto an offscreen canvas and sample `count` filled pixel
   * positions, returning them as a flat Float32Array of (x, y, z) triples in
   * world space.  The canvas is [-10, 10] on x and [-2.5, 2.5] on y so the
   * text sits comfortably in front of a camera at z = 25 looking at the origin.
   */
  private generateTextPositions(text: string, count: number): Float32Array {
    const W = 512;
    const H = 128;

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;

    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle    = '#fff';
    ctx.font         = 'bold 60px Arial, sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);

    const imageData = ctx.getImageData(0, 0, W, H);
    const filled: [number, number][] = [];

    // Step by 2 pixels to keep sampling manageable
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (imageData.data[(y * W + x) * 4 + 3] > 128) {
          filled.push([x, y]);
        }
      }
    }

    const positions = new Float32Array(count * 3);

    if (filled.length === 0) {
      // Fallback: random positions near origin (canvas fonts may not load)
      for (let i = 0; i < count; i++) {
        positions[i * 3]     = (Math.random() - 0.5) * 20;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 5;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
      }
      return positions;
    }

    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * filled.length);
      const [px, py] = filled[idx];
      // Map canvas pixel space to world space
      positions[i * 3]     =  (px - W / 2) * 0.04;       // x: ≈ -10 → 10
      positions[i * 3 + 1] = -(py - H / 2) * 0.04;       // y: ≈ -2.5 → 2.5 (flip Y)
      positions[i * 3 + 2] =  (Math.random() - 0.5) * 0.5; // slight z scatter
    }

    return positions;
  }

  private buildTextMorph(): void {
    const N = TEXT_PARTICLE_COUNT;

    // Scattered "star" positions — random points in a large volume that look
    // like the existing starfield when the morph hasn't started yet.
    const scatterPositions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r     = 5 + Math.random() * 20;
      const theta = Math.acos(2.0 * Math.random() - 1.0);
      const phi   = Math.random() * Math.PI * 2;
      scatterPositions[i * 3]     = r * Math.sin(theta) * Math.cos(phi);
      scatterPositions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
      scatterPositions[i * 3 + 2] = r * Math.cos(theta);
    }

    // Text target positions (CPU-rasterised)
    const textPositions = this.generateTextPositions('YOU ARE HERE', N);

    // Per-particle phase offsets for the float animation
    const phases = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      phases[i] = Math.random() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',    new THREE.BufferAttribute(scatterPositions, 3));
    geo.setAttribute('aTextTarget', new THREE.BufferAttribute(textPositions,    3));
    geo.setAttribute('aPhase',      new THREE.BufferAttribute(phases,           1));

    this.textMorphMat = new THREE.ShaderMaterial({
      uniforms: {
        uMorphProgress: { value: 0.0 },
        uFinalFade:     { value: 0.0 },
        uTime:          { value: 0.0 },
      },
      vertexShader:   TEXT_MORPH_VERT,
      fragmentShader: TEXT_MORPH_FRAG,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    this.textMorphPoints = new THREE.Points(geo, this.textMorphMat);
    // Place the particle system right in front of the text-phase camera
    // (camera will be at z = 25, looking at origin; particles live at z ≈ 0)
    this.textMorphPoints.visible = false;
    this.scene.add(this.textMorphPoints);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  update(progress: number, delta: number, globalTime: number): void {
    if (!this.isInitialized) return;

    // ---- Uniform updates ----
    this.treeMat.uniforms.uTime.value      = globalTime;
    this.treeMat.uniforms.uProgress.value  = progress;

    this.earthMat.uniforms.uTime.value     = globalTime;
    this.earthMat.uniforms.uProgress.value = progress;

    this.starMat.uniforms.uTime.value      = globalTime;
    this.galaxyMat.uniforms.uTime.value    = globalTime;
    this.finalMat.uniforms.uTime.value     = globalTime;
    this.textMorphMat.uniforms.uTime.value = globalTime;

    // ---- Act boundaries ----
    const act1T = clamp(progress / 0.35,              0.0, 1.0); // 0..0.35
    const act2T = clamp((progress - 0.35) / 0.20,    0.0, 1.0); // 0.35..0.55
    const act3T = clamp((progress - 0.55) / 0.45,    0.0, 1.0); // 0.55..1.0

    // ---- Visibility ----
    this.treeSegments.visible    = progress < 0.5;
    this.earthMesh.visible       = progress >= 0.3 && progress < 0.85;
    this.atmoMesh.visible        = progress >= 0.3 && progress < 0.85;
    this.starPoints.visible      = progress >= 0.55;
    this.galaxyPoints.visible    = progress >= 0.6;
    this.finalPoint.visible      = progress >= 0.75;
    this.textMorphPoints.visible = progress >= 0.75;

    // ---- Atmosphere fade ----
    if (this.atmoMesh.visible) {
      const atmoFade = smoothstep(0.3, 0.45, progress) * (1.0 - smoothstep(0.75, 0.85, progress));
      this.atmoMat.uniforms.uAlpha.value = atmoFade;
    }

    // ---- Star visibility ----
    if (this.starPoints.visible) {
      this.starMat.uniforms.uVisibility.value = smoothstep(0.55, 0.72, progress);
    }

    // ---- Galaxy visibility ----
    if (this.galaxyPoints.visible) {
      this.galaxyMat.uniforms.uVisibility.value = smoothstep(0.6, 0.80, progress);
    }

    // ---- Final point ----
    if (this.finalPoint.visible) {
      const finalV = smoothstep(0.75, 0.92, progress);
      this.finalMat.uniforms.uVisibility.value = finalV;
      this.finalMat.uniforms.uPulse.value      = smoothstep(0.85, 1.0, progress);
    }

    // ---- Text morph ("YOU ARE HERE") ----
    // Timeline within era progress:
    //   0.00-0.75 : invisible (existing zoom-out plays)
    //   0.75-0.88 : uMorphProgress 0 → 1 (particles converge into text)
    //   0.88-0.93 : text holds, particles float gently (uMorphProgress stays 1)
    //   0.93-1.00 : uFinalFade 0 → 1 (text collapses to singularity)
    if (this.textMorphPoints.visible) {
      const morphProgress = smoothstep(0.75, 0.88, progress);
      const finalFade     = smoothstep(0.93, 1.00, progress);
      this.textMorphMat.uniforms.uMorphProgress.value = morphProgress;
      this.textMorphMat.uniforms.uFinalFade.value     = finalFade;
    }

    // ---- Camera ----
    if (progress < 0.35) {
      // Act 1: fixed camera looking at the tree, slight drift
      this.camera.position.set(
        Math.sin(globalTime * 0.06) * 0.5,
        Math.sin(globalTime * 0.04) * 0.3 + 1.0,
        14.0,
      );
      this.camera.lookAt(
        Math.sin(globalTime * 0.05) * 0.2,
        Math.sin(globalTime * 0.035) * 0.2,
        0,
      );

    } else if (progress < 0.55) {
      // Act 2: orbit Earth; fade from tree to planet view
      const orbit = globalTime * 0.12;
      const dist  = lerp(14.0, 12.0, act2T);
      this.camera.position.set(
        Math.sin(orbit) * dist * 0.3,
        Math.sin(globalTime * 0.07) * 2.0,
        dist,
      );
      this.camera.lookAt(0, 0, 0);

      this.earthMesh.rotation.y = globalTime * 0.025;
      this.atmoMesh.rotation.y  = globalTime * 0.022;

    } else if (progress < 0.75) {
      // Act 3a: exponential zoom-out (0.55 → 0.75)
      const zoomT = easeOutExpo(act3T);
      const camZ  = lerp(10.0, 1000.0, zoomT);

      const drift = 1.0 - act3T;
      this.camera.position.set(
        Math.sin(globalTime * 0.04) * 3.0 * drift,
        Math.sin(globalTime * 0.03) * 2.0 * drift - 5.0 * act3T,
        camZ,
      );
      this.camera.lookAt(0, 0, 0);

      this.earthMesh.rotation.y = globalTime * 0.025;

      const galaxyZ = -200 - act3T * 600;
      this.galaxyPoints.position.z = galaxyZ;

      this.finalPoint.position.set(0, 0, 0);

    } else {
      // Act 3b / Act 4: text morph phase (0.75 → 1.0)
      // Camera transitions smoothly from the zoom-out position to the
      // straight-on text view position (0, 0, 25).
      const textT = smoothstep(0.75, 0.82, progress); // blend duration

      // Compute where Act 3a would have left the camera at progress = 0.75
      const act3TAtTextStart = clamp((0.75 - 0.55) / 0.45, 0.0, 1.0);
      const zoomTAtTextStart = easeOutExpo(act3TAtTextStart);
      const camZAtTextStart  = lerp(10.0, 1000.0, zoomTAtTextStart);

      const camZ = lerp(camZAtTextStart, 25.0, textT);
      this.camera.position.set(0, 0, camZ);
      this.camera.lookAt(0, 0, 0);

      this.finalPoint.position.set(0, 0, 0);

      // Lock galaxy so it stays in the background
      const act3TFull = easeOutExpo(1.0);
      const galaxyZ   = -200 - act3TFull * 600;
      this.galaxyPoints.position.z = galaxyZ;
    }
  }

  // -------------------------------------------------------------------------
  // Post config
  // -------------------------------------------------------------------------

  getPostConfig(progress: number): PostConfig {
    const act2T = clamp((progress - 0.35) / 0.20, 0.0, 1.0);
    const act3T = clamp((progress - 0.55) / 0.45, 0.0, 1.0);
    const finalT = clamp((progress - 0.85) / 0.15, 0.0, 1.0);

    // Bloom: gentle tree → city lights burst → final point 2.0
    let bloom: number;
    if (progress < 0.35) {
      bloom = 0.8;
    } else if (progress < 0.55) {
      bloom = lerp(0.8, 1.5, act2T);
    } else {
      bloom = lerp(1.5, 2.0, smoothstep(0.85, 1.0, progress));
    }

    return {
      bloomStrength:       bloom,
      bloomRadius:         lerp(0.5, 0.8, act3T),
      bloomThreshold:      lerp(0.35, 0.05, act3T),
      chromaticAberration: lerp(0.001, 0.008, finalT),
      filmGrain:           lerp(0.03, 0.10, act3T),
      godRays:             progress > 0.35 && progress < 0.60,
      godRayIntensity:     lerp(0.0, 0.6, smoothstep(0.35, 0.48, progress)) *
                           lerp(1.0, 0.0, smoothstep(0.52, 0.60, progress)),
      vignetteStrength:    lerp(0.4, 0.85, act3T * act3T),
      lensingStrength:     0,
      lensingCenter:       [0.5, 0.5] as [number, number],
      lensingRadius:       0.3,
    };
  }

  // -------------------------------------------------------------------------
  // Background colour
  // -------------------------------------------------------------------------

  getBackgroundColor(progress: number): THREE.Color {
    // dark underwater → space black → deep black (#000008)
    const darkTeal  = new THREE.Color(0x001a1a);
    const spaceBlack = new THREE.Color(0x000005);
    const deepBlack  = new THREE.Color(0x000008);

    if (progress < 0.35) {
      // Act 1: very dark, slight green tinge behind the tree
      const treeBase = new THREE.Color(0x020a03);
      return treeBase.clone().lerp(darkTeal, progress / 0.35);
    }
    if (progress < 0.55) {
      return darkTeal.clone().lerp(spaceBlack, (progress - 0.35) / 0.20);
    }
    return spaceBlack.clone().lerp(deepBlack, (progress - 0.55) / 0.45);
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  override dispose(): void {
    (this.treeSegments?.geometry as THREE.BufferGeometry)?.dispose();
    this.treeMat?.dispose();

    (this.earthMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.earthMat?.dispose();

    (this.atmoMesh?.geometry as THREE.BufferGeometry)?.dispose();
    this.atmoMat?.dispose();

    (this.starPoints?.geometry as THREE.BufferGeometry)?.dispose();
    this.starMat?.dispose();

    (this.galaxyPoints?.geometry as THREE.BufferGeometry)?.dispose();
    this.galaxyMat?.dispose();

    (this.finalPoint?.geometry as THREE.BufferGeometry)?.dispose();
    this.finalMat?.dispose();

    (this.textMorphPoints?.geometry as THREE.BufferGeometry)?.dispose();
    this.textMorphMat?.dispose();

    super.dispose();
  }
}
