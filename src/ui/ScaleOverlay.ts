// ScaleOverlay — visceral scale comparison text that pops up at specific scroll positions.
// One overlay at a time, auto-fades after its duration, respects backward scrolling.

interface ScaleMarker {
  progress: number;
  text: string;
  duration: number; // seconds
}

const SCALE_MARKERS: ScaleMarker[] = [
  { progress: 0.01, text: 'The observable universe is smaller than an atom',      duration: 4 },
  { progress: 0.05, text: 'The universe is now the size of a grapefruit',         duration: 4 },
  { progress: 0.10, text: 'Temperature: 1 trillion degrees — hotter than any star', duration: 4 },
  { progress: 0.20, text: 'Light travels freely for the first time',               duration: 4 },
  { progress: 0.35, text: 'The first star is 300× more massive than our Sun',      duration: 4 },
  { progress: 0.50, text: 'Our galaxy contains 200 billion stars',                 duration: 4 },
  { progress: 0.60, text: '99.86% of the Solar System\'s mass is in the Sun',     duration: 4 },
  { progress: 0.70, text: 'Earth\'s surface is 1,200°C — hot enough to melt rock', duration: 4 },
  { progress: 0.80, text: 'The ocean is 200× deeper than the tallest building',   duration: 4 },
  { progress: 0.92, text: 'All of human history fits in the last 0.001%',         duration: 5 },
];

export class ScaleOverlay {
  private el: HTMLElement;
  private textEl: HTMLElement;

  /** Markers that have already been displayed since last reset. */
  private shown: Set<number> = new Set();

  /** Timer id for the auto-hide timeout. */
  private hideTimer: number = -1;

  /** The progress at which the currently-visible marker was triggered. */
  private activeMarkerProgress: number = -1;

  /** Current display state. */
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'scale-overlay';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');

    this.textEl = document.createElement('p');
    this.textEl.className = 'scale-overlay__text';
    this.el.appendChild(this.textEl);

    container.appendChild(this.el);
  }

  update(progress: number): void {
    // --- Backward scroll: un-show markers we've scrolled back past ---
    for (const shownProgress of Array.from(this.shown)) {
      if (progress < shownProgress - 0.005) {
        this.shown.delete(shownProgress);
        // If the active visible marker was un-shown, hide immediately
        if (shownProgress === this.activeMarkerProgress) {
          this.hideNow();
        }
      }
    }

    // --- Check if we've crossed a new marker threshold ---
    for (const marker of SCALE_MARKERS) {
      if (
        progress >= marker.progress &&
        !this.shown.has(marker.progress)
      ) {
        this.shown.add(marker.progress);
        this.showMarker(marker);
        // Only show one at a time — break after first new trigger
        break;
      }
    }
  }

  private showMarker(marker: ScaleMarker): void {
    // Clear any pending hide timer
    if (this.hideTimer >= 0) {
      clearTimeout(this.hideTimer);
      this.hideTimer = -1;
    }

    this.activeMarkerProgress = marker.progress;
    this.textEl.textContent = marker.text;

    // If already visible, force a quick re-entry animation by briefly removing class
    if (this.visible) {
      this.el.classList.remove('visible');
      // Small delay to allow transition to reset
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.el.classList.add('visible');
        });
      });
    } else {
      this.el.classList.add('visible');
      this.visible = true;
    }

    // Auto-hide after duration
    this.hideTimer = window.setTimeout(() => {
      this.hide();
    }, marker.duration * 1000);
  }

  private hide(): void {
    this.el.classList.remove('visible');
    this.visible = false;
    this.activeMarkerProgress = -1;
    this.hideTimer = -1;
  }

  private hideNow(): void {
    if (this.hideTimer >= 0) {
      clearTimeout(this.hideTimer);
      this.hideTimer = -1;
    }
    this.hide();
  }

  dispose(): void {
    if (this.hideTimer >= 0) clearTimeout(this.hideTimer);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
