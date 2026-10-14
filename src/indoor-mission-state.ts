import { DISTRICT_REWARDS, type DistrictBuilding, type DistrictId, type DistrictPoint } from './district-layout.ts';

export const INDOOR_FURNITURE_GOAL = 40;
export const DISTRICT_IDS: readonly DistrictId[] = ['store', 'home', 'warehouse'];
export interface ActiveIndoorMission { id: DistrictId; stage: 0 | 1 }
export interface IndoorMissionState { active: ActiveIndoorMission | null; completed: DistrictId[] }
export interface IndoorMissionFrame {
  x: number; y: number; z: number; driving: boolean; flying: boolean; removedFurniture: number;
}
export interface IndoorMissionInfo { id: DistrictId; name: string; description: string; reward: number }
export interface IndoorCompletion { id: DistrictId; reward: number; coins: number }
const MISSIONS: Record<DistrictId, IndoorMissionInfo> = {
  store: { id: 'store', name: '便利店取件', description: '进店到柜台取件，再走回门口交付。', reward: DISTRICT_REWARDS.store },
  home: { id: 'home', name: '楼上找找看', description: '沿楼梯上二楼，找到房间里的包裹，再带回门口。', reward: DISTRICT_REWARDS.home },
  warehouse: { id: 'warehouse', name: '仓库腾地方', description: `到仓库里拆掉 ${INDOOR_FURNITURE_GOAL} 块旧家具，再回门口结算。`, reward: DISTRICT_REWARDS.warehouse },
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isDistrictId = (value: unknown): value is DistrictId => DISTRICT_IDS.includes(value as DistrictId);
export const emptyIndoorState = (): IndoorMissionState => ({ active: null, completed: [] });
export function indoorMission(id: DistrictId): IndoorMissionInfo { return { ...MISSIONS[id] }; }

/** Old v0.4 snapshots omit this field; edited rewards and unknown task IDs are never trusted. */
export function validateIndoorState(value: unknown): IndoorMissionState | null {
  if (value === undefined) return emptyIndoorState();
  if (!record(value) || Object.keys(value).some(key => key !== 'active' && key !== 'completed')
    || !Array.isArray(value.completed) || value.completed.length > DISTRICT_IDS.length
    || !value.completed.every(isDistrictId) || new Set(value.completed).size !== value.completed.length) return null;
  let active: ActiveIndoorMission | null = null;
  if (value.active !== null) {
    if (!record(value.active) || Object.keys(value.active).some(key => key !== 'id' && key !== 'stage')
      || !isDistrictId(value.active.id) || (value.active.stage !== 0 && value.active.stage !== 1)
      || value.completed.includes(value.active.id)) return null;
    active = { id: value.active.id, stage: value.active.stage };
  }
  return { active, completed: [...value.completed] };
}
export function indoorEarned(state: IndoorMissionState): number {
  return state.completed.reduce((total, id) => total + DISTRICT_REWARDS[id], 0);
}
export function indoorTarget(active: Readonly<ActiveIndoorMission> | null, buildings: readonly DistrictBuilding[]): DistrictPoint | null {
  const building = active && buildings.find(candidate => candidate.id === active.id);
  return building && active ? active.stage === 0 ? building.target : building.entrance : null;
}
export function indoorInstruction(active: Readonly<ActiveIndoorMission> | null, buildings: readonly DistrictBuilding[]): string {
  if (!active) return '进屋逛逛，接一份室内委托';
  const building = buildings.find(candidate => candidate.id === active.id);
  if (!building) return '这栋建筑暂时不可用';
  if (active.stage === 1) return `步行回${building.name}门口交付`;
  if (active.id === 'store') return '步行进便利店，到柜台取件';
  if (active.id === 'home') return '沿楼梯上二楼，到房间取包裹';
  return `进仓库，拆掉 ${INDOOR_FURNITURE_GOAL} 块旧家具`;
}

/** Real 3D proximity prevents a downstairs/roof position from completing an upstairs task. */
export function advanceIndoorMission(active: ActiveIndoorMission, frame: IndoorMissionFrame, buildings: readonly DistrictBuilding[]): boolean {
  if (![frame.x, frame.y, frame.z, frame.removedFurniture].every(Number.isFinite)
    || frame.removedFurniture < 0 || frame.driving || frame.flying) return false;
  const building = buildings.find(candidate => candidate.id === active.id);
  const target = indoorTarget(active, buildings);
  if (!building || !target || Math.hypot(frame.x - target[0], frame.y - target[1]) > 1.25
    || Math.abs(frame.z - target[2]) > 0.6) return false;
  if (active.stage === 0) {
    // The outer walls/roof are destructible; reaching their outside face does not count as entering.
    const b = building.bounds;
    if (frame.x <= b.minX + 0.25 || frame.x >= b.maxX - 0.25
      || frame.y <= b.minY + 0.25 || frame.y >= b.maxY - 0.25
      || (active.id === 'warehouse' && frame.removedFurniture < INDOOR_FURNITURE_GOAL)) return false;
    active.stage = 1;
    return false;
  }
  return true;
}
