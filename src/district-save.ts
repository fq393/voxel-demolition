import { State, type City } from './world.ts';
import type { ProgressStorage } from './city-progress.ts';

export const DAMAGE_VERSION = 1;
export const MAX_DAMAGE_TEXT = 4_000_000;
export const MAX_DAMAGE_VOXELS = 1_000_000;
export interface DamageSnapshot {
  version: typeof DAMAGE_VERSION;
  count: number;
  layout: string;
  /** Sorted, nonadjacent [first voxel, length] runs; loose/rubble state restores as an empty hole. */
  ranges: [number, number][];
}
export type DamageLoadStatus = 'loaded' | 'fresh' | 'invalid' | 'mismatched' | 'unavailable';
export interface DamageLoad { snapshot: DamageSnapshot; status: DamageLoadStatus }
const layouts = new WeakMap<City, string>();
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
export function districtDamageKey(playerId: string): string { return `city.damage.v${DAMAGE_VERSION}.${playerId}`; }

/** Include geometry and object IDs, so a new district can never apply yesterday's holes to a different wall. */
export function damageLayout(city: City): string {
  // World geometry/IDs are immutable for a built City; damage only changes state and physics buffers.
  const cached = layouts.get(city);
  if (cached) return cached;
  let a = 2166136261, b = 3339675911;
  const byte = (n: number): void => { a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 2246822519); };
  for (const data of [city.position, city.material, city.building, city.cell]) {
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    for (let i = 0; i < bytes.length; i++) byte(bytes[i]);
  }
  const metadata = JSON.stringify({ count: city.count, grid: [city.pitch, city.street, city.blocks],
    objects: city.buildings.map(({ x0, y0, w, d, h, kind }) => [x0, y0, w, d, h, kind ?? '']), district: city.district ?? [] });
  for (let i = 0; i < metadata.length; i++) { byte(metadata.charCodeAt(i) & 255); byte(metadata.charCodeAt(i) >>> 8); }
  const layout = `d1-${city.count.toString(36)}-${(a >>> 0).toString(16).padStart(8, '0')}-${(b >>> 0).toString(16).padStart(8, '0')}`;
  layouts.set(city, layout);
  return layout;
}
function emptyDamage(city: City): DamageSnapshot { return { version: DAMAGE_VERSION, count: city.count, layout: damageLayout(city), ranges: [] }; }
function validatedShape(value: unknown): DamageSnapshot | null {
  if (!record(value) || Object.keys(value).some(key => !['version', 'count', 'layout', 'ranges'].includes(key))
    || value.version !== DAMAGE_VERSION || !integer(value.count, 0, MAX_DAMAGE_VOXELS)
    || typeof value.layout !== 'string' || !/^d1-[0-9a-z]+-[0-9a-f]{8}-[0-9a-f]{8}$/.test(value.layout)
    || !Array.isArray(value.ranges) || value.ranges.length > Math.ceil(value.count / 2)) return null;
  let end = -1;
  const ranges: [number, number][] = [];
  for (const range of value.ranges) {
    if (!Array.isArray(range) || range.length !== 2 || !integer(range[0], 0, value.count - 1)
      || !integer(range[1], 1, value.count) || range[0] <= end || range[0] + range[1] > value.count) return null;
    // Exclusive end must be strictly below the next run: adjacent runs are noncanonical.
    end = range[0] + range[1];
    ranges.push([range[0], range[1]]);
  }
  return { version: DAMAGE_VERSION, count: value.count, layout: value.layout, ranges };
}
export function captureDamage(city: City): DamageSnapshot {
  const snapshot = emptyDamage(city);
  for (let voxel = 0; voxel < city.count; voxel++) {
    if (city.state[voxel] === State.Fixed) continue;
    const last = snapshot.ranges.at(-1);
    if (last && last[0] + last[1] === voxel) last[1]++;
    else snapshot.ranges.push([voxel, 1]);
  }
  return snapshot;
}
/** This helper only supplies removals; the caller updates its structure and GPU physics together. */
export function damagedVoxels(snapshot: DamageSnapshot): number[] {
  const safe = validatedShape(snapshot);
  if (!safe) return [];
  const voxels: number[] = [];
  for (const [first, length] of safe.ranges) for (let n = 0; n < length; n++) voxels.push(first + n);
  return voxels;
}
export function loadDamage(storage: ProgressStorage, playerId: string, city: City): DamageLoad {
  const empty = emptyDamage(city);
  let raw: string | null;
  try { raw = storage.getItem(districtDamageKey(playerId)); }
  catch { return { snapshot: empty, status: 'unavailable' }; }
  if (raw === null) return { snapshot: empty, status: 'fresh' };
  if (raw.length > MAX_DAMAGE_TEXT) return { snapshot: empty, status: 'invalid' };
  let snapshot: DamageSnapshot | null;
  try { snapshot = validatedShape(JSON.parse(raw) as unknown); }
  catch { return { snapshot: empty, status: 'invalid' }; }
  if (!snapshot) return { snapshot: empty, status: 'invalid' };
  if (snapshot.count !== city.count || snapshot.layout !== empty.layout) return { snapshot: empty, status: 'mismatched' };
  return { snapshot, status: 'loaded' };
}
export function saveDamage(storage: ProgressStorage, playerId: string, snapshot: DamageSnapshot): { ok: boolean; error?: string } {
  const safe = validatedShape(snapshot);
  if (!safe) return { ok: false, error: '建筑损坏数据无效，本次未写入存档。' };
  const raw = JSON.stringify(safe);
  if (raw.length > MAX_DAMAGE_TEXT) return { ok: false, error: '建筑损坏存档过大，本次未写入。' };
  try { storage.setItem(districtDamageKey(playerId), raw); return { ok: true }; }
  catch { return { ok: false, error: '浏览器未能保存建筑损坏；当前页面的破坏仍保留。' }; }
}
/** Rebuild deliberately records an intact layout; it never resets the separate wallet/garage save. */
export function clearDamage(storage: ProgressStorage, playerId: string, city: City): { ok: boolean; error?: string } {
  return saveDamage(storage, playerId, emptyDamage(city));
}
