import * as THREE from 'three';
import { clamp, lerp } from './math';

// ---------------------------------------------------------------------------
// Era color palettes — each is an ordered array of THREE.Color stops
// ---------------------------------------------------------------------------

function c(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

const ERA_PALETTES: THREE.Color[][] = [
  // Era 1 — Big Bang: deep void → white flash → yellow → amber → crimson → dark ember
  [c(0x020108), c(0x0a0520), c(0xffffff), c(0xffee88), c(0xff9900), c(0xcc1111), c(0x330a00)],

  // Era 2 — Particle Soup: deep orange → magenta → violet → deep blue-purple
  [c(0xff4400), c(0xee00aa), c(0x8800cc), c(0x220055)],

  // Era 3 — CMB: deep blue → cyan → green → yellow → red
  [c(0x0000aa), c(0x00aacc), c(0x00bb44), c(0xddcc00), c(0xcc2200)],

  // Era 4 — Dark Ages: pure black → barely warm grey
  [c(0x000000), c(0x0a0806)],

  // Era 5 — First Stars: deep violet → blue-white → pink nebula → amber
  [c(0x1a0033), c(0xaaccff), c(0xff88cc), c(0xffaa44)],

  // Era 6 — Galaxy: warm amber → stellar white → blue-white
  [c(0xffcc55), c(0xffffff), c(0xaaccff)],

  // Era 7 — Solar System: solar yellow → disk amber → dust brown
  [c(0xffdd00), c(0xdd8833), c(0x7a5533)],

  // Era 8 — Earth: molten orange → dark crust → atmosphere brown → blue
  [c(0xff6600), c(0x1a0f00), c(0x664422), c(0x3377cc)],

  // Era 9 — Oceans: ocean blue → deep teal → vent orange → bio-cyan → bio-green
  [c(0x1155cc), c(0x006655), c(0xff6622), c(0x00ddcc), c(0x33bb44)],

  // Era 10 — Life: life green → earth blue → city yellow → final white
  [c(0x22aa44), c(0x2266cc), c(0xffee44), c(0xffffff)],
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Interpolate through an era's palette based on local progress [0, 1].
 */
export function getEraColor(eraIndex: number, progress: number): THREE.Color {
  const palette = ERA_PALETTES[clamp(eraIndex, 0, ERA_PALETTES.length - 1)];
  const t = clamp(progress, 0, 1);
  const scaledT = t * (palette.length - 1);
  const lo = Math.floor(scaledT);
  const hi = Math.min(lo + 1, palette.length - 1);
  const frac = scaledT - lo;

  const result = palette[lo].clone();
  result.lerp(palette[hi], frac);
  return result;
}

/**
 * Convert a blackbody temperature in Kelvin to an approximate RGB colour.
 * Valid range 1 000 K – 40 000 K, based on the Tanner Helland algorithm.
 */
export function temperatureToColor(temp: number): THREE.Color {
  const kelvin = clamp(temp, 1000, 40000);
  const t = kelvin / 100;

  let r: number, g: number, b: number;

  // Red channel
  if (t <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    r = clamp(r, 0, 255);
  }

  // Green channel
  if (t <= 66) {
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  g = clamp(g, 0, 255);

  // Blue channel
  if (t >= 66) {
    b = 255;
  } else if (t <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    b = clamp(b, 0, 255);
  }

  return new THREE.Color(
    lerp(0, 1, r / 255),
    lerp(0, 1, g / 255),
    lerp(0, 1, b / 255),
  );
}

/** Expose palettes for external use (e.g. particle colouring). */
export { ERA_PALETTES };
