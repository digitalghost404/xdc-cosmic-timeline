// CosmicHUD — top-left readout for temperature, density, and cosmic age.
// Values are keyframed to real cosmological data and interpolated logarithmically.

export interface CosmicState {
  temperature: string; // e.g. "10^32 K", "3,000 K", "2.7 K"
  density: string;     // e.g. "10^93 g/cm³", "10^-30 g/cm³"
  age: string;         // e.g. "10^-43 seconds", "380,000 years", "13.8 billion years"
}

// ---------------------------------------------------------------------------
// Keyframes — progress → [log10(T), log10(ρ), ageLabel]
// T in Kelvin, ρ in g/cm³
// ---------------------------------------------------------------------------

interface Keyframe {
  progress: number;
  logT: number;      // log10(temperature in K)
  logRho: number;    // log10(density in g/cm³)
  age: string;       // pre-formatted age string
}

const KEYFRAMES: Keyframe[] = [
  { progress: 0.00, logT: 32,  logRho:  93, age: '10<sup>-43</sup> seconds' },
  { progress: 0.04, logT: 12,  logRho:  14, age: '10<sup>-6</sup> seconds'  },
  { progress: 0.08, logT: 10,  logRho:   4, age: '1 second'                 },
  { progress: 0.16, logT:  9,  logRho:   1, age: '3 minutes'                },
  { progress: 0.20, logT:  3.477, logRho: -21, age: '380,000 years'         }, // log10(3000)≈3.477
  { progress: 0.33, logT:  1.778, logRho: -27, age: '150 million years'     }, // log10(60)≈1.778
  { progress: 0.43, logT:  1.301, logRho: -28, age: '800 million years'     }, // log10(20)≈1.301
  { progress: 0.55, logT:  1.0,   logRho: -29, age: '5 billion years'       }, // log10(10)=1
  { progress: 0.67, logT:  0.602, logRho: -30, age: '9.2 billion years'     }, // log10(4)≈0.602
  { progress: 0.89, logT:  0.447, logRho: -30, age: '10 billion years'      }, // log10(2.8)≈0.447
  { progress: 1.00, logT:  0.435, logRho: -30, age: '13.8 billion years'    }, // log10(2.725)≈0.435
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lerpVal(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Format a log10 value as an HTML string with superscript exponents. */
function formatLog(log10Val: number): string {
  // Reconstruct actual value from log
  const actualVal = Math.pow(10, log10Val);

  // If value is reasonably representable as a plain number (between 0.01 and 9999)
  if (actualVal >= 0.01 && actualVal < 10000) {
    // Format to 3 significant figures
    const s = actualVal.toPrecision(3);
    // Strip trailing zeros after decimal point
    const n = parseFloat(s);
    if (Number.isInteger(n)) {
      return n.toLocaleString('en-US');
    }
    return n.toLocaleString('en-US', { maximumSignificantDigits: 3 });
  }

  // Scientific notation: compute mantissa and exponent
  const exp = Math.floor(log10Val);
  const mantissa = Math.pow(10, log10Val - exp);

  if (Math.abs(mantissa - 1) < 0.05) {
    // e.g. 10^32 — just show the power
    if (exp < 0) {
      return `10<sup>${exp}</sup>`;
    }
    return `10<sup>${exp}</sup>`;
  }

  const mStr = mantissa.toPrecision(2);
  if (exp < 0) {
    return `${mStr}×10<sup>${exp}</sup>`;
  }
  return `${mStr}×10<sup>${exp}</sup>`;
}

/** Sample KEYFRAMES array at a given global progress, log-interpolating T and ρ. */
function sampleKeyframes(progress: number): CosmicState {
  // Clamp
  const p = Math.max(0, Math.min(1, progress));

  // Find surrounding keyframes
  if (p <= KEYFRAMES[0].progress) {
    const kf = KEYFRAMES[0];
    return {
      temperature: formatLog(kf.logT) + ' K',
      density:     formatLog(kf.logRho) + ' g/cm³',
      age:         kf.age,
    };
  }

  const last = KEYFRAMES[KEYFRAMES.length - 1];
  if (p >= last.progress) {
    return {
      temperature: formatLog(last.logT) + ' K',
      density:     formatLog(last.logRho) + ' g/cm³',
      age:         last.age,
    };
  }

  let lo = KEYFRAMES[0];
  let hi = KEYFRAMES[1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (p >= KEYFRAMES[i].progress && p < KEYFRAMES[i + 1].progress) {
      lo = KEYFRAMES[i];
      hi = KEYFRAMES[i + 1];
      break;
    }
  }

  const span = hi.progress - lo.progress;
  const t = span > 0 ? (p - lo.progress) / span : 0;

  const logT   = lerpVal(lo.logT,   hi.logT,   t);
  const logRho = lerpVal(lo.logRho, hi.logRho, t);

  // For age, use the hi keyframe label once we pass the midpoint
  const age = t < 0.5 ? lo.age : hi.age;

  return {
    temperature: formatLog(logT) + ' K',
    density:     formatLog(logRho) + ' g/cm³',
    age,
  };
}

// ---------------------------------------------------------------------------
// CosmicHUD class
// ---------------------------------------------------------------------------

export class CosmicHUD {
  private el: HTMLElement;
  private tempValue!:    HTMLElement;
  private densityValue!: HTMLElement;
  private ageValue!:     HTMLElement;

  private lastState: CosmicState | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'cosmic-hud';
    this.el.setAttribute('aria-label', 'Cosmic conditions readout');
    this.el.setAttribute('aria-live', 'off');

    this.el.innerHTML = `
      <div class="cosmic-hud__row">
        <span class="cosmic-hud__label">Temp</span>
        <span class="cosmic-hud__value" id="hud-temp">—</span>
      </div>
      <div class="cosmic-hud__row">
        <span class="cosmic-hud__label">Density</span>
        <span class="cosmic-hud__value" id="hud-density">—</span>
      </div>
      <div class="cosmic-hud__row">
        <span class="cosmic-hud__label">Age</span>
        <span class="cosmic-hud__value" id="hud-age">—</span>
      </div>
    `;

    container.appendChild(this.el);

    this.tempValue    = this.el.querySelector('#hud-temp')    as HTMLElement;
    this.densityValue = this.el.querySelector('#hud-density') as HTMLElement;
    this.ageValue     = this.el.querySelector('#hud-age')     as HTMLElement;
  }

  update(progress: number): void {
    const state = sampleKeyframes(progress);

    // Only re-render when values actually change (avoid unnecessary reflows)
    if (
      this.lastState &&
      this.lastState.temperature === state.temperature &&
      this.lastState.density     === state.density     &&
      this.lastState.age         === state.age
    ) {
      return;
    }

    this.tempValue.innerHTML    = state.temperature;
    this.densityValue.innerHTML = state.density;
    this.ageValue.innerHTML     = state.age;

    this.lastState = state;
  }

  dispose(): void {
    if (this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  }
}
