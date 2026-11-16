// FPS watchdog (CLAUDE.md §7): measure ≈ 2 s of *continuous* rendering (title-card drift, flyover, a drag)
// and step the quality tier down while the frame rate stays below 28 fps. Only frames that follow another
// rendered frame count (the stage reports this), so render-on-demand idle gaps never look "slow" – but a GPU
// so slow that every frame takes > 250 ms is still measured.
export const TARGET_FPS = 28;
const WINDOW_MS = 2000;
const SETTLE_MS = 600; // after a step-down, let shaders compile and the GPU settle before measuring again

export interface WatchdogReport { fps: number; stepped: boolean }

export class FpsWatchdog {
  private total = 0;
  private frames = 0;
  private settleUntil = 0;
  done = false;
  readonly history: WatchdogReport[] = [];

  /** `stepDown` returns false when there is no lower tier left. */
  constructor(private stepDown: () => boolean) {}

  frame(now: number, dt: number, continuous: boolean) {
    if (this.done) return;
    // Skip: first frame after an idle gap, settling after a step-down, or a stall such as a hidden tab.
    if (!continuous || now < this.settleUntil || dt <= 0 || dt > 3000) return;
    this.total += dt;
    this.frames++;
    if (this.total < WINDOW_MS) return;
    const fps = (this.frames * 1000) / this.total;
    this.total = 0;
    this.frames = 0;
    if (fps >= TARGET_FPS) { this.history.push({ fps, stepped: false }); this.done = true; return; }
    const stepped = this.stepDown();
    this.history.push({ fps, stepped });
    if (!stepped) this.done = true;
    else this.settleUntil = now + SETTLE_MS;
  }
}
