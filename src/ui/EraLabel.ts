export class EraLabel {
  private element: HTMLElement;
  private timeEl: HTMLElement;
  private nameEl: HTMLElement;
  private factEl: HTMLElement;
  private currentEra: string = '';

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'era-footer';
    this.element.setAttribute('aria-live', 'polite');
    this.element.setAttribute('aria-atomic', 'true');

    const inner = document.createElement('div');
    inner.className = 'era-footer__inner';

    this.timeEl = document.createElement('span');
    this.timeEl.className = 'era-footer__time';

    this.nameEl = document.createElement('h2');
    this.nameEl.className = 'era-footer__name';

    this.factEl = document.createElement('p');
    this.factEl.className = 'era-footer__fact';

    inner.appendChild(this.timeEl);
    inner.appendChild(this.nameEl);
    inner.appendChild(this.factEl);
    this.element.appendChild(inner);
    container.appendChild(this.element);
  }

  update(eraName: string, eraTime: string, eraFact: string, _progress: number, hide: boolean = false): void {
    // Hide the footer entirely during pre-detonation
    this.element.style.opacity = hide ? '0' : '1';
    this.element.style.transition = 'opacity 0.8s ease';

    if (eraName !== this.currentEra) {
      this.currentEra = eraName;
      this.timeEl.textContent = eraTime;
      this.nameEl.textContent = eraName;
      this.factEl.textContent = eraFact;

      // Brief text crossfade on era change
      this.element.classList.remove('era-footer--entering');
      void this.element.offsetWidth; // force reflow
      this.element.classList.add('era-footer--entering');
    }
  }
}
