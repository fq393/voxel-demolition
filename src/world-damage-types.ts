export type Point3 = readonly [number, number, number];
export type DamageKind = 'bullet' | 'hammer' | 'laser' | 'explosion' | 'impact';
export type DamageTargetKind = 'building' | 'person' | 'vehicle' | 'garage';
export interface DamageTarget { id: string; kind: DamageTargetKind; t: number; normal: [number,number,number] }
export interface WorldDamageRequest { at: Point3; radius: number; amount: number; impulse: number; kind: DamageKind; directId?: string }
export interface WorldDamageEvent { id: string; kind: DamageTargetKind; at: Point3; tint: number; destroyed: boolean; parts: number }
