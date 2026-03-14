export class LoadingScreen {
  private element: HTMLElement;
  private progressBar: HTMLElement;
  private progressTrack: HTMLElement;
  private label: HTMLElement;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'loading-screen';

    const inner = document.createElement('div');
    inner.className = 'loading-screen__inner';

    const title = document.createElement('h1');
    title.className = 'loading-screen__title';
    title.textContent = 'COSMIC TIMELINE';

    const subtitle = document.createElement('p');
    subtitle.className = 'loading-screen__subtitle';
    subtitle.textContent = '13.8 Billion Years';

    this.progressTrack = document.createElement('div');
    this.progressTrack.className = 'loading-screen__track';

    this.progressBar = document.createElement('div');
    this.progressBar.className = 'loading-screen__bar';
    this.progressBar.style.width = '0%';

    this.label = document.createElement('span');
    this.label.className = 'loading-screen__label';
    this.label.textContent = 'Initialising…';

    this.progressTrack.appendChild(this.progressBar);
    inner.appendChild(title);
    inner.appendChild(subtitle);
    inner.appendChild(this.progressTrack);
    inner.appendChild(this.label);
    this.element.appendChild(inner);

    document.body.appendChild(this.element);
  }

  setProgress(p: number): void {
    const pct = Math.round(Math.min(Math.max(p, 0), 1) * 100);
    this.progressBar.style.width = `${pct}%`;

    if (pct < 30) {
      this.label.textContent = 'Igniting the singularity…';
    } else if (pct < 60) {
      this.label.textContent = 'Expanding the cosmos…';
    } else if (pct < 90) {
      this.label.textContent = 'Forging the stars…';
    } else {
      this.label.textContent = 'Ready';
    }
  }

  /** Fade out and remove the loading screen. Returns a promise that resolves when done. */
  hide(): Promise<void> {
    return new Promise((resolve) => {
      this.element.style.transition = 'opacity 0.8s ease';
      this.element.style.opacity = '0';

      const onEnd = () => {
        this.element.removeEventListener('transitionend', onEnd);
        if (this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
        resolve();
      };

      this.element.addEventListener('transitionend', onEnd);

      // Safety timeout
      setTimeout(() => {
        onEnd();
      }, 1200);
    });
  }
}
