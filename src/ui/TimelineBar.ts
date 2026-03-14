import { EraDefinition } from '../eras/EraRegistry';

export class TimelineBar {
  private element: HTMLElement;
  private progressFill: HTMLElement;
  private markers: HTMLElement[] = [];

  constructor(container: HTMLElement, eraCount: number, eras: EraDefinition[] = []) {
    this.element = document.createElement('div');
    this.element.className = 'timeline-bar';
    this.element.setAttribute('role', 'progressbar');
    this.element.setAttribute('aria-valuemin', '0');
    this.element.setAttribute('aria-valuemax', '100');
    this.element.setAttribute('aria-valuenow', '0');

    // Progress fill
    this.progressFill = document.createElement('div');
    this.progressFill.className = 'timeline-bar__progress';
    this.element.appendChild(this.progressFill);

    // Markers — positioned vertically
    for (let i = 0; i < eraCount; i++) {
      const pct = (i / (eraCount - 1)) * 100;
      const marker = document.createElement('div');
      marker.className = 'timeline-bar__marker';
      marker.style.top = `${pct}%`;

      const era = eras[i];
      if (era) {
        marker.setAttribute('aria-label', `Jump to ${era.name}`);
        marker.setAttribute('role', 'button');
        marker.setAttribute('tabindex', '0');

        // Tooltip
        const tooltip = document.createElement('span');
        tooltip.className = 'timeline-bar__tooltip';
        tooltip.textContent = era.name;
        marker.appendChild(tooltip);

        // Click handler: jump to era's scroll position
        const targetScroll = era.scrollStart * 60000;
        const onClick = () => {
          window.scrollTo({ top: targetScroll, behavior: 'smooth' });
        };
        marker.addEventListener('click', onClick);
        marker.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        });
      }

      this.element.appendChild(marker);
      this.markers.push(marker);
    }

    container.appendChild(this.element);

    // Show after a short delay
    setTimeout(() => this.element.classList.add('visible'), 2000);
  }

  update(progress: number, activeEra: number): void {
    const pct = Math.min(Math.max(progress * 100, 0), 100);
    this.progressFill.style.height = `${pct}%`;
    this.element.setAttribute('aria-valuenow', String(Math.round(pct)));

    this.markers.forEach((marker, idx) => {
      marker.classList.toggle('active', idx === activeEra);
    });
  }
}
