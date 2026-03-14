import { EraDefinition } from '../eras/EraRegistry';
import { EraLabel } from './EraLabel';
import { TimelineBar } from './TimelineBar';
import { LoadingScreen } from './LoadingScreen';
import { CosmicHUD } from './CosmicHUD';
import { ScaleOverlay } from './ScaleOverlay';
import { MilestoneMarkers } from './MilestoneMarkers';
import { DedicationText } from './DedicationText';

const ERA_COUNT = 10;

export class Overlay {
  private container: HTMLElement;
  private eraLabel: EraLabel;
  private timelineBar: TimelineBar;
  private loadingScreen: LoadingScreen;
  private scrollHint: HTMLElement;
  private autoplayBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;
  private screenshotBtn: HTMLButtonElement;
  private speedSelector: HTMLElement;
  private speedBtns: Map<number, HTMLButtonElement> = new Map();
  private onSpeedChange: ((speed: number) => void) | null = null;
  private screenshotFlashTimer: ReturnType<typeof setTimeout> | null = null;
  private _bigBangDetonated: boolean = false;

  // Narrative HUD elements
  private cosmicHUD: CosmicHUD;
  private scaleOverlay: ScaleOverlay;
  private milestoneMarkers: MilestoneMarkers;
  private dedicationText: DedicationText;

  constructor(eras: EraDefinition[] = []) {
    const existing = document.getElementById('ui-overlay');
    if (existing) {
      this.container = existing;
    } else {
      this.container = document.createElement('div');
      this.container.id = 'ui-overlay';
      document.body.appendChild(this.container);
    }

    this.container.setAttribute('aria-label', 'Cosmic Timeline UI');

    this.eraLabel = new EraLabel(this.container);
    this.timelineBar = new TimelineBar(this.container, ERA_COUNT, eras);
    this.loadingScreen = new LoadingScreen();

    // Narrative HUD components — created before controls so they sit below
    // in z-index stacking (their z-index values are set in CSS)
    this.cosmicHUD       = new CosmicHUD(this.container);
    this.scaleOverlay    = new ScaleOverlay(this.container);
    this.milestoneMarkers = new MilestoneMarkers(this.container);
    this.dedicationText  = new DedicationText(this.container);

    // Scroll hint
    this.scrollHint = document.createElement('div');
    this.scrollHint.className = 'scroll-hint';
    this.scrollHint.innerHTML = `
      <span class="scroll-hint__text">Scroll to begin</span>
      <div class="scroll-hint__arrow"></div>
    `;
    this.container.appendChild(this.scrollHint);

    // Speed selector (shown only during autoplay)
    this.speedSelector = document.createElement('div');
    this.speedSelector.className = 'speed-selector';
    this.speedSelector.setAttribute('aria-label', 'Playback speed');

    for (const speed of [0.5, 1, 2, 3] as const) {
      const btn = document.createElement('button');
      btn.className = 'speed-btn' + (speed === 1 ? ' active' : '');
      btn.textContent = `${speed}x`;
      btn.setAttribute('aria-label', `Set speed to ${speed}x`);
      btn.setAttribute('aria-pressed', speed === 1 ? 'true' : 'false');
      btn.addEventListener('click', () => {
        this.onSpeedChange?.(speed);
      });
      this.speedBtns.set(speed, btn);
      this.speedSelector.appendChild(btn);
    }

    this.container.appendChild(this.speedSelector);

    // Control bar (bottom-right)
    const controls = document.createElement('div');
    controls.className = 'controls-bar';

    // Mute button
    this.muteBtn = document.createElement('button');
    this.muteBtn.className = 'control-btn mute-btn';
    this.muteBtn.setAttribute('aria-label', 'Toggle sound');
    this.muteBtn.innerHTML = `
      <svg class="control-btn__icon control-btn__icon--unmuted" viewBox="0 0 24 24" fill="currentColor">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
      <svg class="control-btn__icon control-btn__icon--muted" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    `;
    controls.appendChild(this.muteBtn);

    // Autoplay button
    this.autoplayBtn = document.createElement('button');
    this.autoplayBtn.className = 'control-btn autoplay-btn';
    this.autoplayBtn.setAttribute('aria-label', 'Toggle autoplay');
    this.autoplayBtn.innerHTML = `
      <svg class="control-btn__icon control-btn__icon--play" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
      <svg class="control-btn__icon control-btn__icon--pause" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
      </svg>
      <span class="control-btn__label">Autoplay</span>
    `;
    controls.appendChild(this.autoplayBtn);

    // Screenshot button
    this.screenshotBtn = document.createElement('button');
    this.screenshotBtn.className = 'control-btn screenshot-btn';
    this.screenshotBtn.setAttribute('aria-label', 'Save screenshot');
    this.screenshotBtn.innerHTML = `
      <svg class="control-btn__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="3.2"/>
        <path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/>
      </svg>
      <span class="control-btn__label">Screenshot</span>
    `;
    controls.appendChild(this.screenshotBtn);

    this.container.appendChild(controls);
  }

  onAutoplayClick(cb: () => void): void {
    this.autoplayBtn.addEventListener('click', cb);
  }

  onMuteClick(cb: () => void): void {
    this.muteBtn.addEventListener('click', cb);
  }

  onScreenshotClick(cb: () => void): void {
    this.screenshotBtn.addEventListener('click', cb);
  }

  flashScreenshotBtn(): void {
    if (this.screenshotFlashTimer !== null) {
      clearTimeout(this.screenshotFlashTimer);
      this.screenshotBtn.classList.remove('flash');
      // Force reflow so the animation re-triggers cleanly
      void this.screenshotBtn.offsetWidth;
    }
    this.screenshotBtn.classList.add('flash');
    this.screenshotFlashTimer = setTimeout(() => {
      this.screenshotBtn.classList.remove('flash');
      this.screenshotFlashTimer = null;
    }, 600);
  }

  onSpeedClick(cb: (speed: number) => void): void {
    this.onSpeedChange = cb;
  }

  setAutoplayActive(active: boolean): void {
    this.autoplayBtn.classList.toggle('playing', active);
    this.autoplayBtn.setAttribute('aria-pressed', String(active));
    this.speedSelector.classList.toggle('visible', active);
  }

  setActiveSpeed(speed: number): void {
    this.speedBtns.forEach((btn, s) => {
      const isActive = s === speed;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  }

  setMuted(muted: boolean): void {
    this.muteBtn.classList.toggle('muted', muted);
    this.muteBtn.setAttribute('aria-pressed', String(muted));
  }

  /** Call when the Big Bang explosion fires — enables UI elements. */
  setBigBangDetonated(): void {
    this._bigBangDetonated = true;
  }

  update(progress: number, eraDefinition: EraDefinition): void {
    const eraLen = eraDefinition.scrollEnd - eraDefinition.scrollStart;
    const localProgress =
      eraLen > 0
        ? Math.min(Math.max((progress - eraDefinition.scrollStart) / eraLen, 0), 1)
        : 0;

    // During Era 0 pre-detonation: hide all info UI (pure cinematic void)
    const hideUI = eraDefinition.index === 0 && !this._bigBangDetonated;

    this.eraLabel.update(
      eraDefinition.name,
      eraDefinition.time,
      eraDefinition.fact,
      localProgress,
      hideUI,
    );

    this.timelineBar.update(progress, eraDefinition.index);

    if (progress > 0.005 && this.scrollHint) {
      this.scrollHint.style.opacity = '0';
      this.scrollHint.style.transition = 'opacity 0.5s ease';
    }

    // Narrative HUD updates — suppressed during pre-detonation
    if (!hideUI) {
      this.cosmicHUD.update(progress);
      this.scaleOverlay.update(progress);
      this.milestoneMarkers.update(progress);
    }
    this.dedicationText.update(progress);
  }

  showLoading(): void {
    this.loadingScreen.setProgress(0);
  }

  hideLoading(): void {
    this.loadingScreen.hide().catch(console.error);
  }

  setLoadingProgress(p: number): void {
    this.loadingScreen.setProgress(p);
  }

  dispose(): void {
    if (this.screenshotFlashTimer !== null) {
      clearTimeout(this.screenshotFlashTimer);
      this.screenshotFlashTimer = null;
    }
    this.cosmicHUD.dispose();
    this.scaleOverlay.dispose();
    this.milestoneMarkers.dispose();
    this.dedicationText.dispose();
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}
