/** Authored street clusters. Each prop owns real, hollow voxel collision/destruction geometry. */
import { Mat, M, VOXEL, type WorldBuilder } from './world.ts';
import type { UrbanProp, UrbanPropKind } from './urban-prop-types.ts';

type Put = Parameters<Parameters<WorldBuilder['place']>[5]>[0];
const C = { cream: 0xe7d9b9, coral: 0xc47d62, sage: 0x739582, wood: 0xac8154,
  darkWood: 0x76573d, iron: 0x52665e, glass: 0x688c91, dark: 0x36413c, leaf: 0x78935b };
const SIZE: Record<UrbanPropKind, readonly [number, number, number]> = {
  fuelBarrel: [4, 4, 5], gasCylinder: [3, 3, 6], crate: [5, 5, 4], pallet: [6, 5, 2],
  barricade: [7, 3, 4], cone: [4, 4, 4], dumpster: [8, 5, 6], vending: [6, 4, 9], planter: [7, 4, 4],
};
const NAME: Record<UrbanPropKind, string> = {
  fuelBarrel: '燃油桶', gasCylinder: '气瓶', crate: '木箱', pallet: '装卸托盘', barricade: '维修路障',
  cone: '锥筒', dumpster: '街边垃圾箱', vending: '饮料售货机', planter: '暖色花箱',
};

function fill(w: WorldBuilder, kind: UrbanPropKind, put: Put, tint: number): void {
  const [wide, deep, tall] = SIZE[kind];
  if (kind === 'fuelBarrel' || kind === 'gasCylinder' || kind === 'cone') {
    for (let z = 0; z < tall; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
      const r = Math.hypot(x + .5 - wide / 2, y + .5 - deep / 2);
      if (kind === 'cone') {
        const radius = z === 0 ? 2.3 : 1.8 - z * .35;
        if (r <= radius) put(x, y, z, Mat.Plaster, z === 2 ? C.cream : C.coral);
      } else {
        // Cylinder shells have an empty core, supported caps, and a narrowing bottle shoulder.
        const radius = kind === 'fuelBarrel' ? 1.95 : z === tall - 1 ? .3 : z === tall - 2 ? .85 : 1.3;
        const cap = z === 0 || z >= tall - 2;
        if (r <= radius && (cap || r >= radius - 1.1))
          put(x, y, z, Mat.Steel, kind === 'fuelBarrel' && (z === 1 || z === 3) ? C.iron : tint);
      }
    }
    return;
  }
  if (kind === 'crate') {
    for (let z = 0; z < tall; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++)
      if (z === 0 || z === tall - 1 || x === 0 || x === wide - 1 || y === 0 || y === deep - 1)
        put(x, y, z, Mat.Wood, z % 2 ? C.wood : C.darkWood);
    return;
  }
  if (kind === 'pallet') {
    for (const x of [0, 3, 5]) w.box(put, x, 0, 0, x + 1, deep, 1, Mat.Wood, C.darkWood);
    for (const y of [0, 2, 4]) w.box(put, 0, y, 1, wide, y + 1, 2, Mat.Wood, C.wood);
    return;
  }
  if (kind === 'barricade') {
    for (const x of [0, wide - 1]) {
      w.box(put, x, 0, 0, x + 1, deep, 1, Mat.Steel, C.iron);
      w.box(put, x, 1, 0, x + 1, 2, tall, Mat.Steel, C.iron);
    }
    for (let x = 0; x < wide; x++) for (const z of [2, 3]) put(x, 1, z, Mat.Wood, x % 2 ? C.cream : C.coral);
    return;
  }
  if (kind === 'planter') {
    for (let z = 0; z < 3; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++)
      if (z === 0 || x === 0 || x === wide - 1 || y === 0 || y === deep - 1)
        put(x, y, z, Mat.Plaster, z === 2 ? C.cream : tint);
    for (const x of [1, 3, 5]) {
      put(x, 1, 1, Mat.Wood, C.darkWood); put(x, 1, 2, Mat.Leaf, C.leaf);
      put(x, 1, 3, Mat.Leaf, C.leaf); put(x, 2, 3, Mat.Leaf, C.leaf);
    }
    return;
  }
  // Dumpster and vending-machine hulls leave their internal space empty.
  for (let z = 0; z < tall; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
    if (z !== 0 && z !== tall - 1 && x !== 0 && x !== wide - 1 && y !== 0 && y !== deep - 1) continue;
    const glass = kind === 'vending' && y === 0 && x > 0 && x < wide - 2 && z >= 3 && z < tall - 2;
    put(x, y, z, glass ? Mat.Glass : Mat.Steel, glass ? C.glass : z === tall - 1 ? C.iron : tint);
  }
  if (kind === 'vending') for (const z of [3, 5]) w.box(put, 1, 1, z, wide - 1, deep - 1, z + 1, Mat.Steel, C.iron);
}

/** Append after the district to preserve every pre-v0.6 object and voxel index. */
export function buildUrbanProps(w: WorldBuilder): UrbanProp[] {
  const props: UrbanProp[] = [];
  const add = (zone: string, kind: UrbanPropKind, x: number, y: number): void => {
    const [wide, deep, tall] = SIZE[kind];
    const x0 = Math.round(x * M - wide / 2), y0 = Math.round(y * M - deep / 2);
    const tint = kind === 'fuelBarrel' ? C.coral : kind === 'gasCylinder' ? C.sage
      : kind === 'dumpster' ? C.sage : kind === 'planter' ? C.coral : C.cream;
    w.place(x0, y0, wide, deep, tall, put => fill(w, kind, put, tint));
    props.push({ id: `urban-${zone}-${kind}-${props.filter(p => p.id.startsWith(`urban-${zone}-${kind}-`)).length + 1}`,
      name: NAME[kind], kind, object: w.count - 1,
      initial: w.last().cells.reduce((n, v) => n + Number(v >= 0), 0),
      center: [(x0 + wide / 2) * VOXEL, (y0 + deep / 2) * VOXEL, tall * VOXEL / 2],
      size: [wide * VOXEL, deep * VOXEL, tall * VOXEL],
      ...(kind === 'fuelBarrel' || kind === 'gasCylinder' ? { explosive: { radius: 2.9, push: kind === 'fuelBarrel' ? 21 : 18 } } : {}),
    });
  };
  const cluster = (zone: string, placements: readonly (readonly [UrbanPropKind, number, number])[]) => {
    for (const [kind, x, y] of placements) add(zone, kind, x, y);
  };
  // The near-spawn repair bay sits between the building and the inner traffic lane.
  // Four 2.5m-spaced containers form a readable chain without occupying the pavement loop.
  cluster('repair', [
    ['fuelBarrel', -18, -9], ['fuelBarrel', -18, -6.5], ['gasCylinder', -18, -4], ['gasCylinder', -18, -1.5],
    ['crate', -11, -8.5], ['crate', -9, -8.5], ['pallet', -11, -10.5], ['barricade', -18, 2],
    ['cone', -18, -12.5], ['cone', -11, -12], ['dumpster', -11, 0], ['vending', -11, -3.5], ['planter', -8.5, 10],
  ]);
  // Store restocking uses the side yard; its south entrance and parcel route remain clear.
  cluster('store', [
    ['fuelBarrel', 54, -3], ['gasCylinder', 54, -.5], ['fuelBarrel', 54, 2], ['gasCylinder', 54, 4.5],
    ['crate', 56.5, 1], ['crate', 56.5, 4], ['pallet', 56.5, -2], ['pallet', 56.5, 6.5],
    ['cone', 53.5, -8.5], ['barricade', 57, -8.5], ['dumpster', 55, 9], ['vending', 43, -7.5],
    ['planter', 49, -8.5], ['planter', 40.5, -8.5],
  ]);
  // Loading-yard stacks flank the warehouse rather than filling its 4m-wide door.
  cluster('warehouse', [
    ['fuelBarrel', 37.5, 43], ['gasCylinder', 37.5, 45.5],
    ['crate', 54, 43], ['crate', 54, 45], ['crate', 54, 47], ['pallet', 56.5, 44], ['pallet', 56.5, 47],
    ['barricade', 41, 37], ['barricade', 51, 37], ['cone', 40, 38.5], ['cone', 52, 38.5],
    ['dumpster', 54, 50], ['vending', 49.5, 38], ['planter', 43, 36], ['planter', 50, 35],
  ]);
  cluster('garden', [
    ['planter', -8, 43], ['planter', -8, 47], ['planter', 8, 43], ['planter', 8, 49],
    ['crate', -8, 50], ['crate', 8, 46.5], ['pallet', -7.5, 53], ['cone', -7, 38], ['cone', 7, 38],
    ['barricade', -9, 40], ['dumpster', 8, 52.5], ['vending', -8, 45],
  ]);
  return props;
}
