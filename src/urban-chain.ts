import { State, type City } from './world.ts';
import type { UrbanProp } from './urban-prop-types.ts';

export interface ChainEvent {
  id: string;
  at: readonly [number, number, number];
  radius: number;
  push: number;
}

interface WatchedProp {
  event: ChainEvent;
  voxels: Int32Array;
  threshold: number;
  fuse: number;
  due: number;
  spent: boolean;
}

const MAX_PER_UPDATE = 3;
const DAMAGE_SHARE = 0.15;

/** Stable timing gives neighbouring containers a short, readable cascade instead of one simultaneous flash. */
function fuseFor(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return 0.12 + ((hash >>> 0) % 121) / 1000;
}

/** Only the explosive objects' voxel indices are watched; the city's large tower is never rescanned here. */
export class UrbanChain {
  private city: City;
  private readonly props: WatchedProp[] = [];
  private clock = 0;
  private detonated = 0;
  private watchedVoxels = 0;

  constructor(city: City) {
    this.city = city;
    this.reset(city);
  }

  /** Call after restoring damage. A saved, damaged container must not explode again after a refresh. */
  reset(city: City): void {
    this.city = city;
    this.props.length = 0;
    this.clock = this.detonated = this.watchedVoxels = 0;
    const ids = new Set<string>();
    for (const prop of city.urbanProps ?? []) {
      if (!this.valid(prop) || ids.has(prop.id)) continue;
      const object = city.buildings[prop.object];
      if (!object) continue;
      const voxels: number[] = [];
      let restored = false;
      for (const voxel of object.cells) {
        if (voxel < 0 || voxel >= city.count) continue;
        voxels.push(voxel);
        if (city.state[voxel] !== State.Fixed) restored = true;
      }
      if (!voxels.length) continue;
      ids.add(prop.id);
      this.watchedVoxels += voxels.length;
      this.props.push({
        event: { id: prop.id, at: [prop.center[0], prop.center[1], prop.center[2]], radius: prop.explosive!.radius, push: prop.explosive!.push },
        voxels: Int32Array.from(voxels),
        threshold: Math.max(1, Math.ceil(voxels.length * DAMAGE_SHARE)),
        fuse: fuseFor(prop.id), due: Infinity, spent: restored,
      });
    }
  }

  private valid(prop: UrbanProp): boolean {
    return !!prop.explosive && Number.isSafeInteger(prop.object) && prop.object >= 0
      && prop.center.every(Number.isFinite) && Number.isFinite(prop.explosive.radius) && prop.explosive.radius > 0
      && Number.isFinite(prop.explosive.push) && prop.explosive.push > 0;
  }

  /** Newly detected damage starts its fuse on this frame; the returned blasts affect neighbours on subsequent frames. */
  update(dt: number, active: boolean): ChainEvent[] {
    if (!active || !Number.isFinite(dt) || dt <= 0) return [];
    this.clock += dt;
    const events: ChainEvent[] = [];
    for (const prop of this.props) {
      if (prop.spent) continue;
      if (prop.due === Infinity) {
        let damaged = 0;
        for (const voxel of prop.voxels) {
          if (this.city.state[voxel] !== State.Fixed && ++damaged >= prop.threshold) break;
        }
        if (damaged >= prop.threshold) prop.due = this.clock + prop.fuse;
      }
      if (prop.due > this.clock || events.length >= MAX_PER_UPDATE) continue;
      prop.spent = true;
      this.detonated++;
      events.push(prop.event);
    }
    return events;
  }

  get diagnostics(): Readonly<{ watched: number; watchedVoxels: number; armed: number; pending: number; spent: number; detonated: number; maxPerUpdate: number }> {
    let armed = 0, pending = 0, spent = 0;
    for (const prop of this.props) {
      if (prop.spent) spent++;
      else if (prop.due !== Infinity) pending++;
      else armed++;
    }
    return { watched: this.props.length, watchedVoxels: this.watchedVoxels, armed, pending, spent, detonated: this.detonated, maxPerUpdate: MAX_PER_UPDATE };
  }
}
