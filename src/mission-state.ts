/** Challenge rules, independent of the renderer and DOM. State 0 is a fixed voxel. */
export type MissionMode = 'sandbox' | 'challenge';
export type MissionPhase = 'ready' | 'running' | 'won' | 'lost';

export interface MissionSnapshot {
  mode: MissionMode;
  phase: MissionPhase;
  remaining: number;
  duration: number;
  count: number;
  target: number;
  progress: number;
}

export class MissionState {
  readonly duration = 90;
  readonly target = 1800;
  private mode: MissionMode = 'sandbox';
  private phase: MissionPhase = 'ready';
  private remaining = this.duration;
  private count = 0;
  private baseline = new Uint8Array(0);
  private counted = new Uint8Array(0);

  reset(states: Uint8Array): void {
    this.baseline = states.slice();
    this.clear();
  }

  setMode(mode: MissionMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.clear();
  }

  private clear(): void {
    this.phase = 'ready';
    this.remaining = this.duration;
    this.count = 0;
    this.counted = new Uint8Array(this.baseline.length);
  }

  start(): void {
    if (this.mode === 'challenge' && this.phase === 'ready') this.phase = 'running';
  }

  /** Scan may be throttled by the UI, but always scan the final timed update. */
  update(dt: number, active: boolean, states: Uint8Array, scan = true): void {
    if (!active || (this.mode === 'challenge' && this.phase !== 'running')) return;
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (scan || elapsed >= this.remaining) {
      for (let i = 0, n = Math.min(states.length, this.baseline.length); i < n; i++) {
        if (this.baseline[i] === 0 && states[i] !== 0 && this.counted[i] === 0) {
          this.counted[i] = 1;
          this.count++;
        }
      }
    }
    if (this.mode === 'sandbox') return;
    this.remaining = Math.max(0, this.remaining - elapsed);
    // Ranked rounds always last 90 active seconds; the target is a milestone, not an early exit.
    if (this.remaining === 0) this.phase = this.count >= this.target ? 'won' : 'lost';
  }

  get snapshot(): MissionSnapshot {
    return {
      mode: this.mode, phase: this.phase, remaining: this.remaining,
      duration: this.duration, count: this.count, target: this.target,
      progress: Math.min(1, this.count / this.target),
    };
  }
}
