/** City vehicles use metres, kilograms and metres/second. The free sedan starts every new save. */
export type VehicleId = 'sedan' | 'pickup' | 'van';

export interface VehicleSpec {
  readonly id: VehicleId;
  readonly name: string;
  readonly description: string;
  readonly price: number;
  readonly size: readonly [number, number, number];
  readonly mass: number;
  readonly maxSpeed: number;
}

export const VEHICLES: readonly VehicleSpec[] = Object.freeze([
  { id: 'sedan', name: '海风轿车', description: '轻巧灵活，适合街头兜风。', price: 0, size: [4.5, 2, 1.5], mass: 1250, maxSpeed: 34 },
  { id: 'pickup', name: '落日皮卡', description: '抓地稳、车身结实，开着它去干活。', price: 300, size: [4.875, 2.125, 1.875], mass: 1900, maxSpeed: 29 },
  { id: 'van', name: '薄荷货车', description: '宽大沉稳，慢一点也能轻松逛城。', price: 650, size: [5.125, 2.125, 2.125], mass: 2350, maxSpeed: 24 },
].map((spec) => Object.freeze({ ...spec, size: Object.freeze(spec.size) as readonly [number, number, number] })) as VehicleSpec[]);

/** Save files and UI inputs pass through this lookup before they can select a vehicle. */
export function vehicleSpec(id: unknown): VehicleSpec {
  return VEHICLES.find((spec) => spec.id === id) ?? VEHICLES[0];
}
