import * as THREE from 'three';
import { Renderer } from './core/Renderer';
import { ScrollController } from './core/ScrollController';
import { SceneManager } from './core/SceneManager';
import { PostProcessing } from './core/PostProcessing';
import { QualityController } from './core/QualityController';
import { CameraOrbit } from './core/CameraOrbit';
import { StarfieldBackground } from './core/StarfieldBackground';
import { ScreenShake } from './core/ScreenShake';
import { Overlay } from './ui/Overlay';
import { CinemaMode } from './ui/CinemaMode';
import { AudioEngine } from './audio/AudioEngine';
import { AmbientLayers } from './audio/AmbientLayers';
import { Narration } from './audio/Narration';
import { getEraDefinitions } from './eras/EraRegistry';
import { BigBang } from './eras/01-BigBang';
import { getCapabilities } from './utils/capabilities';

// Crossfade blend shader
const CROSSFADE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const CROSSFADE_FRAG = /* glsl */ `
  uniform sampler2D tScene1;
  uniform sampler2D tScene2;
  uniform float uMix;
  varying vec2 vUv;

  void main() {
    vec4 c1 = texture2D(tScene1, vUv);
    vec4 c2 = texture2D(tScene2, vUv);

    vec2 center = vec2(0.5, 0.5);
    float dist = length(vUv - center);

    // Portal iris: a circular hole opens from the center, revealing scene2.
    // The radius grows slightly past the screen diagonal to guarantee full coverage.
    float portalRadius = uMix * 1.2;

    // Soft edge — inside portal shows scene2, outside shows scene1.
    float edge = smoothstep(portalRadius, portalRadius - 0.04, dist);

    // Energy ring at the portal boundary.
    float ringDist = abs(dist - portalRadius);
    // Suppress the ring once the transition is complete (uMix >= 1).
    float ringMask = 1.0 - step(1.0, uMix);
    float ring = exp(-ringDist * ringDist / 0.0008) * ringMask;

    // Chromatic aberration — the portal warps the colour channels slightly.
    vec2 dir = normalize(vUv - center);
    float aberration = ring * 0.02;
    vec4 c2r = texture2D(tScene2, vUv + dir * aberration);
    vec4 c2b = texture2D(tScene2, vUv - dir * aberration);
    vec4 c2Aberrated = vec4(c2r.r, c2.g, c2b.b, c2.a);

    // Composite: inside iris → aberrated scene2, outside → scene1.
    vec4 result = mix(c2Aberrated, c1, edge);

    // Blue-white energy glow along the iris ring.
    result.rgb += vec3(0.5, 0.7, 1.0) * ring * 2.0;

    gl_FragColor = result;
  }
`;

export class App {
  private renderer!: Renderer;
  private scrollController!: ScrollController;
  private sceneManager!: SceneManager;
  private postProcessing!: PostProcessing;
  private qualityController!: QualityController;
  private audioEngine: AudioEngine;
  private ambientLayers: AmbientLayers;
  private narration: Narration;
  private timer: THREE.Timer = new THREE.Timer();
  private overlay!: Overlay;
  private cameraOrbit!: CameraOrbit;

  // Visual polish systems
  private starfield!: StarfieldBackground;
  private screenShake!: ScreenShake;
  private cinemaMode!: CinemaMode;

  // Crossfade render targets
  private crossfadeRT1!: THREE.WebGLRenderTarget;
  private crossfadeRT2!: THREE.WebGLRenderTarget;
  private crossfadeMat!: THREE.ShaderMaterial;
  private crossfadeQuad!: THREE.Mesh;
  private crossfadeScene!: THREE.Scene;
  private crossfadeCamera!: THREE.Camera;

  private rafId: number = -1;
  private disposed: boolean = false;

  private boundResize = () => this.onResize();
  private boundTick = () => this.tick();

  constructor() {
    this.audioEngine = new AudioEngine();
    this.ambientLayers = new AmbientLayers();
    this.narration = new Narration();
  }

  async init(): Promise<void> {
    const caps = getCapabilities();
    this.qualityController = new QualityController(caps.tier);

    // Eras (needed early for UI)
    const eraDefinitions = getEraDefinitions();

    // UI — pass eras so TimelineBar can wire jump-to-era clicks
    this.overlay = new Overlay(eraDefinitions);
    this.overlay.showLoading();
    this.overlay.setLoadingProgress(0.05);

    // Renderer
    const container = document.getElementById('canvas-container') ?? document.body;
    this.renderer = new Renderer(container);
    await this.renderer.init();
    this.overlay.setLoadingProgress(0.2);

    // Scroll
    this.scrollController = new ScrollController();
    this.overlay.setLoadingProgress(0.3);

    // Scene
    this.sceneManager = new SceneManager(eraDefinitions);

    await this.sceneManager.initEra(0);
    this.overlay.setLoadingProgress(0.7);

    this.sceneManager.initEra(1).catch(console.error);
    this.overlay.setLoadingProgress(0.85);

    // Post processing
    this.sceneManager.update(0, 0.016, 0);
    const initialState = this.sceneManager.getRenderState();
    this.postProcessing = new PostProcessing(
      this.renderer.renderer,
      initialState.scene,
      initialState.camera,
    );
    this.overlay.setLoadingProgress(0.9);

    // Visual polish systems — constructed before the render loop starts
    this.starfield   = new StarfieldBackground();
    this.screenShake = new ScreenShake();
    this.cinemaMode  = new CinemaMode();

    // Crossfade
    this.setupCrossfade();
    this.overlay.setLoadingProgress(0.95);

    // Resize
    window.addEventListener('resize', this.boundResize);

    // Camera orbit (drag-to-orbit)
    this.cameraOrbit = new CameraOrbit(this.renderer.canvas);

    // Autoplay wiring
    this.overlay.onAutoplayClick(() => {
      this.scrollController.toggleAutoplay();
      // Start audio on first user interaction (autoplay click counts)
      this.ensureAudio();
    });
    this.scrollController.setAutoplayCallback((active) => {
      this.overlay.setAutoplayActive(active);
    });

    // Speed selector wiring
    this.overlay.onSpeedClick((speed) => {
      this.scrollController.setPlaybackSpeed(speed);
    });
    this.scrollController.setSpeedCallback((speed) => {
      this.overlay.setActiveSpeed(speed);
    });

    // Audio: mute toggle (keeps soundtrack and ambient layers in sync)
    this.overlay.onMuteClick(() => {
      this.ensureAudio();
      this.audioEngine.toggleMute();
      this.ambientLayers.toggleMute();
      this.narration.toggleMute();
      this.overlay.setMuted(this.audioEngine.isMuted);
    });

    // Screenshot
    this.overlay.onScreenshotClick(() => this.takeScreenshot());

    // Start audio on first scroll/click/touch (user gesture required)
    const startAudioOnce = () => {
      this.ensureAudio();
      window.removeEventListener('scroll', startAudioOnce);
      window.removeEventListener('click', startAudioOnce);
      window.removeEventListener('touchstart', startAudioOnce);
    };
    window.addEventListener('scroll', startAudioOnce, { passive: true });
    window.addEventListener('click', startAudioOnce);
    window.addEventListener('touchstart', startAudioOnce, { passive: true });

    // Done
    this.overlay.setLoadingProgress(1.0);
    await new Promise<void>((r) => setTimeout(r, 400));
    this.overlay.hideLoading();

    this.timer.connect(document);
    this.tick();
  }

  private takeScreenshot(): void {
    const renderer = this.renderer.renderer;
    const canvas = renderer.domElement;
    const state = this.sceneManager.getRenderState();

    // Re-render the current frame so the drawing buffer is freshly populated
    // with the fully post-processed image before calling toBlob().
    // preserveDrawingBuffer: true on the renderer ensures the buffer survives
    // across rAF boundaries; the explicit re-render here guarantees we capture
    // the most recent post-processed output including any crossfade blend.
    if (state.transitionScene && state.transitionCamera && state.transitionMix > 0.001) {
      this.renderStarfieldToBackground(state.scene);
      this.renderStarfieldToBackground(state.transitionScene);

      this.screenShake.apply(state.camera);
      this.postProcessing.render(state.scene, state.camera, 0.016, this.crossfadeRT1);
      this.screenShake.restore(state.camera);

      this.screenShake.apply(state.transitionCamera);
      this.postProcessing.render(
        state.transitionScene,
        state.transitionCamera,
        0.016,
        this.crossfadeRT2,
      );
      this.screenShake.restore(state.transitionCamera);

      this.crossfadeMat.uniforms.uMix.value = state.transitionMix;
      this.crossfadeMat.uniforms.tScene1.value = this.crossfadeRT1.texture;
      this.crossfadeMat.uniforms.tScene2.value = this.crossfadeRT2.texture;
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(this.crossfadeScene, this.crossfadeCamera);
    } else {
      this.renderStarfieldToBackground(state.scene);
      this.screenShake.apply(state.camera);
      renderer.setRenderTarget(null);
      renderer.clear();
      this.postProcessing.render(state.scene, state.camera, 0.016);
      this.screenShake.restore(state.camera);
    }

    const eraDef = this.sceneManager.getCurrentEraDefinition();
    const filename = `cosmic-timeline-${eraDef.id}.png`;

    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = filename;
      a.href = url;
      a.click();
      // Allow the browser to initiate the download before revoking the URL
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, 'image/png');

    this.overlay.flashScreenshotBtn();
  }

  private ensureAudio(): void {
    if (!this.audioEngine.isStarted) {
      this.audioEngine.start().then(() => {
        const sharedCtx = this.audioEngine.getContext();
        this.ambientLayers.start(sharedCtx ?? undefined).catch(console.error);

        // Start narration with shared context + ducking
        this.narration.start(sharedCtx ?? undefined).catch(console.error);
        // Big Bang detonation cue — fires when narrator says "and then, it erupted"
        this.narration.onCue('bigbang-detonate', () => {
          const bigBang = this.sceneManager.getEra(0);
          if (bigBang && bigBang instanceof BigBang) {
            bigBang.detonate();
            this.screenShake.trigger(0.25, 0.88);
            this.overlay.setBigBangDetonated();
          }
        });

        this.narration.setDuckCallback((ducked) => {
          // Duck the soundtrack and ambient layers when narration is speaking
          if (!this.audioEngine.getContext()) return;
          const ctx = this.audioEngine.getContext()!;
          const now = ctx.currentTime;
          // Can't directly access AudioEngine's masterGain, so use a ducking approach
          // via the audio element's volume
          const audio = (this.audioEngine as any).audio as HTMLAudioElement | undefined;
          if (audio) {
            audio.volume = ducked ? 0.25 : 1.0;
          }
        });
      }).catch(console.error);
    }
  }

  private setupCrossfade(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const rtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
    };

    this.crossfadeRT1 = new THREE.WebGLRenderTarget(w, h, rtOptions);
    this.crossfadeRT2 = new THREE.WebGLRenderTarget(w, h, rtOptions);

    this.crossfadeMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene1: { value: this.crossfadeRT1.texture },
        tScene2: { value: this.crossfadeRT2.texture },
        uMix: { value: 0 },
      },
      vertexShader: CROSSFADE_VERT,
      fragmentShader: CROSSFADE_FRAG,
      depthTest: false,
      depthWrite: false,
    });

    this.crossfadeQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      this.crossfadeMat,
    );
    this.crossfadeQuad.frustumCulled = false;

    this.crossfadeScene = new THREE.Scene();
    this.crossfadeScene.add(this.crossfadeQuad);
    this.crossfadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  // ---------------------------------------------------------------------------
  // Render the starfield into its dedicated RT, then assign the RT texture as
  // the given era scene's background.  The EffectComposer RenderPass will then
  // composite 3-D content over it in a single forward pass.
  // ---------------------------------------------------------------------------

  private renderStarfieldToBackground(eraScene: THREE.Scene): void {
    const renderer = this.renderer.renderer;
    renderer.setRenderTarget(this.starfield.renderTarget);
    renderer.clear();
    renderer.render(this.starfield.scene, this.starfield.camera);
    renderer.setRenderTarget(null);
    eraScene.background = this.starfield.renderTarget.texture;
  }

  // ---------------------------------------------------------------------------
  // Per-era shake triggers — called once per frame before rendering
  // ---------------------------------------------------------------------------

  private updateShakeTriggers(
    eraIndex: number,
    localEraProgress: number,
    scrollVelocity: number,
  ): void {
    // Fast scroll always produces a subtle physical nudge
    if (Math.abs(scrollVelocity) > 0.5) {
      this.screenShake.trigger(Math.abs(scrollVelocity) * 0.01);
    }

    // Era 0 — Big Bang detonation: brief violent burst
    if (eraIndex === 0 && localEraProgress > 0.002 && localEraProgress < 0.012) {
      this.screenShake.trigger(0.15, 0.90);
    }

    // Era 7 — Earth formation: three asteroid impacts at ~20%, ~40%, ~60%
    if (eraIndex === 7) {
      const p = localEraProgress;
      if (Math.abs(p - 0.20) < 0.005 || Math.abs(p - 0.40) < 0.005 || Math.abs(p - 0.60) < 0.005) {
        this.screenShake.trigger(0.08, 0.92);
      }
    }
  }

  private tick(): void {
    if (this.disposed) return;

    this.rafId = requestAnimationFrame(this.boundTick);

    this.timer.update();
    const delta = Math.min(this.timer.getDelta(), 0.1);
    const globalTime = this.timer.getElapsed();

    this.qualityController.update(delta);

    // Time dilation: advance smoothed progress with era-aware damping before
    // any other system reads it this frame.
    const currentEraDef = this.sceneManager.getCurrentEraDefinition();
    this.scrollController.smoothProgress(currentEraDef.index, delta);

    const progress       = this.scrollController.getProgress();
    const scrollVelocity = this.scrollController.getVelocity();

    this.sceneManager.update(progress, delta, globalTime);

    const state  = this.sceneManager.getRenderState();
    const eraDef = this.sceneManager.getCurrentEraDefinition();
    const eraLen = eraDef.scrollEnd - eraDef.scrollStart;
    const localEraProgress = eraLen > 0
      ? Math.max(0, Math.min(1, (progress - eraDef.scrollStart) / eraLen))
      : 0;

    // --- Starfield parallax background ---
    this.starfield.update(progress, globalTime);

    // --- Screen shake ---
    this.updateShakeTriggers(eraDef.index, localEraProgress, scrollVelocity);
    this.screenShake.update(delta);

    // Camera orbit — advance lerp and apply drag offset on top of cinematic position
    this.cameraOrbit.update(delta);
    if (state.camera instanceof THREE.PerspectiveCamera) {
      const lookTarget = new THREE.Vector3(0, 0, 0);
      // Use the camera's current look-at target by projecting its forward vector
      lookTarget.set(0, 0, -1).applyQuaternion(state.camera.quaternion).add(state.camera.position);
      this.cameraOrbit.apply(state.camera, lookTarget);
    }

    this.postProcessing.configure(state.postConfig);

    if (state.transitionScene && state.transitionCamera && state.transitionMix > 0.001) {
      const renderer = this.renderer.renderer;

      // Bake starfield texture into each era scene's background before compositing
      this.renderStarfieldToBackground(state.scene);
      this.renderStarfieldToBackground(state.transitionScene);

      // Apply shake, render RT1 (current era), restore
      this.screenShake.apply(state.camera);
      this.postProcessing.render(state.scene, state.camera, delta, this.crossfadeRT1);
      this.screenShake.restore(state.camera);

      // Apply shake, render RT2 (transition era), restore
      this.screenShake.apply(state.transitionCamera);
      this.postProcessing.render(state.transitionScene, state.transitionCamera, delta, this.crossfadeRT2);
      this.screenShake.restore(state.transitionCamera);

      this.crossfadeMat.uniforms.uMix.value    = state.transitionMix;
      this.crossfadeMat.uniforms.tScene1.value = this.crossfadeRT1.texture;
      this.crossfadeMat.uniforms.tScene2.value = this.crossfadeRT2.texture;

      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.render(this.crossfadeScene, this.crossfadeCamera);
    } else {
      this.renderStarfieldToBackground(state.scene);
      this.screenShake.apply(state.camera);
      this.renderer.renderer.clear();
      this.postProcessing.render(state.scene, state.camera, delta);
      this.screenShake.restore(state.camera);
    }

    // Audio
    this.audioEngine.update(progress, eraDef.index);
    this.ambientLayers.update(progress, eraDef.index);
    this.narration.update(eraDef.index, localEraProgress);

    // UI
    this.overlay.update(progress, eraDef);
  }

  private onResize(): void {
    this.renderer.resize();

    const w = window.innerWidth;
    const h = window.innerHeight;

    this.postProcessing.resize(w, h);
    this.crossfadeRT1.setSize(w, h);
    this.crossfadeRT2.setSize(w, h);
    this.starfield.resize(w, h);

    const state = this.sceneManager.getRenderState();
    if (state.camera instanceof THREE.PerspectiveCamera) {
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
    }
    if (state.transitionCamera instanceof THREE.PerspectiveCamera) {
      state.transitionCamera.aspect = w / h;
      state.transitionCamera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.disposed = true;

    if (this.rafId >= 0) {
      cancelAnimationFrame(this.rafId);
    }

    window.removeEventListener('resize', this.boundResize);

    this.scrollController.dispose();
    this.sceneManager.dispose();
    this.postProcessing.dispose();
    this.cameraOrbit.dispose();
    this.renderer.dispose();
    this.overlay.dispose();
    this.cinemaMode.dispose();
    this.audioEngine.dispose();
    this.ambientLayers.dispose();
    this.narration.dispose();
    this.starfield.dispose();
    this.crossfadeRT1.dispose();
    this.crossfadeRT2.dispose();
    this.crossfadeMat.dispose();
    (this.crossfadeQuad.geometry as THREE.BufferGeometry).dispose();
  }
}
