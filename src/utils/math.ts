import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Core numeric helpers
// ---------------------------------------------------------------------------

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function remap(
  v: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
): number {
  const t = (v - inMin) / (inMax - inMin);
  return outMin + t * (outMax - outMin);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

export function inverseLerp(a: number, b: number, v: number): number {
  if (Math.abs(b - a) < 1e-10) return 0;
  return (v - a) / (b - a);
}

// ---------------------------------------------------------------------------
// Easing functions — all accept t in [0, 1] and return value in [0, 1]
// ---------------------------------------------------------------------------

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutExpo(t: number): number {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

// ---------------------------------------------------------------------------
// 3-D coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert spherical coordinates to a Cartesian THREE.Vector3.
 * @param r     radius
 * @param theta polar angle from +Y axis (inclination), radians
 * @param phi   azimuthal angle from +X axis in XZ plane, radians
 */
export function sphericalToCartesian(
  r: number,
  theta: number,
  phi: number,
): THREE.Vector3 {
  return new THREE.Vector3(
    r * Math.sin(theta) * Math.cos(phi),
    r * Math.cos(theta),
    r * Math.sin(theta) * Math.sin(phi),
  );
}

/**
 * Return a uniformly distributed random point inside a sphere of the given radius.
 * Uses the cube-rejection method for true uniform distribution.
 */
export function randomInSphere(radius: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  do {
    v.set(
      (Math.random() * 2 - 1) * radius,
      (Math.random() * 2 - 1) * radius,
      (Math.random() * 2 - 1) * radius,
    );
  } while (v.lengthSq() > radius * radius);
  return v;
}
