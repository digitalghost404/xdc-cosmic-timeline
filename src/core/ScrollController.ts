import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { clamp, inverseLerp } from '../utils/math';

gsap.registerPlugin(ScrollTrigger);

/** Full journey duration in seconds when autoplaying. */
const AUTOPLAY_DURATION = 240; // 4 minutes for the whole timeline
/** How long after manual scroll before autoplay resumes (ms). */
const RESUME_DELAY = 4000;
/** Accepted playback speed values. */
const VALID_SPEEDS = [0.5, 1, 2, 3] as const;
type PlaybackSpeed = (typeof VALID_SPEEDS)[number];

export class ScrollController {
  private progress: number = 0;
  private rawProgress: number = 0;
  private velocity: number = 0;
  private lastProgress: number = 0;
  private lastTimestamp: number = performance.now();
  private trigger: ScrollTrigger | null = null;

  // Time dilation — per-era scrub factors that control how quickly the
  // smoothed progress tracks the raw ScrollTrigger progress.
  // Higher value = heavier/slower feel; lower value = snappier/lighter feel.
  private readonly scrubFactors = [
    0.3,  // 0 Big Bang      — explosive, immediate
    0.5,  // 1 Particle Soup — energetic
    0.8,  // 2 CMB           — smooth, ethereal
    2.0,  // 3 Dark Ages     — heavy, sluggish, oppressive
    0.4,  // 4 First Stars   — pulled forward by light
    0.7,  // 5 Galaxy        — majestic, flowing
    0.8,  // 6 Solar System  — steady, grounded
    0.6,  // 7 Earth         — dynamic
    1.0,  // 8 Oceans        — fluid, watery
    0.3,  // 9 Life          — accelerating, rushing toward now
  ] as const;

  // Autoplay state
  private _autoplay: boolean = false;
  private autoplayTween: gsap.core.Tween | null = null;
  private userScrolling: boolean = false;
  private resumeTimer: number = -1;
  private onAutoplayChange: ((active: boolean) => void) | null = null;
  private onSpeedChange: ((speed: PlaybackSpeed) => void) | null = null;

  // Playback speed
  private _playbackSpeed: PlaybackSpeed = 1;

  // Proxy target for GSAP to tween
  private scrollProxy = { value: 0 };

  // End-of-timeline loop-back state
  private endHoldTimer: number = -1;
  private endLoopArmed: boolean = false;
  private restartTween: gsap.core.Tween | null = null;

  constructor() {
    // Force scroll to top before anything else — prevents browser restore
    window.scrollTo(0, 0);

    this.setupScrollSpacer();
    this.createTrigger();
    this.listenForUserScroll();
    this.monitorEndOfTimeline();

    // Reset again after ScrollTrigger has initialized and measured the page
    ScrollTrigger.refresh();
    window.scrollTo(0, 0);

    // One more deferred reset to catch any async browser restore
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      ScrollTrigger.refresh();
    });
  }

  private setupScrollSpacer(): void {
    let spacer = document.getElementById('scroll-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.id = 'scroll-spacer';
      document.body.appendChild(spacer);
    }
    spacer.style.height = '60000px';
    spacer.style.position = 'relative';
    spacer.style.pointerEvents = 'none';
  }

  private createTrigger(): void {
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;

    this.trigger = ScrollTrigger.create({
      trigger: spacer,
      start: 'top top',
      end: 'bottom bottom',
      scrub: 0.8,
      onUpdate: (self) => {
        this.rawProgress = clamp(self.progress, 0, 1);
      },
    });
  }

  /** Detect manual scroll/touch to pause autoplay. */
  private listenForUserScroll(): void {
    const onUserInput = () => {
      if (!this._autoplay) return;

      // Pause autoplay while user is scrolling
      this.userScrolling = true;
      this.pauseAutoplayTween();

      // Clear any existing resume timer
      if (this.resumeTimer >= 0) {
        clearTimeout(this.resumeTimer);
      }

      // Resume autoplay after inactivity
      this.resumeTimer = window.setTimeout(() => {
        this.userScrolling = false;
        if (this._autoplay) {
          this.startAutoplayTween();
        }
      }, RESUME_DELAY);
    };

    window.addEventListener('wheel', onUserInput, { passive: true });
    window.addEventListener('touchmove', onUserInput, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) {
        onUserInput();
      }
    });
  }

  /**
   * Called once per frame (from App.tick) before reading progress.
   * Advances the smoothed progress toward the raw ScrollTrigger value using
   * an era-specific lerp speed — this is the "time dilation" scroll feel.
   */
  smoothProgress(eraIndex: number, delta: number): void {
    const factor = this.scrubFactors[eraIndex] ?? 0.8;
    // speed: higher factor → slower tracking (heavier feel)
    const speed = (1.0 / factor) * delta * 5.0;

    const now = performance.now();
    const dt = Math.max((now - this.lastTimestamp) / 1000, 0.001);
    this.lastTimestamp = now;

    const prev = this.progress;
    this.progress += (this.rawProgress - this.progress) * Math.min(speed, 1);
    this.velocity = (this.progress - prev) / dt;
    this.lastProgress = this.progress;
  }

  /** Global scroll progress 0-1 (smoothed, era-aware) */
  getProgress(): number {
    return this.progress;
  }

  getVelocity(): number {
    return this.velocity;
  }

  getEraProgress(eraStart: number, eraEnd: number): number {
    return clamp(inverseLerp(eraStart, eraEnd, this.progress), 0, 1);
  }

  isInRange(start: number, end: number): boolean {
    return this.progress >= start && this.progress <= end;
  }

  // ---------------------------------------------------------------------------
  // Autoplay
  // ---------------------------------------------------------------------------

  get autoplay(): boolean {
    return this._autoplay;
  }

  setAutoplayCallback(cb: (active: boolean) => void): void {
    this.onAutoplayChange = cb;
  }

  setSpeedCallback(cb: (speed: PlaybackSpeed) => void): void {
    this.onSpeedChange = cb;
  }

  get playbackSpeed(): PlaybackSpeed {
    return this._playbackSpeed;
  }

  setPlaybackSpeed(speed: number): void {
    const validated = VALID_SPEEDS.find((v) => v === speed);
    if (validated === undefined) return;
    if (validated === this._playbackSpeed) return;

    this._playbackSpeed = validated;
    this.onSpeedChange?.(validated);

    // If currently autoplaying, restart the tween at the new speed
    if (this._autoplay && !this.userScrolling) {
      this.startAutoplayTween();
    }
  }

  toggleAutoplay(): void {
    this._autoplay = !this._autoplay;

    if (this._autoplay) {
      this.userScrolling = false;
      this.startAutoplayTween();
    } else {
      this.stopAutoplayTween();
    }

    this.onAutoplayChange?.(this._autoplay);
  }

  private startAutoplayTween(): void {
    this.stopAutoplayTween();

    // Sync proxy to current scroll position
    const spacer = document.getElementById('scroll-spacer');
    if (!spacer) return;
    const maxScroll = spacer.offsetHeight - window.innerHeight;
    const currentScroll = window.scrollY;
    this.scrollProxy.value = currentScroll;

    // How far left to go
    const remaining = maxScroll - currentScroll;
    if (remaining <= 0) return;

    // Duration proportional to remaining distance, divided by playback speed
    const duration = (AUTOPLAY_DURATION * (remaining / maxScroll)) / this._playbackSpeed;

    this.autoplayTween = gsap.to(this.scrollProxy, {
      value: maxScroll,
      duration,
      ease: 'none',
      onUpdate: () => {
        if (!this.userScrolling) {
          window.scrollTo(0, this.scrollProxy.value);
        }
      },
      onComplete: () => {
        // Reached the end — stop autoplay
        this._autoplay = false;
        this.onAutoplayChange?.(false);
      },
    });
  }

  private pauseAutoplayTween(): void {
    this.autoplayTween?.pause();
  }

  private stopAutoplayTween(): void {
    if (this.autoplayTween) {
      this.autoplayTween.kill();
      this.autoplayTween = null;
    }
    if (this.resumeTimer >= 0) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = -1;
    }
  }

  // ---------------------------------------------------------------------------
  // End-of-timeline: hold for 5 s then smoothly loop back to top
  // ---------------------------------------------------------------------------

  private monitorEndOfTimeline(): void {
    // Poll progress every 500 ms; arm the loop-back when the user reaches the end.
    // We use polling rather than a ScrollTrigger onLeave because the scrub tween
    // makes the trigger fire unreliably at exactly progress=1.
    const POLL_INTERVAL = 500;
    const HOLD_DURATION = 5000; // ms before looping back
    const END_THRESHOLD = 0.998;

    const poll = () => {
      if (this.progress >= END_THRESHOLD) {
        if (!this.endLoopArmed) {
          this.endLoopArmed = true;
          this.endHoldTimer = window.setTimeout(() => {
            this.scrollToTop();
          }, HOLD_DURATION);
        }
      } else {
        // User scrolled back — cancel any pending loop
        if (this.endLoopArmed) {
          this.endLoopArmed = false;
          if (this.endHoldTimer >= 0) {
            clearTimeout(this.endHoldTimer);
            this.endHoldTimer = -1;
          }
          if (this.restartTween) {
            this.restartTween.kill();
            this.restartTween = null;
          }
        }
      }
    };

    // Use setInterval so the check persists for the lifetime of the controller
    window.setInterval(poll, POLL_INTERVAL);
  }

  private scrollToTop(): void {
    // Kill any existing restart tween
    if (this.restartTween) {
      this.restartTween.kill();
      this.restartTween = null;
    }

    const scrollProxy = { y: window.scrollY };
    this.restartTween = gsap.to(scrollProxy, {
      y: 0,
      duration: 3,
      ease: 'power2.inOut',
      onUpdate: () => {
        window.scrollTo(0, scrollProxy.y);
      },
      onComplete: () => {
        this.restartTween = null;
        this.endLoopArmed = false;
        this.endHoldTimer = -1;
      },
    });
  }

  dispose(): void {
    this.stopAutoplayTween();
    if (this.endHoldTimer >= 0) {
      clearTimeout(this.endHoldTimer);
      this.endHoldTimer = -1;
    }
    if (this.restartTween) {
      this.restartTween.kill();
      this.restartTween = null;
    }
    if (this.trigger) {
      this.trigger.kill();
      this.trigger = null;
    }
    ScrollTrigger.getAll().forEach((t) => t.kill());
  }
}
