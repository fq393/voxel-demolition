export type UrbanPropKind = 'fuelBarrel' | 'gasCylinder' | 'crate' | 'pallet' | 'barricade' | 'cone' | 'dumpster' | 'vending' | 'planter';
export interface UrbanProp {
  id:string;name:string;kind:UrbanPropKind;object:number;initial:number;
  center:readonly[number,number,number];size:readonly[number,number,number];
  explosive?:{radius:number;push:number};
}
