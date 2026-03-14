import * as THREE from 'three';

/**
 * Pre-allocated GPU-side particle field.
 *
 * Attributes exposed:
 *  - position   (vec3) — world-space position; update per frame via positionAttribute
 *  - aVelocity  (vec3) — velocity vector, accessible in vertex shaders
 *  - color      (vec3) — per-particle RGB colour
 *  - aSize      (float) — per-particle base size (point size multiplier)
 *
 * The caller is responsible for writing into the typed arrays and flagging
 * `.needsUpdate = true` each frame if the data changes.
 */
export class ParticleField {
  public points: THREE.Points;
  public positionAttribute: THREE.BufferAttribute;
  public velocityAttribute: THREE.BufferAttribute;
  public colorAttribute: THREE.BufferAttribute;
  public sizeAttribute: THREE.BufferAttribute;

  private geometry: THREE.BufferGeometry;

  constructor(
    count: number,
    material: THREE.ShaderMaterial | THREE.PointsMaterial,
  ) {
    this.geometry = new THREE.BufferGeometry();

    // Allocate backing typed arrays — all zeroed initially
    const positions  = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors     = new Float32Array(count * 3);
    const sizes      = new Float32Array(count);

    // Initialise sizes to 1.0 so particles are visible before the caller sets them
    sizes.fill(1.0);

    this.positionAttribute  = new THREE.BufferAttribute(positions,  3);
    this.velocityAttribute  = new THREE.BufferAttribute(velocities, 3);
    this.colorAttribute     = new THREE.BufferAttribute(colors,     3);
    this.sizeAttribute      = new THREE.BufferAttribute(sizes,      1);

    // Mark dynamic so the GPU driver can optimise buffer uploads
    this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
    this.velocityAttribute.setUsage(THREE.DynamicDrawUsage);
    this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttribute.setUsage(THREE.DynamicDrawUsage);

    this.geometry.setAttribute('position',  this.positionAttribute);
    this.geometry.setAttribute('aVelocity', this.velocityAttribute);
    this.geometry.setAttribute('color',     this.colorAttribute);
    this.geometry.setAttribute('aSize',     this.sizeAttribute);

    this.points = new THREE.Points(this.geometry, material);
    this.points.frustumCulled = false;
  }

  dispose(): void {
    this.geometry.dispose();
    // Material lifecycle is owned by the caller
  }
}
