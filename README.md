# Cosmic Timeline

**Scroll through 13.8 billion years of cosmic history.**

From the moment everything erupted into existence to the instant you're reading this sentence — every second of the universe's life, told as an immersive visual journey you control with your scroll wheel.

---

## The Story

The universe is 13.8 billion years old. That number is so large it's meaningless. So we built something to make you *feel* it.

**Cosmic Timeline** is a scroll-driven experience through 10 cosmic eras, each rendered as a real-time WebGL scene with custom GLSL shaders. No pre-rendered video. No static images. Every frame is computed live on your GPU — procedural stars, raymarched plasma, gravitational physics, and volumetric atmospheres, all responding to your scroll position and breathing with time.

### The 10 Eras

| Era | When | What Happened |
|-----|------|---------------|
| **The Big Bang** | 13.8 billion years ago | All matter, energy, space and time erupted from an infinitely dense singularity |
| **Quark-Gluon Plasma** | Microseconds later | A trillion-degree ocean of fundamental particles |
| **Cosmic Microwave Background** | 380,000 years | The universe became transparent — light traveled freely for the first time |
| **The Dark Ages** | 380,000 – 150 million years | No stars. No light. Only hydrogen drifting in total darkness |
| **First Stars** | 150 – 800 million years | Population III stars ignited — hundreds of solar masses, blazing blue-white |
| **Galaxy Formation** | 1 – 5 billion years | Gravity sculpted billions of stars into spiral arms |
| **Our Solar System** | 4.6 billion years ago | A molecular cloud collapsed; the Sun ignited |
| **Earth Formation** | 4.5 billion years ago | A molten world bombarded by asteroids; the Moon formed from a giant impact |
| **Oceans & First Life** | 3.8 billion years ago | Water covered the world; chemistry became biology near deep-sea vents |
| **Complex Life & You** | 3.5 billion years ago → now | From a single cell to human civilization in 3.5 billion years |

### The Details That Make It Special

- **Narrated journey** — A voiceover guides you through each era. The Big Bang explosion is synced to the narrator saying *"And then, it erupted."*
- **The Dark Ages feel heavy** — The scroll literally becomes sluggish during the 150-million-year void. You feel the emptiness.
- **First Stars hit hard** — After total darkness, the first star ignites with a lens flare that fills the screen. It's earned.
- **Real CMB data** — The Cosmic Microwave Background pattern is generated using angular power spectrum weighting that matches ESA Planck satellite measurements.
- **Gravitational lensing** — During Galaxy Formation, spacetime warps around the galactic core, bending the light of background stars.
- **"YOU ARE HERE"** — At the very end, 350,000 particles reassemble into these three words before collapsing back to a singularity. The loop closes.
- **The dedication** — *"13.8 billion years. And here you are."*

### Audio

The soundtrack is a royalty-free ambient track processed through per-era dynamic filters — muffled during the Dark Ages, wide open during Galaxy Formation, crescendo at the end. Layered on top: procedural sub-bass rumble, a ticking cosmic clock, ocean waves, crackling magma, and a 72 BPM heartbeat that fades in during the final zoom-out.

---

## Try It

### Quick Start

```bash
git clone https://github.com/xdc-lab/xdc-cosmic-timeline.git
cd xdc-cosmic-timeline
npm install
npm run dev
```

Open http://localhost:5173 and scroll. Or click **Autoplay** and lean back.

### Controls

| Control | Action |
|---------|--------|
| **Scroll** | Travel through time |
| **Autoplay** button | Auto-scroll through the entire timeline (4 min at 1x) |
| **0.5x / 1x / 2x / 3x** | Playback speed (appears during autoplay) |
| **Sound** button | Toggle audio |
| **Camera** button | Save a screenshot as PNG |
| **Click + drag** | Orbit the camera freely (returns to cinematic path) |
| **Timeline dots** | Click to jump to any era (hover for name) |
| **F** | Cinema mode — fullscreen, hide all UI |
| **ESC** | Exit cinema mode |

### Requirements

- Modern browser with WebGL 2.0 (Chrome, Firefox, Edge, Safari 17+)
- Dedicated GPU recommended for best quality
- Sound on recommended — the narration and soundtrack are integral to the experience

---

## Technical Architecture

For those who want to look under the hood.

### Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| Three.js | r183 | WebGL rendering, post-processing |
| GSAP + ScrollTrigger | 3.14 | Scroll-driven animation with scrub interpolation |
| Web Audio API | — | Procedural ambient audio, spatial Doppler effects |
| ElevenLabs | — | AI-generated narration |
| TypeScript | 5.9 | Type safety |
| Vite | 8.0 | Build tooling |

### Rendering Pipeline

```
tick():
  timer.update()
  scrollController.smoothProgress(eraIndex, delta)  // time-dilation per era
  sceneManager.update(progress, delta, globalTime)
  starfield.update()                                 // parallax background
  screenShake.update()                               // trauma-based camera shake
  cameraOrbit.apply()                                // user drag offset

  if crossfading:
    render era1 → RT1 (with starfield baked as background)
    render era2 → RT2
    portal iris shader blends RT1 + RT2 → screen
  else:
    render single era with post-processing → screen

  audioEngine.update()      // soundtrack filters
  ambientLayers.update()    // procedural sound layers
  narration.update()        // voiceover cues
  overlay.update()          // HUD, milestones, labels
```

### Post-Processing Chain

Render → **Bloom** (UnrealBloomPass) → **Gravitational Lensing** (Einstein ring distortion) → **Chromatic Aberration** → **Film Grain** → **Vignette** → Screen

### Key Shader Techniques

- **Raymarched volumetric plasma** — 64-step volume rendering with domain-warped FBM noise (Era 2)
- **Blackbody radiation** — Tanner Helland temperature-to-color approximation for realistic star/particle colors
- **Voronoi tectonic plates** — Animated cell boundaries for Earth's molten surface (Era 8)
- **FFT-inspired ocean** — Vertex-displaced plane with caustic projections (Era 9)
- **L-system fractal tree** — Recursive branching with depth-based growth animation (Era 10)
- **Gravitational lensing** — Inverse-square UV displacement with Einstein ring caustic (Era 6)

### File Structure

```
src/
├── main.ts                    # Entry point
├── App.ts                     # Orchestrator, render loop, crossfade
├── core/                      # Renderer, ScrollController, PostProcessing, etc.
├── eras/                      # 10 era implementations (01-BigBang.ts through 10-ComplexLife.ts)
├── audio/                     # AudioEngine, AmbientLayers, Narration
├── ui/                        # Overlay, HUD, milestones, timeline bar
├── utils/                     # Math, color utilities, capability detection
└── styles/                    # CSS
```

---

## Credits

- **Soundtrack**: Royalty-free ambient track
- **Explosion SFX**: Royalty-free sound effect
- **Narration**: Generated with [ElevenLabs](https://elevenlabs.io)
- **CMB pattern**: Based on angular power spectrum measurements from the [ESA Planck mission](https://www.esa.int/Science_Exploration/Space_Science/Planck)
- **Scientific data**: Cosmological parameters from [Planck 2018 results](https://arxiv.org/abs/1807.06209)

## License

**Code**: [MIT License](LICENSE) — use, modify, and distribute the source freely.

**Creative content** (visuals, shaders, narration, audio, artistic presentation): [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — share and adapt, but not for commercial use.
