export const CAPACITY = 30;
export const RELOAD_SECONDS = 1.8;

/** The rifle owns ammunition and reload timing; weapon cooldown and eligibility belong to the game loop. */
export class RifleMagazine {
  private remaining = CAPACITY;
  private loading = false;
  private elapsed = 0;

  get rounds(): number { return this.remaining; }
  get reloading(): boolean { return this.loading; }
  /** Idle is zero; an active reload advances towards one, then the refilled magazine becomes idle. */
  get reloadProgress(): number { return this.loading ? Math.min(1, this.elapsed / RELOAD_SECONDS) : 0; }

  /** The final round is fired successfully even though it immediately starts the next reload. */
  fire(): boolean {
    if (this.loading || this.remaining === 0) return false;
    this.remaining--;
    if (this.remaining === 0) this.reload();
    return true;
  }

  reload(): boolean {
    if (this.loading || this.remaining === CAPACITY) return false;
    this.loading = true;
    this.elapsed = 0;
    return true;
  }

  update(dt: number, active = true): void {
    if (!active || !this.loading || !Number.isFinite(dt) || dt <= 0) return;
    this.elapsed += dt;
    // Summed frame deltas can be a few ulps below 1.8 seconds at the exact final frame.
    if (this.elapsed + 1e-9 < RELOAD_SECONDS) return;
    this.remaining = CAPACITY;
    this.loading = false;
    this.elapsed = 0;
  }

  reset(): void {
    this.remaining = CAPACITY;
    this.loading = false;
    this.elapsed = 0;
  }

  get diagnostics(): Readonly<{ rounds: number; capacity: number; reloading: boolean; reloadProgress: number; reloadSeconds: number }> {
    return { rounds: this.rounds, capacity: CAPACITY, reloading: this.reloading,
      reloadProgress: this.reloadProgress, reloadSeconds: RELOAD_SECONDS };
  }
}
