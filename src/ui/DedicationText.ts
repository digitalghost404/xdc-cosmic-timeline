// DedicationText — the final emotional moment of the experience.
// Fades in at the very end of the timeline.

const SHOW_THRESHOLD  = 0.997;
const HIDE_THRESHOLD  = 0.990;

export class DedicationText {
  private el: HTMLElement;
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dedication';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');

    // Two lines: the main dedication and a subtle sub-line
    this.el.innerHTML = `
      <p class="dedication__text">13.8 billion years.</p>
      <p class="dedication__text dedication__text--sub">And here you are.</p>
    `;

    container.appendChild(this.el);
  }

  update(progress: number): void {
    if (progress > SHOW_THRESHOLD && !this.visible) {
      this.el.classList.add('visible');
      this.visible = true;
    } else if (progress < HIDE_THRESHOLD && this.visible) {
      this.el.classList.remove('visible');
      this.visible = false;
    }
  }

  dispose(): void {
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
