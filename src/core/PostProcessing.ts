import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { PostConfig } from '../eras/BaseEra';

// ---------------------------------------------------------------------------
// Film Grain shader
// ---------------------------------------------------------------------------

const FilmGrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.04 },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uTime;

    varying vec2 vUv;

    // Hash-based pseudo-random (Vlachos 2010)
    float hash(vec2 p) {
      p = fract(p * vec2(443.8975, 397.2973));
      p += dot(p.yx, p.xy + vec2(19.19, 21.07));
      return fract(p.x * p.y);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Animated grain
      float grain = hash(vUv + fract(uTime * 0.07 + 0.17));
      grain = (grain - 0.5) * 2.0; // center on 0

      // Luminance-weighted: grain more visible in midtones
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float weight = 1.0 - abs(luma * 2.0 - 1.0); // peaks at luma = 0.5

      color.rgb += grain * uStrength * weight;
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Chromatic Aberration shader
// ---------------------------------------------------------------------------

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.004 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;

    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);

      // Offset increases with distance from centre
      vec2 offset = normalize(dir) * dist * uStrength;

      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      float a = texture2D(tDiffuse, vUv).a;

      gl_FragColor = vec4(r, g, b, a);
    }
  `,
};

// ---------------------------------------------------------------------------
// Gravitational Lensing shader
// Physically-inspired Einstein ring distortion (Interstellar-style)
// ---------------------------------------------------------------------------

const GravitationalLensingShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.0 },
    uCenter:   { value: new THREE.Vector2(0.5, 0.5) },
    uRadius:   { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform vec2  uCenter;
    uniform float uRadius;

    varying vec2 vUv;

    void main() {
      vec2 dir  = vUv - uCenter;
      float dist = length(dir);

      // Einstein ring radius — set at 40% of the falloff radius
      float einsteinRadius = uRadius * 0.4;

      // Gravitational deflection: theta = 4GM/(c^2 * r)
      // Simplified: displacement inversely proportional to distance
      float deflection = uStrength * einsteinRadius * einsteinRadius
                         / (dist * dist + 0.001);
      // Fade deflection to zero at the edge of influence
      deflection *= smoothstep(0.0, uRadius, uRadius - dist);

      // Displace UV toward the mass center (magnification)
      vec2 displaced = vUv - dir * deflection * 0.15;

      // Secondary caustic ring at the Einstein radius
      float ring = exp(-pow((dist - einsteinRadius) / 0.01, 2.0))
                   * uStrength * 0.3;

      vec4 color = texture2D(tDiffuse, displaced);

      // Gravitational blueshift — brightens and blue-shifts toward center
      float blueshift = smoothstep(uRadius, 0.0, dist) * uStrength * 0.15;
      color.b += blueshift;

      // Einstein ring glow (blue-white caustic arc)
      color.rgb += vec3(0.6, 0.7, 1.0) * ring;

      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// Vignette shader
// ---------------------------------------------------------------------------

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.4 },
    uSoftness: { value: 0.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform float uSoftness;

    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Squared distance from centre → elliptical vignette
      vec2 uv = vUv - 0.5;
      float dist = length(uv * vec2(1.0, 1.0));

      float vign = smoothstep(uSoftness, uSoftness - uStrength, dist);
      // Clamp so we never go fully black
      vign = max(vign, 0.05);

      color.rgb *= vign;
      gl_FragColor = color;
    }
  `,
};

// ---------------------------------------------------------------------------
// PostProcessing class
// ---------------------------------------------------------------------------

export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private bloomPass: UnrealBloomPass;
  private lensingPass: ShaderPass;
  private grainPass: ShaderPass;
  private aberrationPass: ShaderPass;
  private vignettePass: ShaderPass;

  private time: number = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const { width, height } = renderer.getSize(new THREE.Vector2());

    this.composer = new EffectComposer(renderer);

    // 1. Render pass
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // 2. Bloom
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.8,   // strength
      0.5,   // radius
      0.4,   // threshold
    );
    this.composer.addPass(this.bloomPass);

    // 3. Gravitational lensing (disabled by default — enabled per-era)
    this.lensingPass = new ShaderPass({
      uniforms: {
        tDiffuse:   { value: null },
        uStrength:  { value: 0.0 },
        uCenter:    { value: new THREE.Vector2(0.5, 0.5) },
        uRadius:    { value: 0.3 },
      },
      vertexShader:   GravitationalLensingShader.vertexShader,
      fragmentShader: GravitationalLensingShader.fragmentShader,
    });
    this.lensingPass.enabled = false;
    this.composer.addPass(this.lensingPass);

    // 4. Chromatic aberration
    this.aberrationPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.004 },
      },
      vertexShader: ChromaticAberrationShader.vertexShader,
      fragmentShader: ChromaticAberrationShader.fragmentShader,
    });
    this.composer.addPass(this.aberrationPass);

    // 5. Film grain
    this.grainPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.04 },
        uTime: { value: 0.0 },
      },
      vertexShader: FilmGrainShader.vertexShader,
      fragmentShader: FilmGrainShader.fragmentShader,
    });
    this.composer.addPass(this.grainPass);

    // 6. Vignette (last pass — renders to screen)
    this.vignettePass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uStrength: { value: 0.4 },
        uSoftness: { value: 0.6 },
      },
      vertexShader: VignetteShader.vertexShader,
      fragmentShader: VignetteShader.fragmentShader,
    });
    this.vignettePass.renderToScreen = true;
    this.composer.addPass(this.vignettePass);
  }

  /** Apply per-frame config from the active era. */
  configure(config: PostConfig): void {
    this.bloomPass.strength = config.bloomStrength;
    this.bloomPass.radius = config.bloomRadius;
    this.bloomPass.threshold = config.bloomThreshold;

    // Gravitational lensing — disable the pass entirely when strength is zero
    // to avoid unnecessary texture samples on every frame.
    const lensingUniforms = this.lensingPass.uniforms as Record<string, THREE.IUniform>;
    if (config.lensingStrength > 0) {
      this.lensingPass.enabled = true;
      lensingUniforms['uStrength'].value = config.lensingStrength;
      lensingUniforms['uCenter'].value.set(
        config.lensingCenter[0],
        config.lensingCenter[1],
      );
      lensingUniforms['uRadius'].value = config.lensingRadius;
    } else {
      this.lensingPass.enabled = false;
    }

    (this.aberrationPass.uniforms as Record<string, THREE.IUniform>)['uStrength'].value =
      config.chromaticAberration;

    (this.grainPass.uniforms as Record<string, THREE.IUniform>)['uStrength'].value =
      config.filmGrain;

    (this.vignettePass.uniforms as Record<string, THREE.IUniform>)['uStrength'].value =
      config.vignetteStrength;
  }

  /** Update scene/camera on the RenderPass and run the composer. */
  render(
    scene: THREE.Scene,
    camera: THREE.Camera,
    delta: number = 0.016,
    renderTarget?: THREE.WebGLRenderTarget,
  ): void {
    this.time += delta;

    this.renderPass.scene = scene;
    this.renderPass.camera = camera;

    // Advance grain time
    (this.grainPass.uniforms as Record<string, THREE.IUniform>)['uTime'].value = this.time;

    if (renderTarget) {
      // Render to the provided render target instead of screen
      this.composer.renderToScreen = false;
      this.vignettePass.renderToScreen = false;
      this.composer.render(delta);
      // Copy result to the provided RT
      const renderer = this.composer.renderer;
      renderer.setRenderTarget(renderTarget);
      renderer.clear();
      // Read from composer's internal write buffer
      const readBuffer = this.composer.readBuffer;
      const copyScene = new THREE.Scene();
      const copyMat = new THREE.MeshBasicMaterial({ map: readBuffer.texture });
      const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), copyMat);
      copyQuad.frustumCulled = false;
      copyScene.add(copyQuad);
      const copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      renderer.render(copyScene, copyCamera);
      renderer.setRenderTarget(null);
      copyMat.dispose();
      copyQuad.geometry.dispose();
    } else {
      this.composer.renderToScreen = true;
      this.vignettePass.renderToScreen = true;
      this.composer.render(delta);
    }
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
  }

  dispose(): void {
    this.composer.dispose();
  }
}
