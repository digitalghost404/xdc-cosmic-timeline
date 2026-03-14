export class CinemaMode {
  private active: boolean = false;
  private boundKeydown: (e: KeyboardEvent) => void;

  constructor() {
    this.boundKeydown = (e: KeyboardEvent) => {
      // Never trigger while the user is typing in a form field
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'f' || e.key === 'F') {
        this.toggle();
      }

      if (e.key === 'Escape' && this.active) {
        // Note: browsers fire Escape to exit native fullscreen automatically,
        // but the fullscreenchange event will *not* call our toggle — we sync
        // in the fullscreenchange listener below. For the body class removal
        // we handle it there. This branch is a fallback for non-fullscreen use.
        this.deactivate();
      }
    };

    window.addEventListener('keydown', this.boundKeydown);

    // Keep our state in sync when the browser exits fullscreen on its own
    // (e.g. the user presses Escape in a browser that handles it natively).
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && this.active) {
        this.active = false;
        document.body.classList.remove('cinema-mode');
      }
    });
  }

  toggle(): void {
    if (this.active) {
      this.deactivate();
    } else {
      this.activate();
    }
  }

  private activate(): void {
    this.active = true;
    document.documentElement.requestFullscreen?.().catch(() => {});
    document.body.classList.add('cinema-mode');
    this.showHint();
  }

  private deactivate(): void {
    this.active = false;
    document.body.classList.remove('cinema-mode');
    // Only call exitFullscreen when we're still in fullscreen; calling it
    // outside of fullscreen throws a DOMException in some browsers.
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  private showHint(): void {
    // Remove any lingering hint from a previous toggle
    const existing = document.getElementById('cinema-hint');
    if (existing) existing.remove();

    const hint = document.createElement('div');
    hint.id = 'cinema-hint';
    hint.className = 'cinema-hint';
    hint.textContent = 'CINEMA MODE — Press ESC to exit';
    hint.setAttribute('aria-live', 'polite');
    hint.setAttribute('role', 'status');
    document.body.appendChild(hint);

    // Remove from DOM after the CSS animation completes (3 s)
    hint.addEventListener('animationend', () => hint.remove(), { once: true });
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.boundKeydown);
    if (this.active) {
      this.deactivate();
    }
  }
}
