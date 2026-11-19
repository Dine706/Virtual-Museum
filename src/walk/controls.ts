// First-person walking: mouse look (pointer lock after the first click, or drag), WASD / ZQSD (by key
// position, so AZERTY works) or arrows, Shift to run; on touch: a joystick bottom-left, drag elsewhere to look.
// A short tap or click (without dragging) inspects what is under the pointer / crosshair.
import * as THREE from 'three';
import { t } from '../i18n';

export class WalkControls {
  yaw = 0; pitch = 0;
  readonly move = new THREE.Vector2(); // x right, y forward (−1..1)
  run = false;
  sensitivity = 1;
  paused = false;
  private jumpQueued = false;
  private padJump = false;
  private touchActions: HTMLDivElement;
  private keys = new Set<string>();
  private look: { id: number; x: number; y: number; sx: number; sy: number; t: number } | null = null;
  private stick: { id: number; cx: number; cy: number } | null = null;
  private stickEl: HTMLDivElement;
  private knob: HTMLDivElement;
  private off: (() => void)[] = [];
  locked = false;
  onInspect: (x: number, y: number) => void = () => {};
  onActivity: () => void = () => {};

  constructor(private el: HTMLElement, coarse: boolean) {
    this.stickEl = document.createElement('div');
    this.stickEl.className = 'walk-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'walk-knob';
    this.stickEl.append(this.knob);
    this.stickEl.hidden = !coarse;
    el.append(this.stickEl);
    this.stickEl.setAttribute('role', 'group');
    this.stickEl.setAttribute('aria-label', t('walk.controls.move'));
    this.touchActions = document.createElement('div');
    this.touchActions.className = 'walk-touch-actions';
    this.touchActions.hidden = !coarse;
    this.touchActions.innerHTML = `<button type="button" class="walk-btn walk-jump">${t('walk.controls.jump')}</button>`;
    this.touchActions.querySelector('button')!.addEventListener('click', () => { this.jumpQueued = true; this.onActivity(); });
    el.append(this.touchActions);

    const on = <K extends keyof HTMLElementEventMap>(t: HTMLElement | Document | Window, ev: K | string, fn: (e: never) => void, opt?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opt);
      this.off.push(() => t.removeEventListener(ev, fn as EventListener, opt));
    };

    on(el, 'pointerdown', (e: PointerEvent) => {
      this.onActivity();
      if (this.paused || (e.target as HTMLElement).closest('button, a, input, select, dialog, .walk-card')) return;
      if (e.pointerType !== 'mouse' && this.stickEl.contains(e.target as Node)) {
        const r = this.stickEl.getBoundingClientRect();
        this.stick = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
        this.updateStick(e.clientX, e.clientY);
      } else if (!this.locked) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() };
      }
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    on(el, 'pointermove', (e: PointerEvent) => {
      if (this.paused) return;
      if (this.locked && e.pointerType === 'mouse') {
        this.turn(e.movementX, e.movementY, 0.0022);
        return;
      }
      if (this.stick && e.pointerId === this.stick.id) { this.updateStick(e.clientX, e.clientY); return; }
      if (this.look && e.pointerId === this.look.id) {
        const k = e.pointerType === 'mouse' ? 0.0042 : 0.0058;
        this.turn(e.clientX - this.look.x, e.clientY - this.look.y, k);
        this.look.x = e.clientX; this.look.y = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) { this.stick = null; this.move.set(0, 0); this.knob.style.transform = ''; return; }
      if (this.locked && e.pointerType === 'mouse' && e.type === 'pointerup') {
        if (e.button === 0) this.onInspect(innerWidth / 2, innerHeight / 2);
        return;
      }
      if (this.look && e.pointerId === this.look.id) {
        const moved = Math.hypot(e.clientX - this.look.sx, e.clientY - this.look.sy);
        const quick = performance.now() - this.look.t < 450;
        this.look = null;
        if (e.type === 'pointerup' && moved < 8 && quick) {
          this.onInspect(e.clientX, e.clientY);
        }
      }
    };
    on(el, 'pointerup', end);
    on(el, 'pointercancel', end);
    on(el, 'dblclick', () => this.requestLock());
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === this.el; this.el.classList.toggle('locked', this.locked); });
    on(window, 'keydown', (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (this.paused || target.closest?.('input, textarea, select, dialog') || (target.closest?.('button') && ['Space', 'Enter'].includes(e.code))) return;
      this.keys.add(e.code);
      if (e.code === 'Space' && !e.repeat) this.jumpQueued = true;
      if (e.key === 'Shift') this.run = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.onActivity();
    });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); if (e.key === 'Shift') this.run = false; });
    on(window, 'blur', () => this.resetInput());
    on(document, 'visibilitychange', () => { if (document.hidden) this.resetInput(); });
  }

  resetInput() {
    this.keys.clear(); this.run = false; this.jumpQueued = false;
    this.stick = null; this.look = null; this.move.set(0, 0); this.knob.style.transform = '';
  }

  consumeJump() { const jump = this.jumpQueued; this.jumpQueued = false; return jump; }

  requestLock() {
    if (this.paused || matchMedia('(pointer: coarse)').matches) return;
    try { void (this.el.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* not allowed */ }
  }

  private turn(dx: number, dy: number, k: number) {
    this.yaw -= dx * k * this.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * k * this.sensitivity, -1.35, 1.35);
    this.onActivity();
  }

  private updateStick(x: number, y: number) {
    if (!this.stick) return;
    const R = 46;
    let dx = x - this.stick.cx, dy = y - this.stick.cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.move.set(dx / R, -dy / R);
    this.run = d > R * 0.95;
  }

  /** Keyboard → movement intent; arrows left/right turn. */
  poll(dt: number) {
    if (this.paused) { this.resetInput(); return false; }
    const k = this.keys;
    this.run = k.has('ShiftLeft') || k.has('ShiftRight') || !!this.stick && this.move.length() > 0.95;
    if (!this.stick) {
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      this.move.set(s, f);
      if (this.move.lengthSq() > 1) this.move.normalize();
    }
    const turn = (k.has('ArrowLeft') ? 1 : 0) - (k.has('ArrowRight') ? 1 : 0);
    if (turn) this.yaw += turn * dt * 1.6;
    const pad = navigator.getGamepads?.().find((p) => p?.connected && p.mapping === 'standard');
    if (pad) {
      const dead = (v: number) => Math.abs(v) < 0.16 ? 0 : Math.sign(v) * (Math.abs(v) - 0.16) / 0.84;
      this.move.x += dead(pad.axes[0] ?? 0); this.move.y -= dead(pad.axes[1] ?? 0);
      const lookX = dead(pad.axes[2] ?? 0), lookY = dead(pad.axes[3] ?? 0);
      if (lookX || lookY) this.turn(lookX * dt * 600, lookY * dt * 600, 0.0022);
      this.run ||= !!(pad.buttons[10]?.pressed || pad.buttons[4]?.pressed);
      const jump = pad.buttons[0]?.pressed ?? false;
      if (jump && !this.padJump) this.jumpQueued = true;
      this.padJump = jump;
    } else this.padJump = false;
    if (this.move.lengthSq() > 1) this.move.normalize();
    return this.move.lengthSq() > 0 || turn !== 0;
  }

  dispose() {
    this.off.forEach((f) => f());
    if (document.pointerLockElement === this.el) document.exitPointerLock();
    this.stickEl.remove();
    this.touchActions.remove();
  }
}
