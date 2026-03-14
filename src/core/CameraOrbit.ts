import * as THREE from 'three';

/**
 * CameraOrbit — lets the user drag-to-orbit around the cinematic camera's
 * look target.  When the user releases the mouse the accumulated spherical
 * offset lerps back to zero so the cinematic path resumes seamlessly.
 */
export class CameraOrbit {
  // Accumulated spherical angle offset (radians)
  private theta: number = 0; // horizontal (yaw)
  private phi: number = 0;   // vertical   (pitch)

  // Mouse state
  private isDragging: boolean = false;
  private lastMouse: { x: number; y: number } = { x: 0, y: 0 };

  // How fast the offset returns to zero when not dragging
  private readonly returnSpeed: number = 0.03;

  // Sensitivity — radians per pixel
  private readonly sensitivity: number = 0.005;

  // Clamp phi so users cannot flip the camera upside-down
  private readonly phiMax: number = Math.PI * 0.45;

  private enabled: boolean = true;
  private canvas: HTMLCanvasElement;

  // Bound handlers kept for disposal
  private onMouseDown: (e: MouseEvent) => void;
  private onMouseMove: (e: MouseEvent) => void;
  private onMouseUp: () => void;
  private onTouchStart: (e: TouchEvent) => void;
  private onTouchMove: (e: TouchEvent) => void;
  private onTouchEnd: () => void;

  // Reusable objects to avoid per-frame allocations
  private _qH = new THREE.Quaternion();
  private _qV = new THREE.Quaternion();
  private _axisY = new THREE.Vector3(0, 1, 0);
  private _axisX = new THREE.Vector3(1, 0, 0);
  private _offset = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    // ---- Mouse ----
    this.onMouseDown = (e: MouseEvent) => {
      if (!this.enabled) return;
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      // Prevent text selection while dragging
      e.preventDefault();
    };

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging || !this.enabled) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };

      this.theta -= dx * this.sensitivity;
      this.phi -= dy * this.sensitivity;
      this.phi = Math.max(-this.phiMax, Math.min(this.phiMax, this.phi));
    };

    this.onMouseUp = () => {
      this.isDragging = false;
    };

    // ---- Touch ----
    this.onTouchStart = (e: TouchEvent) => {
      if (!this.enabled || e.touches.length !== 1) return;
      this.isDragging = true;
      this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    this.onTouchMove = (e: TouchEvent) => {
      if (!this.isDragging || !this.enabled || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - this.lastMouse.x;
      const dy = e.touches[0].clientY - this.lastMouse.y;
      this.lastMouse = { x: e.touches[0].clientX, y: e.touches[0].clientY };

      this.theta -= dx * this.sensitivity;
      this.phi -= dy * this.sensitivity;
      this.phi = Math.max(-this.phiMax, Math.min(this.phiMax, this.phi));
    };

    this.onTouchEnd = () => {
      this.isDragging = false;
    };

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);

    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: true });
    window.addEventListener('touchend', this.onTouchEnd, { passive: true });
  }

  /**
   * Call every frame with the frame delta.  Lerps the orbit offset back to
   * zero when the user is not dragging.
   */
  update(delta: number): void {
    if (!this.isDragging) {
      const t = Math.min(1, this.returnSpeed * (delta / 0.016));
      this.theta *= 1 - t;
      this.phi *= 1 - t;

      // Snap to zero to avoid perpetual tiny drift
      if (Math.abs(this.theta) < 0.0001) this.theta = 0;
      if (Math.abs(this.phi) < 0.0001) this.phi = 0;
    }
  }

  /**
   * Rotates the camera around `lookTarget` by the accumulated (theta, phi)
   * offset.  The cinematic era code has already set camera.position before
   * this is called; we layer the orbit on top.
   */
  apply(camera: THREE.PerspectiveCamera, lookTarget: THREE.Vector3): void {
    if (this.theta === 0 && this.phi === 0) return;

    // Compute the offset from the look-target
    this._offset.copy(camera.position).sub(lookTarget);

    // Build rotation quaternions around world-Y and camera's local-X
    this._qH.setFromAxisAngle(this._axisY, this.theta);
    this._axisX.set(1, 0, 0).applyQuaternion(camera.quaternion);
    this._qV.setFromAxisAngle(this._axisX, this.phi);

    // Apply rotations to offset
    this._offset.applyQuaternion(this._qH).applyQuaternion(this._qV);

    camera.position.copy(lookTarget).add(this._offset);
    camera.lookAt(lookTarget);
  }

  isUserDragging(): boolean {
    return this.isDragging;
  }

  /** Whether the orbit has any non-trivial offset applied. */
  hasOffset(): boolean {
    return this.theta !== 0 || this.phi !== 0;
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);

    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    window.removeEventListener('touchmove', this.onTouchMove);
    window.removeEventListener('touchend', this.onTouchEnd);
  }
}
