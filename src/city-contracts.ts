/** Browser-free task rules. All offer variation comes from an explicit seed and board serial. */
export type ContractType = 'tour' | 'delivery' | 'cleanup';
export type ContractPoint = readonly [number, number];
export interface CleanupZone { id: string; name: string; position: ContractPoint; remaining: number }
export interface CityContract {
  id: string;
  serial: number;
  type: ContractType;
  name: string;
  description: string;
  reward: number;
  stops: readonly ContractPoint[];
  cleanupZoneId: string | null;
  cleanupTarget: number;
}
export interface ActiveContract { contract: CityContract; stage: number; progress: number; cleanupLast: number }
export interface ContractFrame { x: number; y: number; z: number; driving: boolean; flying?: boolean; demolished: number }

export const CONTRACT_ROAD_STOPS: readonly ContractPoint[] = [[-23, 23], [23, 23], [23, -23], [-23, -23]];
export const CONTRACT_DELIVERY_STOPS: readonly ContractPoint[] = [[-13, -12], [13, -12], [-12, 12], [13, 12], [0, -42]];
const DELIVERY_NAMES = ['街角跑腿', '午后小包裹', '公园送件'];
const TOUR_NAMES = ['环街试车', '傍晚兜风', '街区巡游'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const samePoint = (a: ContractPoint, b: ContractPoint): boolean => a[0] === b[0] && a[1] === b[1];
const point = (value: unknown): value is ContractPoint => Array.isArray(value) && value.length === 2 && value.every(v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let n = Math.imul(state ^ state >>> 15, state | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export function sanitizeCleanupZones(zones: readonly CleanupZone[]): CleanupZone[] {
  const seen = new Set<string>();
  return zones.filter(zone => record(zone) && typeof zone.id === 'string' && /^[\w.-]{1,48}$/.test(zone.id)
    && typeof zone.name === 'string' && zone.name.length > 0 && zone.name.length <= 60
    && point(zone.position) && integer(zone.remaining, 0, 1_000_000) && !seen.has(zone.id) && !!seen.add(zone.id))
    .map(zone => ({ id: zone.id, name: zone.name, position: [zone.position[0], zone.position[1]], remaining: zone.remaining }));
}

/** One tour, one delivery, and one cleanup (or a second delivery when the street is depleted). */
export function generateContracts(seed: number, serial: number, cleanupZones: readonly CleanupZone[] = []): CityContract[] {
  const safeSeed = Number.isSafeInteger(seed) ? seed >>> 0 : 1;
  const safeSerial = integer(serial, 1, 1_000_000_000) ? serial : 1;
  const random = seededRandom(safeSeed ^ Math.imul(safeSerial, 0x9e3779b9));
  const choose = (length: number): number => Math.floor(random() * length);
  const id = (index: number): string => `contract-${safeSeed.toString(16)}-${safeSerial}-${index}`;
  const first = choose(4), direction = random() < 0.5 ? 1 : -1, count = random() < 0.35 ? 4 : 3;
  const tour: CityContract = {
    id: id(0), serial: safeSerial, type: 'tour', name: TOUR_NAMES[choose(TOUR_NAMES.length)],
    description: '开车依次经过标记路口，沿着街区转一圈。', reward: count === 4 ? 140 : 110,
    stops: Array.from({ length: count }, (_, i) => [...CONTRACT_ROAD_STOPS[(first + direction * i + 8) % 4]] as [number, number]),
    cleanupZoneId: null, cleanupTarget: 0,
  };
  const delivery = (index: number): CityContract => {
    const pickup = choose(CONTRACT_DELIVERY_STOPS.length);
    const drop = (pickup + 1 + choose(CONTRACT_DELIVERY_STOPS.length - 1)) % CONTRACT_DELIVERY_STOPS.length;
    const stops = [CONTRACT_DELIVERY_STOPS[pickup], CONTRACT_DELIVERY_STOPS[drop]].map(p => [...p] as [number, number]);
    const distance = Math.hypot(stops[0][0] - stops[1][0], stops[0][1] - stops[1][1]);
    return { id: id(index), serial: safeSerial, type: 'delivery', name: DELIVERY_NAMES[choose(DELIVERY_NAMES.length)],
      description: '下车取包裹，送到另一个街角后下车交付。', reward: Math.min(180, 100 + Math.floor(distance / 10) * 10),
      stops, cleanupZoneId: null, cleanupTarget: 0 };
  };
  const zones = sanitizeCleanupZones(cleanupZones).filter(zone => zone.remaining >= 60);
  const parcel = delivery(1);
  if (!zones.length) return [tour, parcel, delivery(2)];
  const zone = zones[choose(zones.length)];
  const target = Math.min(Math.floor(zone.remaining / 10) * 10, 60 + choose(7) * 10);
  const cleanup: CityContract = { id: id(2), serial: safeSerial, type: 'cleanup', name: `${zone.name}清理`,
    description: `拆掉标记范围里 ${target} 块街边物件，给街区腾点空间。`, reward: 90 + target / 2,
    stops: [[...zone.position] as [number, number]], cleanupZoneId: zone.id, cleanupTarget: target };
  return [tour, parcel, cleanup];
}

/** Rejects edited routes/rewards rather than turning a bad save into an unreachable task. */
export function validateContract(value: unknown, seed: number, serial: number, zones?: readonly CleanupZone[]): CityContract | null {
  if (!record(value) || typeof value.id !== 'string' || ![0, 1, 2].some(i => value.id === `contract-${(seed >>> 0).toString(16)}-${serial}-${i}`)
    || value.serial !== serial || typeof value.name !== 'string' || !value.name.length || value.name.length > 80
    || typeof value.description !== 'string' || value.description.length > 300 || !integer(value.reward, 90, 180)
    || !Array.isArray(value.stops) || !value.stops.every(point)) return null;
  const stops = value.stops.map(p => [...p] as [number, number]);
  const slot = Number(value.id.slice(-1));
  if (value.type === 'tour') {
    const indices = stops.map(p => CONTRACT_ROAD_STOPS.findIndex(anchor => samePoint(anchor, p)));
    if (slot !== 0 || stops.length < 3 || stops.length > 4 || new Set(indices).size !== stops.length || indices.includes(-1)
      || value.cleanupZoneId !== null || value.cleanupTarget !== 0 || value.reward !== (stops.length === 4 ? 140 : 110)) return null;
    const direction = (indices[1] - indices[0] + 4) % 4;
    if (![1, 3].includes(direction) || indices.slice(1).some((n, i) => (n - indices[i] + 4) % 4 !== direction)) return null;
  } else if (value.type === 'delivery') {
    if (slot === 0 || stops.length !== 2 || samePoint(stops[0], stops[1])
      || stops.some(p => !CONTRACT_DELIVERY_STOPS.some(anchor => samePoint(anchor, p)))
      || value.cleanupZoneId !== null || value.cleanupTarget !== 0) return null;
    const expectedReward = Math.min(180, 100 + Math.floor(Math.hypot(stops[0][0] - stops[1][0], stops[0][1] - stops[1][1]) / 10) * 10);
    if (value.reward !== expectedReward) return null;
  } else if (value.type === 'cleanup') {
    if (slot !== 2 || stops.length !== 1 || typeof value.cleanupZoneId !== 'string' || !/^[\w.-]{1,48}$/.test(value.cleanupZoneId)
      || !integer(value.cleanupTarget, 60, 120) || value.cleanupTarget % 10 !== 0 || value.reward !== 90 + value.cleanupTarget / 2) return null;
    if (zones && !sanitizeCleanupZones(zones).some(zone => zone.id === value.cleanupZoneId && samePoint(zone.position, stops[0]))) return null;
  } else return null;
  return { id: value.id, serial, type: value.type, name: value.name, description: value.description,
    reward: value.reward, stops, cleanupZoneId: value.cleanupZoneId as string | null, cleanupTarget: value.cleanupTarget as number };
}

export function contractGoal(contract: CityContract): number { return contract.type === 'cleanup' ? contract.cleanupTarget : contract.stops.length; }
export function contractTarget(active: ActiveContract | null): ContractPoint | null {
  return active ? active.contract.stops[active.contract.type === 'cleanup' ? 0 : active.stage] ?? null : null;
}
export function contractInstruction(active: ActiveContract | null): string {
  if (!active) return '挑一份委托，慢慢逛这座城';
  if (active.contract.type === 'tour') return `驾车到第 ${active.stage + 1} 个路口`;
  if (active.contract.type === 'delivery') return active.stage === 0 ? '下车，走到标记处取包裹' : '送到目的地，下车交付';
  return '拆掉绿色光圈里的街边物件';
}

/** Advances one objective per frame; a repeated completed frame has no reward side effects. */
export function advanceActiveContract(active: ActiveContract, frame: ContractFrame): boolean {
  if (![frame.x, frame.y, frame.z, frame.demolished].every(Number.isFinite) || frame.demolished < 0) return false;
  const goal = contractGoal(active.contract);
  if (active.progress >= goal) return false;
  if (active.contract.type === 'cleanup') {
    const delta = Math.max(0, Math.floor(frame.demolished) - active.cleanupLast);
    active.cleanupLast = Math.floor(frame.demolished);
    active.progress = Math.min(goal, active.progress + delta);
  } else {
    const target = contractTarget(active)!;
    const near = Math.hypot(frame.x - target[0], frame.y - target[1]) <= (active.contract.type === 'tour' ? 5.5 : 3)
      && frame.z >= -1 && frame.z < 2.2;
    const allowed = active.contract.type === 'tour' ? frame.driving : !frame.driving && !frame.flying;
    if (near && allowed) active.progress = ++active.stage;
  }
  return active.progress >= goal;
}
