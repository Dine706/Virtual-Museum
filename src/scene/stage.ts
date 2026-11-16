// Renderer, scene, camera, controls and a render-on-demand loop:
// no input, no animation → no frames (phone battery, CLAUDE.md §6.10).
import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createControls } from './camera';
import type { TierSpec } from './tier';

/** Called every frame; return true while it still needs frames. */
export type Animator = (dt: number, now: number) => boolean;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private dirty = true;
  private animators = new Set<Animator>();
  private afterRender = new Set<() => void>();
  private beforeRender = new Set<() => void>();
  private last = performance.now();
  frames = 0;
  /** Number of frames actually rendered in the last second (debug meter). */
  fps = 0;
  private fpsCount = 0;
  private fpsStart = performance.now();

  constructor(readonly canvas: HTMLCanvasElement, public tier: TierSpec) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: tier.antialias, powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(45, 1, 40, 160000);
    this.controls = createControls(this.camera, canvas);
    this.controls.addEventListener('change', () => this.invalidate());
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.tier.dprCap));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Keep ≥ ~50° horizontal field of view on portrait phones.
    const hHalf = 25 * Math.PI / 180;
    const vFov = 2 * Math.atan(Math.tan(hHalf) / aspect) * 180 / Math.PI;
    this.camera.fov = THREE.MathUtils.clamp(vFov, 40, 68);
    this.camera.updateProjectionMatrix();
    if (this.shift) this.applyShift();
    this.invalidate();
  }

  // Projection-centre shift (px) so the target sits in the part of the canvas not covered by the panel.
  private shift = { x: 0, y: 0 };
  private shiftTarget = { x: 0, y: 0 };
  private shiftAnimating = false;

  /** Panel covers `right` px on the right / `bottom` px at the bottom: centre the view in what is left. */
  setViewInset(right: number, bottom: number, instant = false) {
    this.shiftTarget = { x: right / 2, y: bottom / 2 };
    if (instant) { this.shift = { ...this.shiftTarget }; this.applyShift(); this.invalidate(); return; }
    if (this.shiftAnimating) return;
    this.shiftAnimating = true;
    this.addAnimator((dt) => {
      const k = 1 - Math.exp(-dt * 9);
      this.shift.x += (this.shiftTarget.x - this.shift.x) * k;
      this.shift.y += (this.shiftTarget.y - this.shift.y) * k;
      const done = Math.abs(this.shiftTarget.x - this.shift.x) < 0.5 && Math.abs(this.shiftTarget.y - this.shift.y) < 0.5;
      if (done) this.shift = { ...this.shiftTarget };
      this.applyShift();
      this.shiftAnimating = !done;
      return !done;
    });
  }

  private applyShift() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (Math.abs(this.shift.x) < 0.5 && Math.abs(this.shift.y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, this.shift.x, this.shift.y, w, h);
  }

  invalidate() { this.dirty = true; }
  addAnimator(a: Animator) { this.animators.add(a); this.invalidate(); return () => this.animators.delete(a); }
  onBeforeRender(fn: () => void) { this.beforeRender.add(fn); }
  onAfterRender(fn: () => void) { this.afterRender.add(fn); }

  start() {
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.controls.enabled && this.controls.update(dt)) this.dirty = true;
      for (const a of this.animators) {
        if (a(dt, now)) this.dirty = true; else this.animators.delete(a), (this.dirty = true);
      }
      if (!this.dirty) {
        if (now - this.fpsStart > 1500) { this.fps = 0; this.fpsCount = 0; this.fpsStart = now; }
        return;
      }
      this.dirty = false;
      this.beforeRender.forEach((f) => f());
      this.renderer.render(this.scene, this.camera);
      this.frames++;
      this.fpsCount++;
      if (now - this.fpsStart >= 1000) { this.fps = this.fpsCount * 1000 / (now - this.fpsStart); this.fpsCount = 0; this.fpsStart = now; }
      this.afterRender.forEach((f) => f());
    };
    requestAnimationFrame(loop);
  }
}
