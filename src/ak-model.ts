/** An original procedural AK-style game prop. Camera coordinates: +X right, +Y up, -Z forward. */
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Named sockets and silhouette parts are stable integration points for the viewmodel. */
export function buildAKModel(): THREE.Group {
  const root = new THREE.Group(); root.name = 'AK47';
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x303633, metalness: .72, roughness: .46 });
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x171d19, metalness: .35, roughness: .69 });
  const wood = new THREE.MeshStandardNodeMaterial({ color: 0x9a6136, metalness: 0, roughness: .74 });
  const lightWood = new THREE.MeshStandardNodeMaterial({ color: 0xb27642, metalness: 0, roughness: .68 });
  const box = new RoundedBoxGeometry(1, 1, 1, 1, .035);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const ring = new THREE.TorusGeometry(1, .18, 4, 12);
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
    position: readonly [number, number, number], scale: readonly [number, number, number], rotation: readonly [number, number, number] = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.set(...position); mesh.scale.set(...scale); mesh.rotation.set(...rotation);
    mesh.castShadow = false; root.add(mesh); return mesh;
  };
  const profile = (shape: THREE.Shape, thickness: number) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, steps: 1, bevelEnabled: true,
      bevelSize: .002, bevelThickness: .002, bevelSegments: 1, curveSegments: 6 });
    geometry.translate(0, 0, -thickness / 2); geometry.rotateY(-Math.PI / 2); return geometry;
  };
  add('rifle-receiver', box, steel, [0, .065, -.105], [.074, .108, .315]);
  add('rifle-dust-cover', cylinder, dark, [0, .12, -.107], [.040, .293, .020], [Math.PI / 2, 0, 0]);
  const stockShape = new THREE.Shape();
  stockShape.moveTo(.045, .065); stockShape.lineTo(.115, .06); stockShape.lineTo(.276, -.018);
  stockShape.lineTo(.276, -.15); stockShape.lineTo(.156, -.13); stockShape.lineTo(.045, -.024); stockShape.closePath();
  add('rifle-stock', profile(stockShape, .073), wood, [0, 0, 0], [1, 1, 1]);
  add('rifle-butt-plate', box, dark, [0, -.084, .277], [.082, .135, .016]);
  add('rifle-grip', box, wood, [0, -.083, .023], [.052, .151, .061], [-.29, 0, 0]);
  add('rifle-lower-handguard', box, lightWood, [0, .054, -.376], [.077, .068, .225]);
  add('rifle-upper-handguard', box, wood, [0, .112, -.369], [.057, .043, .151]);
  add('rifle-barrel', cylinder, steel, [0, .068, -.620], [.012, .321, .012], [Math.PI / 2, 0, 0]);
  add('rifle-gas-tube', cylinder, steel, [0, .116, -.508], [.010, .146, .010], [Math.PI / 2, 0, 0]);
  add('rifle-gas-block', cylinder, steel, [0, .088, -.565], [.023, .041, .026], [Math.PI / 2, 0, 0]);
  add('rifle-muzzle-brake', cylinder, dark, [0, .068, -.793], [.017, .038, .017], [Math.PI / 2, 0, 0]);
  add('rifle-muzzle-rim', ring, steel, [0, .068, -.813], [.016, .016, .014]);
  add('rifle-front-sight-post', box, steel, [0, .107, -.717], [.025, .086, .029]);
  add('rifle-front-sight', ring, dark, [0, .153, -.717], [.020, .020, .012]);
  add('rifle-rear-sight-block', box, steel, [0, .139, -.242], [.045, .025, .049]);
  add('rifle-rear-sight', box, dark, [0, .161, -.237], [.044, .014, .028]);
  // The curved magazine is a continuous extruded silhouette, not a tilted rectangular box.
  const magazine = new THREE.Shape();
  magazine.moveTo(-.076, -.012); magazine.lineTo(-.074, -.10);
  magazine.quadraticCurveTo(-.077, -.252, -.185, -.341);
  magazine.lineTo(-.254, -.314); magazine.quadraticCurveTo(-.177, -.208, -.145, -.065);
  magazine.lineTo(-.145, -.012); magazine.closePath();
  add('rifle-magazine', profile(magazine, .053), dark, [0, 0, 0], [1, 1, 1]);
  const ribCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.029, -.045, -.101), new THREE.Vector3(-.029, -.128, -.111),
    new THREE.Vector3(-.029, -.22, -.157), new THREE.Vector3(-.029, -.307, -.210),
  ]);
  const ribGeometry = new THREE.TubeGeometry(ribCurve, 8, .0022, 4, false);
  for (let i = 0; i < 3; i++) add(`rifle-magazine-rib-${i + 1}`, ribGeometry, steel, [0, 0, (i - 1) * .015], [1, 1, 1]);
  add('rifle-trigger-guard', ring, steel, [0, -.066, -.029], [.036, .053, .020], [0, Math.PI / 2, 0]);
  add('rifle-trigger', box, dark, [0, -.063, -.030], [.013, .033, .012], [.28, 0, 0]);
  add('rifle-charging-handle', box, steel, [.047, .078, -.086], [.045, .022, .026]);
  add('rifle-sling-loop', ring, dark, [.044, .063, .039], [.012, .018, .010], [0, Math.PI / 2, 0]);

  const muzzle = new THREE.Object3D(); muzzle.name = 'rifle-muzzle'; muzzle.position.set(0, .068, -.823); root.add(muzzle);
  // One reusable, unlit flash. Its shape projects forward and carries a pointed star silhouette.
  const vertices: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, next = (i + 1) * Math.PI / 4;
    const r = i % 2 ? .018 : .047, nr = (i + 1) % 2 ? .018 : .047;
    vertices.push(0, 0, -.045, Math.cos(a) * r, Math.sin(a) * r, 0, Math.cos(next) * nr, Math.sin(next) * nr, 0);
  }
  const flashGeometry = new THREE.BufferGeometry(); flashGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  flashGeometry.computeVertexNormals();
  const flashMaterial = new THREE.MeshBasicNodeMaterial({ color: 0xffd69a, side: THREE.DoubleSide, depthWrite: false });
  const flash = new THREE.Mesh(flashGeometry, flashMaterial); flash.name = 'rifle-flash'; flash.visible = false; flash.castShadow = false;
  muzzle.add(flash);
  return root;
}
