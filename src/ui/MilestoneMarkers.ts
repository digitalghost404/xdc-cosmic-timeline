// MilestoneMarkers — small floating labels near the bottom-left that flash
// briefly at key cosmological moments. Much subtler than ScaleOverlay.

interface Milestone {
  progress: number;
  text: string;
  /** Whether this milestone gets the special "You are here" treatment. */
  special?: boolean;
}

const MILESTONES: Milestone[] = [
  { progress: 0.03,  text: 'Quarks form'                         },
  { progress: 0.06,  text: 'Protons & neutrons emerge'           },
  { progress: 0.12,  text: 'First hydrogen atoms'                },
  { progress: 0.14,  text: 'Helium nuclei fuse'                  },
  { progress: 0.19,  text: 'First molecules form'                },
  { progress: 0.22,  text: 'Photons decouple from matter'        },
  { progress: 0.36,  text: 'First star ignites'                  },
  { progress: 0.45,  text: 'First galaxies form'                 },
  { progress: 0.56,  text: 'Solar nebula collapses'              },
  { progress: 0.62,  text: 'Jupiter forms'                       },
  { progress: 0.68,  text: 'Earth accretes'                      },
  { progress: 0.72,  text: 'Theia impact — Moon forms'           },
  { progress: 0.78,  text: 'First liquid water'                  },
  { progress: 0.82,  text: 'First self-replicating molecule'     },
  { progress: 0.85,  text: 'First cell — LUCA'                   },
  { progress: 0.90,  text: 'Cambrian explosion'                  },
  { progress: 0.93,  text: 'Dinosaurs rule for 165 million years'},
  { progress: 0.97,  text: 'Homo sapiens — 300,000 years ago'    },
  { progress: 0.995, text: 'You are here', special: true         },
];

/** Display duration for normal milestones (ms). */
const NORMAL_DURATION_MS = 2200;
/** Display duration for the special "You are here" milestone (ms). */
const SPECIAL_DURATION_MS = 6000;

export class MilestoneMarkers {
  private el: HTMLElement;
  private textEl: HTMLElement;

  private shown: Set<number> = new Set();
  private hideTimer: number = -1;
  private visible: boolean = false;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'milestone';
    this.el.setAttribute('aria-live', 'polite');
    this.el.setAttribute('aria-atomic', 'true');

    this.textEl = document.createElement('span');
    this.textEl.className = 'milestone__text';
    this.el.appendChild(this.textEl);

    container.appendChild(this.el);
  }

  update(progress: number): void {
    // Backward scroll: un-show milestones we've scrolled back past
    for (const shownP of Array.from(this.shown)) {
      if (progress < shownP - 0.003) {
        this.shown.delete(shownP);
      }
    }

    // Check for newly crossed milestones (scan in ascending order)
    for (const milestone of MILESTONES) {
      if (progress >= milestone.progress && !this.shown.has(milestone.progress)) {
        this.shown.add(milestone.progress);
        this.showMilestone(milestone);
        break;
      }
    }
  }

  private showMilestone(milestone: Milestone): void {
    if (this.hideTimer >= 0) {
      clearTimeout(this.hideTimer);
      this.hideTimer = -1;
    }

    this.textEl.textContent = milestone.text;

    if (milestone.special) {
      this.el.classList.add('milestone--special');
    } else {
      this.el.classList.remove('milestone--special');
    }

    if (this.visible) {
      // Quick flicker to reset transition
      this.el.classList.remove('visible');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.el.classList.add('visible');
        });
      });
    } else {
      this.el.classList.add('visible');
      this.visible = true;
    }

    const duration = milestone.special ? SPECIAL_DURATION_MS : NORMAL_DURATION_MS;
    this.hideTimer = window.setTimeout(() => {
      this.hide();
    }, duration);
  }

  private hide(): void {
    this.el.classList.remove('visible');
    this.visible = false;
    this.hideTimer = -1;
  }

  dispose(): void {
    if (this.hideTimer >= 0) clearTimeout(this.hideTimer);
    if (this.el.parentNode) this.el.parentNode.removeChild(this.el);
  }
}
