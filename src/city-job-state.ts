export type CityJobId = 'tour' | 'delivery' | 'cleanup';
export const CITY_JOBS: readonly { id: CityJobId; name: string; description: string }[] = [
  { id: 'tour', name: '绕街兜风', description: '开车依次经过三个路口，熟悉这座小城。' },
  { id: 'delivery', name: '公园快递', description: '下车取包裹，再送到南边的棕榈公园。' },
  { id: 'cleanup', name: '街角清理', description: '拆掉标记区里的街边物件，腾出一块空地。' },
];
export const TOUR_STOPS: readonly (readonly [number, number])[] = [[-23, 23], [23, 23], [23, -23]];
export const PARCEL_PICKUP = [-13, -12] as const;
export const PARCEL_DROP = [0, -42] as const;
export const CLEANUP_ZONE = [-12, -13.6] as const;
export interface JobFrame { x: number; y: number; z: number; driving: boolean; flying?: boolean; demolished: number }

/** Task badges are separate from voxel scores and can only be earned once per job. */
export class CityJobState {
  active: CityJobId | null = null;
  stage = 0;
  progress = 0;
  complete = false;
  readonly badges = new Set<CityJobId>();
  private cleanupStart = 0;
  private cleanupTarget = 120;

  constructor(saved: readonly string[] = []) {
    for (const id of saved) if (CITY_JOBS.some((job) => job.id === id)) this.badges.add(id as CityJobId);
  }
  start(id: CityJobId, demolished: number, remaining: number): boolean {
    if (!CITY_JOBS.some((job) => job.id === id) || (id === 'cleanup' && remaining <= 0)) return false;
    this.active = id; this.stage = this.progress = 0; this.complete = false;
    this.cleanupStart = demolished; this.cleanupTarget = Math.max(1, Math.min(120, remaining));
    return true;
  }
  cancel(): void { this.active = null; this.stage = this.progress = 0; this.complete = false; }
  restart(remaining: number): void {
    const id = this.active;
    if (id) this.start(id, 0, remaining);
  }
  get target(): readonly [number, number] | null {
    if (!this.active || this.complete) return null;
    if (this.active === 'tour') return TOUR_STOPS[this.stage] ?? null;
    return this.active === 'delivery' ? (this.stage === 0 ? PARCEL_PICKUP : PARCEL_DROP) : CLEANUP_ZONE;
  }
  get goal(): number { return this.active === 'cleanup' ? this.cleanupTarget : this.active === 'tour' ? 3 : 2; }
  get instruction(): string {
    if (this.complete) return '徽章已收集 · 可以选下一件事';
    if (this.active === 'tour') return `驾车到第 ${this.stage + 1} 个路口`;
    if (this.active === 'delivery') return this.stage === 0 ? '下车，走到街角取包裹' : '送到南边公园，下车交付';
    return '拆掉地面光圈里的街边物件';
  }
  /** Returns true for the completion transition, never once per subsequent frame. */
  update(frame: JobFrame): boolean {
    if (!this.active || this.complete) return false;
    if (![frame.x, frame.y, frame.z, frame.demolished].every(Number.isFinite)) return false;
    const target = this.target;
    const near = target && Math.hypot(frame.x - target[0], frame.y - target[1]) <= (this.active === 'tour' ? 5.5 : 3) && frame.z < 2.2;
    if (this.active === 'tour' && near && frame.driving) this.progress = ++this.stage;
    if (this.active === 'delivery' && near && !frame.driving && !frame.flying) this.progress = ++this.stage;
    if (this.active === 'cleanup') this.progress = Math.min(this.cleanupTarget, Math.max(0, frame.demolished - this.cleanupStart));
    if (this.progress < this.goal) return false;
    this.complete = true; this.badges.add(this.active); return true;
  }
}
