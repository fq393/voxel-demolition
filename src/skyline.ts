// The city round the block: towers and mid-rises on the lots beyond the streets, for scale and
// a skyline behind the tower. Drawn only (one instanced mesh of boxes, a facade shader with
// floors, windows and lights left on). The same box transforms provide the city's solid
// outer-building collision bounds. South and south-west lots stay open for coastal parks.

import { abs, cameraPosition, float, floor, fract, hash, instanceColor, instanceIndex, normalWorld, positionWorld, select, smoothstep, step, varying, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { type City, random } from './world.ts';
import { isDistrictLot } from './district-layout.ts';

/**
 * Lots (block grid cells) left open: the ones the views of the tower are taken from, and a
 * line of parks toward the low evening sun (west-south-west), so it can set over them.
 */
const OPEN = new Set(['0,0', '0,-1', '-1,-1', '1,-1', '-1,0', '-2,-1', '-3,-1', '-3,-2']);
/** How many blocks out the city goes. */
const RINGS = 3;
const STOREY = 3.2;

export function skyline(city: City, seed = 17): THREE.InstancedMesh {
  const rnd = random(seed);
  const block = city.pitch - city.street;
  const boxes: { x: number; y: number; w: number; d: number; h: number; tone: number }[] = [];
  for (let j = -RINGS; j <= RINGS; j++) {
    for (let i = -RINGS; i <= RINGS; i++) {
      if (OPEN.has(`${i},${j}`) || isDistrictLot(i, j)) continue;
      const [cx, cy] = [i * city.pitch, j * city.pitch];
      const ring = Math.max(Math.abs(i), Math.abs(j));
      // A plinth of paving under the lot
      boxes.push({ x: cx, y: cy, w: block, d: block, h: 0.12, tone: -1 });
      // Low next to the block (the tower stands out), taller further out, a few landmark
      // towers at the back (north and east)
      const behind = j >= 0 || i >= 1;
      const [lo, hi] = ring === 1 ? [8, 20] : ring === 2 ? [18, behind ? 60 : 36] : [30, behind ? 110 : 60];
      if (rnd() < (ring === 1 ? 0.15 : 0.45)) {
        const sz = 14 + rnd() * 10;
        const h = (lo + rnd() * (hi - lo)) * (ring === 3 && behind && rnd() < 0.35 ? 1.5 : 1);
        boxes.push({ x: cx + (rnd() - 0.5) * (block - sz - 3), y: cy + (rnd() - 0.5) * (block - sz - 3), w: sz, d: sz * (0.8 + rnd() * 0.4), h, tone: rnd() });
      } else {
        // Two to four smaller blocks round the lot
        for (const [qx, qy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          if (rnd() < 0.3) continue;
          const w = 9 + rnd() * 4;
          const d = 9 + rnd() * 4;
          const h = lo + rnd() * (hi - lo) * 0.7;
          boxes.push({ x: cx + qx * (block / 4 + 0.5), y: cy + qy * (block / 4 + 0.5), w, d, h, tone: rnd() });
        }
      }
    }
  }
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), facade(), boxes.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  // Sun-washed plaster, coral, sage and pale sand, with cooler glass as a separate role.
  // Keep the deterministic layout untouched: these matrices also define solid collision.
  const palette = [0xf1dfbb, 0xdb9f89, 0xa6baa2, 0xe2cbbc, 0x8cabaa, 0xdfc68a];
  boxes.forEach((b, k) => {
    m.makeScale(b.w, b.d, b.h).setPosition(b.x, b.y, b.h / 2);
    mesh.setMatrixAt(k, m);
    mesh.setColorAt(k, b.tone < 0 ? c.setHex(0xb4a48c) : c.setHex(palette[Math.floor(b.tone * palette.length)]));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Facades from world position, two kinds by building: glass curtain walls (glass floor to
 * floor, thin spandrels and mullions, reflecting the sky) and concrete blocks with ribbon
 * windows; a few rooms lit, dimly (it's day); roofs plain.
 */
function facade(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, metalness: 0 });
  const p = varying(positionWorld) as unknown as THREE.Node<'vec3'>;
  const n = varying(normalWorld) as unknown as THREE.Node<'vec3'>;
  const curtain = varying(hash(instanceIndex.add(7))).greaterThan(0.68);
  const roof = n.z.greaterThan(0.5);
  const across = select(abs(n.x).greaterThan(0.5), p.y, p.x);
  const up = p.z.div(STOREY);
  const floorId = floor(up);
  const bay = floor(across.div(1.25));
  const inFloor = fract(up);
  const inBay = fract(across.div(1.25));
  // Curtain wall: glass but for a thin band at each floor and slim mullions; ribbon windows:
  // a band of glass along each floor, mullions every other bay
  const curtainGlass = step(0.18, inFloor).mul(step(0.09, inBay));
  const ribbon = step(0.32, inFloor).mul(step(inFloor, 0.79)).mul(step(0.08, fract(across.div(2.5))));
  const lobby = step(p.z, 3.25).mul(step(0.65, p.z)).mul(step(0.12, fract(across.div(2.5))));
  const glass = select(curtain, curtainGlass, ribbon).max(lobby).mul(select(roof, float(0), float(1))).mul(step(0.4, p.z));
  const isGlass = glass.greaterThan(0.5);
  const room = hash(floorId.mul(131).add(bay.mul(17)).add(floor(p.x.add(p.y).mul(0.1))));
  const lit = step(0.93, room).mul(glass);
  const floorTrim = step(inFloor, 0.065).mul(select(roof, float(0), float(1)));
  const wall = vec3(1).mul(hash(floorId.mul(7).add(floor(across.div(6)))).mul(0.05).add(0.95)).mul(floorTrim.mul(0.055).add(1)).mul(select(roof, float(0.74), float(1)));
  const tint = select(curtain, vec3(0.16, 0.32, 0.34), vec3(0.11, 0.23, 0.26));
  const glassColour = tint.mul(hash(bay.add(floorId.mul(3))).mul(0.4).add(0.8));
  // NodeMaterial multiplies instanceColor after colorNode. Cancel it only on glass, so
  // coral plaster never turns the blue-teal windows brown. All palette values are > 0.
  material.colorNode = select(isGlass, glassColour.div(instanceColor.max(0.03)), wall) as unknown as THREE.Node<'color'>;
  material.roughnessNode = select(isGlass, select(curtain, float(0.16), float(0.23)), float(0.88));
  material.metalnessNode = select(isGlass, select(curtain, float(0.38), float(0.22)), float(0));
  const far = smoothstep(float(60), float(400), p.sub(cameraPosition).length());
  material.emissiveNode = vec3(1.0, 0.74, 0.46).mul(lit).mul(far.mul(0.3).add(0.35)).add(vec3(0.022, 0.04, 0.045).mul(glass)) as unknown as THREE.Node<'color'>;
  return material;
}
