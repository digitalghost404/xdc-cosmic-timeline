import * as THREE from 'three';

/**
 * A screen-aligned quad for post-processing / fullscreen shaders.
 * Uses a PlaneGeometry(2, 2) placed at z = -1; the caller is responsible
 * for rendering it with an orthographic camera or as part of a composer pass.
 */
export class FullscreenQuad {
  public mesh: THREE.Mesh;
  private geometry: THREE.PlaneGeometry;

  constructor(material: THREE.ShaderMaterial) {
    this.geometry = new THREE.PlaneGeometry(2, 2);

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.position.z = -1;
    this.mesh.frustumCulled = false;
  }

  dispose(): void {
    this.geometry.dispose();
    // Caller owns the material lifecycle
  }
}
