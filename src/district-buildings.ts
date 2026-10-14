/** Three small, hollow voxel buildings. Their doors, stair voids and furniture are geometry,
 * not teleport triggers or collision exceptions, so the existing player/destruction paths apply. */
import { Mat, M, VOXEL, type WorldBuilder } from './world.ts';
import type { DistrictBuilding, DistrictFurniture, DistrictPoint } from './district-layout.ts';

type Put = Parameters<Parameters<WorldBuilder['place']>[5]>[0];
const C = {
  cream: 0xe1cfac, trim: 0xf0e2c9, coral: 0xc67d65, sage: 0x7b9680,
  wood: 0xa77a4c, darkWood: 0x72583f, tile: 0xd7c4a0, tileDark: 0xc9b394,
  glass: 0x739398, iron: 0x64706b, roof: 0xb7785d, cushion: 0xb88672,
};

/** Distinct props get distinct objects and base anchors, including props on the upper floor.
 * Their support is local to the prop: breaking a shelf does not mark the whole shop damaged. */
function prop(w: WorldBuilder, id: string, name: string, x: number, y: number,
  width: number, depth: number, base: number, height: number, fill: (put: Put) => void): DistrictFurniture {
  w.place(Math.round(x * M), Math.round(y * M), width, depth, base + height, fill, (_x, _y, z) => z === base);
  const object = w.count - 1;
  const initial = w.last().cells.reduce((n, v) => n + Number(v >= 0), 0);
  return { id, name, object, initial, at: [x + width * VOXEL / 2, y + depth * VOXEL / 2, (base + height / 2) * VOXEL] };
}

function shelf(w: WorldBuilder, id: string, x: number, y: number, base: number,
  wide = 10, deep = 4, tall = 8): DistrictFurniture {
  return prop(w, id, '陈列货架', x, y, wide, deep, base, tall, put => {
    for (const sx of [0, wide - 1]) for (const sy of [0, deep - 1])
      w.box(put, sx, sy, base, sx + 1, sy + 1, base + tall, Mat.Steel, C.iron);
    for (const z of [base, base + 3, base + 6]) {
      w.box(put, 0, 0, z, wide, deep, z + 1, Mat.Wood, C.wood);
      for (let x = 1; x < wide - 1; x += 3)
        w.box(put, x, 1, z + 1, Math.min(x + 2, wide - 1), deep - 1, z + 3, Mat.Plaster,
          [0xd6ae63, 0x91a581, 0xc38b73][Math.floor(x / 3) % 3]);
    }
  });
}

function crate(w: WorldBuilder, id: string, x: number, y: number, wide: number, deep: number,
  base: number, tall: number): DistrictFurniture {
  return prop(w, id, '旧木箱', x, y, wide, deep, base, tall, put => {
    for (let z = base; z < base + tall; z++) for (let j = 0; j < deep; j++) for (let i = 0; i < wide; i++) {
      if (z !== base && z !== base + tall - 1 && i !== 0 && i !== wide - 1 && j !== 0 && j !== deep - 1) continue;
      const brace = i === 1 || i === wide - 2 || j === 1 || j === deep - 2 || z === base + 1 || z === base + tall - 2;
      put(i, j, z, Mat.Wood, brace ? C.darkWood : C.wood);
    }
  });
}

function floor(put: Put, wide: number, deep: number, z: number,
  skip?: (x: number, y: number) => boolean): void {
  for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
    if (!skip?.(x, y)) put(x, y, z, Mat.Concrete, (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? C.tile : C.tileDark);
  }
}

function store(w: WorldBuilder): DistrictBuilding {
  const x0 = 41, y0 = -4.5, wide = 40, deep = 36, roof = 14;
  w.place(x0 * M, y0 * M, wide, deep, 16, put => {
    // Put finish details first: WorldBuilder keeps the first material assigned to a cell.
    w.box(put, 18, 0, 12, 22, 1, 14, Mat.Trim, C.trim);
    for (let x = 0; x < wide; x++) put(x, 0, 13, Mat.Trim, Math.floor(x / 2) % 2 ? C.trim : C.coral);
    w.box(put, 2, 0, 11, 38, 1, 14, Mat.Wood, C.sage);
    for (const x of [15, 24]) w.box(put, x, 0, 1, x + 1, 1, 12, Mat.Trim, C.trim);
    floor(put, wide, deep, 0);
    floor(put, wide, deep, roof);
    for (let z = 1; z < roof; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
      if (x !== 0 && x !== wide - 1 && y !== 0 && y !== deep - 1) continue;
      if (y === 0 && x >= 16 && x < 24 && z < 11) continue; // 2m × 2.5m open entrance.
      const shopGlass = y === 0 && z >= 3 && z < 10 && ((x >= 3 && x < 14) || (x >= 26 && x < 37));
      const sideGlass = x === wide - 1 && y >= 10 && y < 25 && z >= 5 && z < 10;
      put(x, y, z, shopGlass || sideGlass ? Mat.Glass : Mat.Plaster,
        shopGlass || sideGlass ? C.glass : z <= 2 ? C.coral : C.cream);
    }
    for (let x = 0; x < wide; x++) for (let y = 0; y < deep; y++)
      if (x === 0 || y === 0 || x === wide - 1 || y === deep - 1) put(x, y, 15, Mat.Roof, C.roof);
  });
  const object = w.count - 1;
  const furniture: DistrictFurniture[] = [
    shelf(w, 'store-shelf-west', 42, -1.5, 1),
    shelf(w, 'store-shelf-east', 48, -1, 1),
    prop(w, 'store-counter', '木柜台与包裹', 42.5, 2, 10, 5, 1, 6, put => {
      w.box(put, 0, 0, 1, 10, 5, 5, Mat.Wood, C.darkWood);
      w.box(put, 0, 0, 5, 10, 5, 6, Mat.Trim, C.trim);
      w.box(put, 1, 1, 6, 5, 4, 7, Mat.Wood, 0xc79b65);
      w.box(put, 7, 1, 6, 9, 3, 7, Mat.Steel, C.iron);
    }),
    prop(w, 'store-cooler', '冷藏展示柜', 48.5, 2, 5, 6, 1, 9, put => {
      w.box(put, 0, 0, 1, 5, 6, 2, Mat.Steel, C.iron);
      for (let z = 2; z < 10; z++) for (let y = 0; y < 6; y++) for (let x = 0; x < 5; x++) {
        if (x === 0 || x === 4 || y === 5 || z === 9) put(x, y, z, Mat.Trim, C.trim);
        else if (y === 0) put(x, y, z, Mat.Glass, C.glass);
      }
      for (const z of [4, 7]) w.box(put, 1, 1, z, 4, 5, z + 1, Mat.Steel, C.iron);
    }),
  ];
  return { id: 'store', name: '街角便利店', object,
    bounds: { minX: x0, maxX: x0 + wide * VOXEL, minY: y0, maxY: y0 + deep * VOXEL, maxZ: 4 },
    entrance: [46, -4, 0.25], target: [46, 2, 0.25], furniture };
}

function home(w: WorldBuilder): DistrictBuilding {
  const x0 = -5, y0 = 41, wide = 40, deep = 40, upper = 12, roof = 26;
  // Twelve 0.25m rises, 0.5m treads: 1.5m clear width, a continuous 6m run northwards.
  const stairX = 4, stairY = 5, stairWidth = 6, treads = 12;
  const stairHole = (x: number, y: number) => x >= stairX - 1 && x < stairX + stairWidth + 1 && y >= stairY - 1 && y < stairY + treads * 2;
  w.place(x0 * M, y0 * M, wide, deep, 29, put => {
    for (const x of [15, 24]) w.box(put, x, 0, 1, x + 1, 1, 12, Mat.Trim, C.trim);
    w.box(put, 1, 0, 23, wide - 1, 1, 24, Mat.Wood, C.sage);
    floor(put, wide, deep, 0);
    floor(put, wide, deep, upper, stairHole);
    w.box(put, 0, 0, roof, wide, deep, roof + 1, Mat.Roof, C.roof);
    for (let z = 1; z < roof; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
      if (x !== 0 && x !== wide - 1 && y !== 0 && y !== deep - 1) continue;
      if (y === 0 && x >= 16 && x < 24 && z < 11) continue;
      const windowZ = (z >= 5 && z < 10) || (z >= 17 && z < 22);
      const frontWindow = y === 0 && windowZ && ((x >= 4 && x < 12) || (x >= 28 && x < 36));
      const rearWindow = y === deep - 1 && windowZ && ((x >= 15 && x < 23) || (x >= 28 && x < 36));
      const sideWindow = x === wide - 1 && windowZ && ((y >= 8 && y < 16) || (y >= 25 && y < 33));
      put(x, y, z, frontWindow || rearWindow || sideWindow ? Mat.Glass : Mat.Plaster,
        frontWindow || rearWindow || sideWindow ? C.glass : z === upper || z < 3 ? C.coral : C.cream);
    }
    for (let n = 0; n < treads; n++) {
      const y = stairY + n * 2, top = n + 2;
      w.box(put, stairX, y, 1, stairX + stairWidth, y + 2, top, Mat.Wood, C.wood);
      // Thin rails stay outside the walking corridor; each rise is still one voxel.
      for (const x of [stairX - 1, stairX + stairWidth]) {
        w.box(put, x, y, 1, x + 1, y + 1, top + 3, Mat.Wood, C.darkWood);
        w.box(put, x, y, top + 2, x + 1, y + 2, top + 3, Mat.Wood, C.darkWood);
      }
    }
    // Upper room partition, with a proper 2m-wide opening from the landing.
    for (let z = upper + 1; z < roof; z++) for (let x = 11; x < wide - 1; x++)
      if (!(x >= 15 && x < 23 && z < upper + 11)) put(x, 27, z, Mat.Plaster, C.trim);
    // Flat base supports a shallow terracotta stepped roof silhouette.
    for (let inset = 0; inset < 2; inset++) {
      const z = roof + 1 + inset;
      for (let y = inset + 1; y < deep - inset - 1; y++) for (let x = inset + 1; x < wide - inset - 1; x++)
        if (x <= 2 || x >= wide - 3 || y <= 2 || y >= deep - 3)
          put(x, y, z, Mat.Roof, C.roof);
    }
  });
  const object = w.count - 1;
  const furniture: DistrictFurniture[] = [
    prop(w, 'home-sofa', '珊瑚色沙发', 0.5, 42.5, 12, 6, 1, 5, put => {
      for (const x of [0, 11]) for (const y of [0, 5]) w.box(put, x, y, 1, x + 1, y + 1, 3, Mat.Wood, C.darkWood);
      w.box(put, 0, 0, 3, 12, 6, 4, Mat.Wood, C.cushion);
      w.box(put, 0, 5, 4, 12, 6, 6, Mat.Plaster, C.cushion);
      for (const x of [0, 11]) w.box(put, x, 0, 4, x + 1, 5, 5, Mat.Plaster, C.cushion);
      for (const x of [1, 5, 9]) w.box(put, x, 1, 4, Math.min(x + 3, 11), 5, 5, Mat.Plaster, 0xc6957f);
    }),
    prop(w, 'home-table', '木茶几', 1, 45, 8, 5, 1, 3, put => {
      for (const x of [0, 7]) for (const y of [0, 4]) w.box(put, x, y, 1, x + 1, y + 1, 3, Mat.Wood, C.darkWood);
      w.box(put, 0, 0, 3, 8, 5, 4, Mat.Wood, C.wood);
    }),
    prop(w, 'home-bed', '二楼木床', 1, 44.75, 12, 9, upper + 1, 5, put => {
      for (const x of [0, 11]) for (const y of [0, 8]) w.box(put, x, y, upper + 1, x + 1, y + 1, upper + 3, Mat.Wood, C.darkWood);
      w.box(put, 0, 0, upper + 3, 12, 9, upper + 4, Mat.Wood, C.wood);
      w.box(put, 1, 1, upper + 4, 11, 8, upper + 5, Mat.Plaster, C.sage);
      w.box(put, 0, 8, upper + 4, 12, 9, upper + 6, Mat.Wood, C.darkWood);
      for (const x of [2, 7]) w.box(put, x, 6, upper + 5, x + 3, 8, upper + 6, Mat.Plaster, C.trim);
    }),
    prop(w, 'home-cabinet', '二楼书柜', 2.5, 49.5, 7, 3, upper + 1, 7, put => {
      w.box(put, 0, 0, upper + 1, 7, 3, upper + 2, Mat.Wood, C.darkWood);
      for (const x of [0, 6]) w.box(put, x, 0, upper + 2, x + 1, 3, upper + 8, Mat.Wood, C.darkWood);
      w.box(put, 0, 2, upper + 2, 7, 3, upper + 8, Mat.Wood, C.darkWood);
      for (const z of [upper + 4, upper + 7]) w.box(put, 1, 0, z, 6, 2, z + 1, Mat.Wood, C.wood);
    }),
  ];
  const stairXWorld = x0 + (stairX + stairWidth / 2) * VOXEL;
  const stairs: DistrictPoint[] = [
    [0, 42, 0.25], [stairXWorld, 41.65, 0.25],
    // Place feet toward the front of each tread: the 0.6m player is wider than a 0.5m
    // tread, so its centre would already overlap (and stand on) the following rise.
    ...Array.from({ length: treads }, (_, n): DistrictPoint => [stairXWorld, y0 + (stairY + n * 2 + 0.32) * VOXEL, (n + 2) * VOXEL]),
    [stairXWorld, 49, 3.25], [0, 49, 3.25],
  ];
  return { id: 'home', name: '暖色双层住宅', object,
    bounds: { minX: x0, maxX: x0 + wide * VOXEL, minY: y0, maxY: y0 + deep * VOXEL, maxZ: 7.25 },
    entrance: [0, 41.5, 0.25], target: [1.5, 49, 3.25], furniture, stairs };
}

function warehouse(w: WorldBuilder): DistrictBuilding {
  const x0 = 40, y0 = 40.5, wide = 48, deep = 44, roof = 16;
  w.place(x0 * M, y0 * M, wide, deep, 18, put => {
    w.box(put, 16, 0, 13, 32, 1, 16, Mat.Steel, C.sage);
    for (const x of [15, 32]) w.box(put, x, 0, 1, x + 1, 1, roof, Mat.Trim, C.trim);
    floor(put, wide, deep, 0);
    floor(put, wide, deep, roof);
    for (let z = 1; z < roof; z++) for (let y = 0; y < deep; y++) for (let x = 0; x < wide; x++) {
      if (x !== 0 && x !== wide - 1 && y !== 0 && y !== deep - 1) continue;
      if (y === 0 && x >= 16 && x < 32 && z < 13) continue; // Raised loading door, 4m × 3m opening.
      const window = z >= 9 && z < 13 && (x === 0 || x === wide - 1) && y >= 13 && y < 32;
      put(x, y, z, window ? Mat.Glass : z < 4 ? Mat.Brick : Mat.Plaster,
        window ? C.glass : z < 4 ? C.coral : C.cream);
    }
    for (let x = 0; x < wide; x++) for (let y = 0; y < deep; y++)
      if (x === 0 || x === wide - 1 || y === 0 || y === deep - 1) put(x, y, 17, Mat.Roof, C.iron);
    // Corner piers and narrow steel band, rather than a featureless cuboid.
    for (const x of [0, wide - 1]) for (const y of [0, deep - 1])
      w.box(put, x === 0 ? 0 : wide - 2, y === 0 ? 0 : deep - 2, 1, x === 0 ? 2 : wide, y === 0 ? 2 : deep, roof, Mat.Trim, C.trim);
  });
  const object = w.count - 1;
  const furniture: DistrictFurniture[] = [
    crate(w, 'warehouse-crate-a', 42, 44, 6, 6, 1, 6),
    crate(w, 'warehouse-crate-b', 43.75, 44.25, 5, 5, 1, 5),
    crate(w, 'warehouse-crate-c', 42.5, 46, 7, 5, 1, 6),
    shelf(w, 'warehouse-rack-east', 49.5, 44.5, 1, 5, 12, 9),
    shelf(w, 'warehouse-rack-north', 45, 49, 1, 14, 4, 9),
  ];
  return { id: 'warehouse', name: '旧货仓库', object,
    bounds: { minX: x0, maxX: x0 + wide * VOXEL, minY: y0, maxY: y0 + deep * VOXEL, maxZ: 4.5 },
    entrance: [46, 41, 0.25], target: [46, 45.5, 0.25], furniture };
}

export function buildDistrict(w: WorldBuilder): DistrictBuilding[] {
  return [store(w), home(w), warehouse(w)];
}
