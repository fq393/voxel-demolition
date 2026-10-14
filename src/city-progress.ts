import { VEHICLES, vehicleSpec, type VehicleId } from './vehicle-spec.ts';
import { advanceActiveContract, contractGoal, contractInstruction, contractTarget, generateContracts, sanitizeCleanupZones, validateContract,
  type ActiveContract, type CityContract, type CleanupZone, type ContractFrame, type ContractPoint, type ContractType } from './city-contracts.ts';

export const CITY_PROGRESS_VERSION = 1;
const MAX_VALUE = 1_000_000_000;
export interface CityProgressPose {
  player: { x: number; y: number; z: number; yaw: number; driving: boolean };
  car: { x: number; y: number; z: number; yaw: number; health: number };
}
export type CityPose = CityProgressPose;
export interface CityProgressSnapshot {
  version: typeof CITY_PROGRESS_VERSION;
  coins: number;
  owned: VehicleId[];
  selected: VehicleId;
  completed: number;
  earned: number;
  seed: number;
  serial: number;
  offers: CityContract[];
  active: ActiveContract | null;
  pose: CityProgressPose | null;
  badges: ContractType[];
}
export interface ContractCompletion { contract: CityContract; coins: number; reward: number }
export interface ProgressStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export type ProgressLoadStatus = 'loaded' | 'fresh' | 'migrated' | 'invalid' | 'unavailable';
export type VehiclePurchaseResult = 'purchased' | 'owned' | 'insufficient' | 'invalid';
interface ProgressOptions { seed?: number; cleanupZones?: readonly CleanupZone[]; snapshot?: CityProgressSnapshot; legacyBadges?: readonly string[] }
const TYPES: readonly ContractType[] = ['tour', 'delivery', 'cleanup'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = MAX_VALUE): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const isVehicle = (id: unknown): id is VehicleId => VEHICLES.some(vehicle => vehicle.id === id);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A nickname's stable local identity selects its own save; no private account token is stored here. */
export function cityProgressKey(playerId: string): string { return `city.progress.v${CITY_PROGRESS_VERSION}.${playerId}`; }
export function progressSeed(playerId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < playerId.length; i++) hash = Math.imul(hash ^ playerId.charCodeAt(i), 16777619);
  return hash >>> 0;
}

/** Ground-only saves never restore a flying camera into the sky or coordinates outside the playable world. */
export function validateCityPose(value: unknown): CityProgressPose | null {
  if (!record(value) || !record(value.player) || !record(value.car)) return null;
  const { player, car } = value;
  for (const pose of [player, car]) {
    if (['x', 'y', 'z', 'yaw'].some(key => typeof pose[key] !== 'number' || !Number.isFinite(pose[key]))
      || Math.abs(pose.x as number) > 180 || Math.abs(pose.y as number) > 180 || Math.abs(pose.z as number) > 180
      || Math.abs(pose.yaw as number) > 1_000_000) return null;
  }
  if (typeof player.driving !== 'boolean' || typeof car.health !== 'number' || !Number.isFinite(car.health) || car.health < 0 || car.health > 1) return null;
  const yaw = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));
  return {
    player: { x: player.x as number, y: player.y as number, z: Math.max(0, Math.min(2, player.z as number)), yaw: yaw(player.yaw as number), driving: player.driving },
    car: { x: car.x as number, y: car.y as number, z: Math.max(0, Math.min(1, car.z as number)), yaw: yaw(car.yaw as number), health: car.health },
  };
}

/** Strict schema validation. A bad pose is discarded while a valid wallet/garage can still be recovered. */
export function validateCityProgress(value: unknown, zones?: readonly CleanupZone[]): CityProgressSnapshot | null {
  if (!record(value) || value.version !== CITY_PROGRESS_VERSION || !integer(value.coins) || !integer(value.earned)
    || !integer(value.completed) || !integer(value.seed, 0, 0xffffffff) || !integer(value.serial, 1)
    || !Array.isArray(value.owned) || value.owned.length < 1 || value.owned.length > VEHICLES.length
    || !value.owned.every(isVehicle) || new Set(value.owned).size !== value.owned.length || !value.owned.includes('sedan')
    || !isVehicle(value.selected) || !value.owned.includes(value.selected)
    || !Array.isArray(value.offers) || value.offers.length !== 3
    || !Array.isArray(value.badges) || value.badges.length > 3 || !value.badges.every(v => TYPES.includes(v as ContractType))
    || new Set(value.badges).size !== value.badges.length) return null;
  const vehicleCost = value.owned.reduce((sum, id) => sum + vehicleSpec(id).price, 0);
  if (value.earned - vehicleCost !== value.coins || value.completed > value.serial - 1
    || value.earned > value.completed * 180 || value.earned < value.completed * 90) return null;
  const offers = value.offers.map(offer => validateContract(offer, value.seed as number, value.serial as number, zones));
  if (offers.some(offer => !offer) || new Set(offers.map(offer => offer!.id)).size !== 3) return null;
  let active: ActiveContract | null = null;
  if (value.active !== null) {
    if (!record(value.active) || !integer(value.active.stage, 0, 4) || !integer(value.active.progress, 0, 120)
      || !integer(value.active.cleanupLast, 0, 1_000_000)) return null;
    const contract = validateContract(value.active.contract, value.seed, value.serial, zones);
    const offer = contract && offers.find(candidate => candidate!.id === contract.id);
    if (!contract || !offer || JSON.stringify(contract) !== JSON.stringify(offer)) return null;
    if (value.active.progress >= contractGoal(contract) || (contract.type === 'cleanup' ? value.active.stage !== 0 : value.active.stage !== value.active.progress)) return null;
    active = { contract, stage: value.active.stage, progress: value.active.progress, cleanupLast: value.active.cleanupLast };
  }
  return { version: CITY_PROGRESS_VERSION, coins: value.coins, owned: [...value.owned], selected: value.selected,
    completed: value.completed, earned: value.earned, seed: value.seed, serial: value.serial,
    offers: offers as CityContract[], active, pose: value.pose === null ? null : validateCityPose(value.pose), badges: [...value.badges] as ContractType[] };
}

export function deserializeCityProgress(serialized: string, zones?: readonly CleanupZone[]): CityProgressSnapshot | null {
  try { return validateCityProgress(JSON.parse(serialized) as unknown, zones); } catch { return null; }
}

/** Local sandbox progression. Ranked demolition scores never enter this wallet. */
export class CityProgress {
  private data: CityProgressSnapshot;
  private zones: CleanupZone[];
  constructor(options: ProgressOptions = {}) {
    this.zones = sanitizeCleanupZones(options.cleanupZones ?? []);
    const restored = options.snapshot ? validateCityProgress(options.snapshot, this.zones) : null;
    const seed = integer(options.seed, 0, 0xffffffff) ? options.seed : 1;
    this.data = restored ?? { version: CITY_PROGRESS_VERSION, coins: 0, owned: ['sedan'], selected: 'sedan', completed: 0, earned: 0,
      seed, serial: 1, offers: generateContracts(seed, 1, this.zones), active: null, pose: null,
      badges: [...new Set((options.legacyBadges ?? []).filter((id): id is ContractType => TYPES.includes(id as ContractType)))] };
  }
  get coins(): number { return this.data.coins; }
  get owned(): readonly VehicleId[] { return this.data.owned; }
  get selected(): VehicleId { return this.data.selected; }
  get completed(): number { return this.data.completed; }
  get earned(): number { return this.data.earned; }
  get seed(): number { return this.data.seed; }
  get serial(): number { return this.data.serial; }
  get offers(): readonly CityContract[] { return this.data.offers; }
  get active(): Readonly<ActiveContract> | null { return this.data.active; }
  get pose(): CityProgressPose | null { return this.data.pose; }
  get badges(): readonly ContractType[] { return this.data.badges; }
  get target(): ContractPoint | null { return contractTarget(this.data.active); }
  get goal(): number { return this.data.active ? contractGoal(this.data.active.contract) : 0; }
  get instruction(): string { return contractInstruction(this.data.active); }
  setCleanupZones(zones: readonly CleanupZone[]): void { this.zones = sanitizeCleanupZones(zones); }

  acceptContract(id: string, demolished = 0): boolean {
    if (this.data.active || this.data.serial >= MAX_VALUE || !integer(demolished, 0, 1_000_000)) return false;
    const contract = this.data.offers.find(offer => offer.id === id);
    if (!contract) return false;
    if (contract.type === 'cleanup' && !this.zones.some(zone => zone.id === contract.cleanupZoneId && zone.remaining >= contract.cleanupTarget)) return false;
    this.data.active = { contract: clone(contract), stage: 0, progress: 0, cleanupLast: demolished };
    return true;
  }
  cancelContract(): void { this.data.active = null; }
  /** Rebuilding/restoring the world changes the region's counter, not work already completed. */
  rebaseCleanup(demolished: number): void {
    if (this.data.active?.contract.type === 'cleanup' && integer(demolished, 0, 1_000_000)) this.data.active.cleanupLast = demolished;
  }
  advanceContract(frame: ContractFrame): ContractCompletion | null {
    const active = this.data.active;
    if (!active || !advanceActiveContract(active, frame)) return null;
    const contract = clone(active.contract);
    // Completion is consumed before the next frame or save: accepting an old offer ID can never credit twice.
    this.data.active = null;
    this.data.completed++;
    this.data.earned += contract.reward;
    this.data.coins += contract.reward;
    if (!this.data.badges.includes(contract.type)) this.data.badges.push(contract.type);
    this.rotateOffers();
    return { contract, reward: contract.reward, coins: this.data.coins };
  }
  rotateOffers(): boolean {
    if (this.data.active || this.data.serial >= MAX_VALUE) return false;
    this.data.serial++;
    this.data.offers = generateContracts(this.data.seed, this.data.serial, this.zones);
    return true;
  }
  purchase(id: unknown): VehiclePurchaseResult {
    if (!isVehicle(id)) return 'invalid';
    if (this.data.owned.includes(id)) return 'owned';
    const cost = vehicleSpec(id).price;
    if (this.data.coins < cost) return 'insufficient';
    this.data.coins -= cost;
    this.data.owned.push(id);
    return 'purchased';
  }
  selectVehicle(id: unknown): boolean {
    if (!isVehicle(id) || !this.data.owned.includes(id)) return false;
    this.data.selected = id;
    return true;
  }
  capturePose(pose: CityProgressPose): boolean {
    const validated = validateCityPose(pose);
    if (!validated) return false;
    this.data.pose = validated;
    return true;
  }
  snapshot(): CityProgressSnapshot { return clone(this.data); }
  serialize(): string { return JSON.stringify(this.data); }
}

export function loadCityProgress(storage: ProgressStorage, playerId: string, zones: readonly CleanupZone[], seed = progressSeed(playerId)):
  { progress: CityProgress; status: ProgressLoadStatus } {
  let raw: string | null;
  try { raw = storage.getItem(cityProgressKey(playerId)); } catch { return { progress: new CityProgress({ seed, cleanupZones: zones }), status: 'unavailable' }; }
  if (raw !== null) {
    const snapshot = deserializeCityProgress(raw, zones);
    return { progress: new CityProgress({ seed, cleanupZones: zones, ...(snapshot ? { snapshot } : {}) }), status: snapshot ? 'loaded' : 'invalid' };
  }
  let legacyBadges: string[] = [];
  try {
    const legacy: unknown = JSON.parse(storage.getItem(`city.jobs.${playerId}`) ?? '[]');
    if (Array.isArray(legacy)) legacyBadges = legacy.filter((value): value is string => typeof value === 'string' && TYPES.includes(value as ContractType));
  } catch { /* An unreadable legacy badge file does not invalidate a new wallet. */ }
  return { progress: new CityProgress({ seed, cleanupZones: zones, legacyBadges }), status: legacyBadges.length ? 'migrated' : 'fresh' };
}
export function saveCityProgress(storage: ProgressStorage, playerId: string, progress: CityProgress): { ok: boolean; error?: string } {
  try { storage.setItem(cityProgressKey(playerId), progress.serialize()); return { ok: true }; }
  catch { return { ok: false, error: '浏览器未能保存进度；本次游玩的金币仍保留在当前页面。' }; }
}
