import type { PoliceCommand, WantedPhase } from './police-types.ts';
export type Crime = 'shot' | 'damage' | 'explosion' | 'crash' | 'mission' | 'assault';
const HEAT: Record<Crime, number> = { shot: 6, damage: 10, explosion: 26, crash: 16, mission: 65, assault: 85 };
const INTERVAL: Record<Crime, number> = { shot: .25, damage: .5, explosion: .5, crash: 1, mission: 1, assault: .75 };
/** Active simulation time only; sightings and fresh crimes are the sole pursuit target sources. */
export class WantedState {
  enabled = true;
  eligible = true;
  private heat = 0;
  private clock = 0;
  private lastCrime = -Infinity;
  private unseen = 0;
  private shelter = 0;
  private phase: WantedPhase = 'quiet';
  private target: readonly [number, number, number] | null = null;
  private readonly reports = new Map<Crime, number>();
  get stars(): number { return this.heat >= 110 ? 3 : this.heat >= 65 ? 2 : this.heat >= 20 ? 1 : 0; }
  get active(): boolean { return this.enabled && this.eligible; }
  get command(): PoliceCommand { return { stars: this.stars, phase: this.phase, target: this.target }; }
  get diagnostics() { return { ...this.command, enabled: this.enabled, eligible: this.eligible, heat: this.heat,
    unseen: this.unseen, shelter: this.shelter, remaining: this.shelter > 0 ? Math.max(0, 3 - this.shelter) : Math.max(0, this.escapeTime - this.unseen), clock: this.clock }; }
  private get escapeTime(): number { return 10 + this.stars * 4; }
  setEnabled(value: boolean): void { this.enabled = value; if (!value) this.reset(); }
  setEligible(value: boolean): void { this.eligible = value; if (!value) this.reset(); }
  report(kind: Crime, at: readonly [number, number, number]): boolean {
    if (!this.active || !at.every(Number.isFinite) || this.clock - (this.reports.get(kind) ?? -Infinity) < INTERVAL[kind]) return false;
    this.reports.set(kind, this.clock); this.heat = Math.min(130, this.heat + HEAT[kind]);
    this.lastCrime = this.clock; this.unseen = this.shelter = 0;
    if (this.stars) { this.phase = 'chase'; this.target = [...at]; }
    return true;
  }
  update(dt: number, frame: { seen: boolean; safe: boolean; position: readonly [number, number, number] }): void {
    if (!Number.isFinite(dt) || dt <= 0 || !this.active || !frame.position.every(Number.isFinite)) return;
    this.clock += Math.min(dt, .25);
    if (!this.stars) { if (this.clock - this.lastCrime > 7) this.heat = 0; return; }
    if (frame.safe) {
      this.shelter += Math.min(dt, .25); this.phase = 'search';
      if (this.shelter >= 3) this.reset();
      return;
    }
    this.shelter = 0;
    if (frame.seen) { this.target = [...frame.position]; this.phase = 'chase'; this.unseen = 0; }
    else {
      this.phase = 'search';
      if (this.clock - this.lastCrime >= 7) this.unseen += Math.min(dt, .25);
      if (this.unseen >= this.escapeTime) this.reset();
    }
  }
  reset(): void { this.heat = this.unseen = this.shelter = 0; this.phase = 'quiet'; this.target = null; this.lastCrime = -Infinity; this.reports.clear(); }
}
