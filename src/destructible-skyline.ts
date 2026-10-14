import * as THREE from 'three/webgpu';
import { facade } from './skyline.ts';
import { overlapsPlayer, overlapsVehicle, type StaticBox } from './city-colliders.ts';
import type { DamageTarget, WorldDamageRequest, WorldDamageEvent } from './world-damage-types.ts';

const HP = 120;
const DEBRIS = 96;
const EPS = 1e-7;
type Building = { box: StaticBox; source: number; nx: number; ny: number; nz: number; dx: number; dy: number; dz: number; hp: Uint8Array; color: THREE.Color; split: boolean; collapsed: boolean };
type Debris = { x: number; y: number; z: number; vz: number; vx: number; vy: number; spin: number; angle: number; size: number; scale: [number,number,number]; age: number; life: number; tint: number };
export interface SkylineSnapshot { version: 1; layout: string; buildings: { id: number; collapsed: boolean; cells: [number, number][] }[] }

/** CPU grid occupancy and GPU shared facade batches describe exactly the same holes.
 * Healthy towers retain their original matrix and original one-batch rendering. A damaged
 * tower renders only exposed cells, including newly revealed interior faces. No AVBD bodies
 * are added and the original city's voxel layout is unchanged. Fallen chips are temporary
 * visual debris; collapse removes its obstruction immediately instead of leaving ghost boxes.
 */
export class DestructibleSkyline {
  readonly object = new THREE.Group();
  readonly bounds: StaticBox[] = [];
  private buildings: Building[] = [];
  private matrices: THREE.Matrix4[] = [];
  private source: THREE.InstancedMesh;
  private pieces: THREE.InstancedMesh;
  private fragments: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private readonly layout: string;
  private dirty = false;
  private stateRevision = 0;
  private disposed = false;
  private visibleCells = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private readonly fragmentMaterial = new THREE.MeshStandardNodeMaterial({ roughness: .94, color: 0xffffff });

  constructor(source: THREE.InstancedMesh) {
    this.source = source;
    source.updateWorldMatrix(true, false);
    for (let i = 0; i < source.count; i++) {
      source.getMatrixAt(i, this.matrix);
      this.matrices.push(this.matrix.clone());
      const m = new THREE.Matrix4().multiplyMatrices(source.matrixWorld, this.matrix).elements;
      const hx = (Math.abs(m[0]) + Math.abs(m[4]) + Math.abs(m[8])) / 2;
      const hy = (Math.abs(m[1]) + Math.abs(m[5]) + Math.abs(m[9])) / 2;
      const hz = (Math.abs(m[2]) + Math.abs(m[6]) + Math.abs(m[10])) / 2;
      if (hz <= .1) continue; // Paving is always walkable, not a building target.
      const box = { minX:m[12]-hx,maxX:m[12]+hx,minY:m[13]-hy,maxY:m[13]+hy,minZ:m[14]-hz,maxZ:m[14]+hz };
      const nx = Math.ceil(hx * 2 / 2.5-1e-6), ny = Math.ceil(hy * 2 / 2.5-1e-6), nz = Math.ceil(hz * 2 / 3.2-1e-6);
      const color = new THREE.Color(0xf1dfbb);
      if (source.instanceColor) source.getColorAt(i, color);
      this.buildings.push({ box,source:i,nx,ny,nz,dx:2*hx/nx,dy:2*hy/ny,dz:2*hz/nz,hp:new Uint8Array(nx*ny*nz).fill(HP),color,split:false,collapsed:false });
      this.bounds.push(box);
    }
    // A deterministic fingerprint includes transforms and subdivision. Reject another city.
    let hash = 2166136261;
    for (const b of this.buildings) for (const v of [b.source,...Object.values(b.box),b.nx,b.ny,b.nz]) {
      const text = v.toFixed(5);
      for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
    }
    this.layout = `sky-1-${this.buildings.length}-${(hash>>>0).toString(16)}`;
    const capacity = this.buildings.reduce((sum,b)=>sum+b.hp.length,0);
    const geometry = new THREE.BoxGeometry(1,1,1);
    geometry.setAttribute('facadeIndex',new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage));
    this.pieces = new THREE.InstancedMesh(geometry,facade(true),capacity);
    this.pieces.name = 'damagedSkylineCells';
    this.pieces.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity*3).fill(1),3).setUsage(THREE.DynamicDrawUsage);
    this.pieces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pieces.count = 0;
    this.pieces.frustumCulled = false;
    this.pieces.castShadow = this.pieces.receiveShadow = true;
    this.fragments = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),this.fragmentMaterial,DEBRIS);
    this.fragments.name = 'boundedSkylineRubble';
    this.fragments.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS*3).fill(1),3).setUsage(THREE.DynamicDrawUsage);
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragments.count = 0;
    this.fragments.frustumCulled = false;
    this.fragments.castShadow = false;
    this.fragments.receiveShadow = true;
    this.object.name = 'destructibleWarmSkyline';
    this.object.add(source,this.pieces,this.fragments);
  }

  get revision():number {return this.stateRevision;}

  /** Landmark bounds only; physics always uses cell occupancy. */
  get activeBounds():readonly StaticBox[] {return this.buildings.filter(b=>!b.collapsed).map(b=>b.box);}

  get diagnostics() {
    return { buildings:this.buildings.length,cells:this.buildings.reduce((s,b)=>s+b.hp.length,0),damagedBuildings:this.buildings.filter(b=>b.split).length,
      collapsedBuildings:this.buildings.filter(b=>b.collapsed).length,missingCells:this.buildings.reduce((s,b)=>s+b.hp.reduce((n,h)=>n+(h===0?1:0),0),0),
      visibleCells:this.visibleCells,debris:this.debris.length,debrisCapacity:DEBRIS,drawCalls:1+(this.pieces.count?1:0)+(this.fragments.count?1:0),
      geometries:3,materials:3,layout:this.layout };
  }

  rayHit(origin:ArrayLike<number>,direction:ArrayLike<number>,reach:number):DamageTarget|null {
    if (!validPoint(origin)||!validPoint(direction)||!(reach>=0)||!Number.isFinite(reach)) return null;
    let best: DamageTarget|null = null;
    for (let bi=0;bi<this.buildings.length;bi++) {
      const b=this.buildings[bi];
      if (b.collapsed) continue;
      const broad=slab(b.box,origin,direction,best?.t??reach);
      if (!broad) continue;
      // Grid traversal crosses each intervening cell once, including empty cells.
      let t=broad.t;
      let normal=broad.normal;
      for(let steps=0;steps<=b.nx+b.ny+b.nz+3;steps++) {
        const px=origin[0]+direction[0]*(t+EPS),py=origin[1]+direction[1]*(t+EPS),pz=origin[2]+direction[2]*(t+EPS);
        const ix=Math.min(b.nx-1,Math.max(0,Math.floor((px-b.box.minX)/b.dx)));
        const iy=Math.min(b.ny-1,Math.max(0,Math.floor((py-b.box.minY)/b.dy)));
        const iz=Math.min(b.nz-1,Math.max(0,Math.floor((pz-b.box.minZ)/b.dz)));
        const cell=ix+b.nx*(iy+b.ny*iz);
        if (b.hp[cell]) { best={id:`skyline:${bi}:${cell}`,kind:'building',t,normal}; break; }
        let next=Infinity,axis=-1;
        for(let a=0;a<3;a++) {
          if(direction[a]===0) continue;
          const idx=[ix,iy,iz][a],width=[b.dx,b.dy,b.dz][a],min=[b.box.minX,b.box.minY,b.box.minZ][a];
          const nt=(min+(idx+(direction[a]>0?1:0))*width-origin[a])/direction[a];
          if(nt>t+EPS*.1&&nt<next) { next=nt;axis=a; }
        }
        if(axis<0||next>broad.far+EPS||next>(best?.t??reach)) break;
        t=next;
        const n:[number,number,number]=[0,0,0];n[axis]=direction[axis]>0?-1:1;normal=n;
        const x=origin[0]+direction[0]*(t+EPS),y=origin[1]+direction[1]*(t+EPS),z=origin[2]+direction[2]*(t+EPS);
        if(x<b.box.minX-EPS*.1||x>b.box.maxX+EPS*.1||y<b.box.minY-EPS*.1||y>b.box.maxY+EPS*.1||z<b.box.minZ-EPS*.1||z>b.box.maxZ+EPS*.1) break;
      }
    }
    return best;
  }

  damage(req:WorldDamageRequest):WorldDamageEvent[] {
    if(!validPoint(req.at)||!Number.isFinite(req.radius)||req.radius<0||!Number.isFinite(req.amount)||req.amount<=0) return [];
    const target = req.directId?.match(/^skyline:(\d+):(\d+)$/);
    const targeted=target?{b:Number(target[1]),c:Number(target[2])}:null;
    const events:WorldDamageEvent[]=[];
    for(let bi=0;bi<this.buildings.length;bi++) {
      const b=this.buildings[bi];
      if(b.collapsed) continue;
      const direct=targeted?.b===bi&&targeted.c<b.hp.length;
      if(!direct && (req.radius===0||distanceBox(req.at,b.box)>req.radius)) continue;
      let changed=0,removed=0;
      for(const cell of this.cellsIn(b,req.at[0]-req.radius,req.at[0]+req.radius,req.at[1]-req.radius,req.at[1]+req.radius,req.at[2]-req.radius,req.at[2]+req.radius,direct?targeted!.c:undefined)) {
        if(!b.hp[cell]) continue;
        const box=this.cellBox(b,cell);
        const isDirect=direct&&cell===targeted!.c;
        if(!isDirect&&(req.radius===0||distanceBox(req.at,box)>req.radius)) continue;
        const factor=isDirect?1:Math.max(.25,1-distanceBox(req.at,box)/Math.max(.01,req.radius)*.65);
        const old=b.hp[cell]; b.hp[cell]=Math.max(0,old-Math.max(1,Math.ceil(req.amount*factor)));
        if(old!==b.hp[cell]) changed++;
        if(old&&b.hp[cell]===0) { removed++;this.emitDebris(b,box,req.impulse,cell); }
      }
      if(!changed) continue;
      b.split=true;
      if(removed&&this.unsupported(b)) {
        b.collapsed=true;
        // Even simultaneous city-wide demolition retains a bounded animated pool.
        for(let i=0;i<12;i++) {
          const cell=(i*104729+17)%b.hp.length;
          if(b.hp[cell]) this.emitDebris(b,this.cellBox(b,cell),req.impulse,cell,true);
        }
        b.hp.fill(0);
      }
      this.source.setMatrixAt(b.source,this.matrix.makeScale(0,0,0));
      this.source.instanceMatrix.needsUpdate=true;
      this.dirty=true;this.stateRevision++;
      events.push({id:`skyline:${bi}:${direct?targeted!.c:0}`,kind:'building',at:req.at,tint:b.color.getHex(),destroyed:b.collapsed,parts:removed+(b.collapsed?12:0)});
    }
    return events;
  }

  blocksPlayer(x:number,y:number,z:number,height:number):boolean {
    if(!Number.isFinite(x+y+z+height)||height<=0) return false;
    for(const b of this.buildings) {
      if(b.collapsed||!overlapsPlayer([b.box],x,y,z,height)) continue;
      if(!b.split) return true;
      for(const c of this.cellsIn(b,x-.3,x+.3,y-.3,y+.3,z,z+height)) if(b.hp[c]&&overlapsPlayer([this.cellBox(b,c)],x,y,z,height)) return true;
    }
    return false;
  }

  blocksCar(x:number,y:number,heading:number,size:readonly number[]):boolean {
    const halfLength=(size[0]??4.6)/2,halfWidth=(size[1]??2)/2,height=size[2]??1.35;
    if(!Number.isFinite(x+y+heading+halfLength+halfWidth+height)||halfLength<=0||halfWidth<=0) return false;
    const ex=Math.abs(Math.cos(heading))*halfLength+Math.abs(Math.sin(heading))*halfWidth;
    const ey=Math.abs(Math.sin(heading))*halfLength+Math.abs(Math.cos(heading))*halfWidth;
    for(const b of this.buildings) {
      if(b.collapsed||!overlapsVehicle([b.box],x,y,heading,halfLength,halfWidth,height)) continue;
      if(!b.split) return true;
      for(const c of this.cellsIn(b,x-ex,x+ex,y-ey,y+ey,0,height)) if(b.hp[c]&&overlapsVehicle([this.cellBox(b,c)],x,y,heading,halfLength,halfWidth,height)) return true;
    }
    return false;
  }

  /** Decorations use a point just inside their owning facade/roof, not an immutable box. */
  surfacePresent(x:number,y:number,z:number):boolean {
    if(!Number.isFinite(x+y+z)) return false;
    for(const b of this.buildings) {
      if(b.collapsed||x<b.box.minX-EPS||x>b.box.maxX+EPS||y<b.box.minY-EPS||y>b.box.maxY+EPS||z<b.box.minZ-EPS||z>b.box.maxZ+EPS) continue;
      const ix=Math.min(b.nx-1,Math.max(0,Math.floor((x-b.box.minX)/b.dx))),iy=Math.min(b.ny-1,Math.max(0,Math.floor((y-b.box.minY)/b.dy))),iz=Math.min(b.nz-1,Math.max(0,Math.floor((z-b.box.minZ)/b.dz)));
      if(b.hp[ix+b.nx*(iy+b.ny*iz)])return true;
    }
    return false;
  }

  update(dt:number):void {
    if(this.dirty) this.syncCells();
    if(!(dt>0)||!Number.isFinite(dt)) return;
    const step=Math.min(dt,.1);
    this.debris=this.debris.filter(d=> {
      d.age+=step; if(d.age>=d.life) return false;
      if(d.z>d.scale[2]/2) { d.vz-=9.8*step;d.z=Math.max(d.scale[2]/2,d.z+d.vz*step);d.x+=d.vx*step;d.y+=d.vy*step;d.angle+=d.spin*step; }
      return true;
    });
    const transform=new THREE.Object3D();
    this.debris.forEach((d,i)=> {
      const fade=Math.min(1,(d.life-d.age)/.4);
      transform.position.set(d.x,d.y,d.z);transform.rotation.set(d.angle,d.angle*.6,d.angle*.3);transform.scale.set(d.scale[0]*fade,d.scale[1]*fade,d.scale[2]*fade);transform.updateMatrix();
      this.fragments.setMatrixAt(i,transform.matrix);this.fragments.setColorAt(i,this.color.setHex(d.tint));
    });
    this.fragments.count=this.debris.length;
    this.fragments.instanceMatrix.needsUpdate=true;
    if(this.fragments.instanceColor)this.fragments.instanceColor.needsUpdate=true;
  }

  snapshot():SkylineSnapshot {
    return {version:1,layout:this.layout,buildings:this.buildings.flatMap((b,id)=>!b.split?[]:[{id,collapsed:b.collapsed,cells:b.collapsed?[]:Array.from(b.hp).flatMap((hp,c)=>hp===HP?[]:[[c,hp] as [number,number]])}])};
  }

  restore(value:unknown):boolean {
    if(!isRecord(value)||Object.keys(value).sort().join(',')!=='buildings,layout,version'||value.version!==1||value.layout!==this.layout||!Array.isArray(value.buildings)||value.buildings.length>this.buildings.length) return false;
    const validated:{id:number;collapsed:boolean;cells:[number,number][]}[]=[];
    let last=-1;
    for(const row of value.buildings) {
      if(!isRecord(row)||Object.keys(row).sort().join(',')!=='cells,collapsed,id'||!Number.isInteger(row.id)||Number(row.id)<=last||Number(row.id)>=this.buildings.length||typeof row.collapsed!=='boolean'||!Array.isArray(row.cells)) return false;
      const id=Number(row.id);last=id;
      if(row.cells.length>this.buildings[id].hp.length||(row.collapsed&&row.cells.length)) return false;
      const cells:[number,number][]=[];let lastCell=-1;
      for(const pair of row.cells) {
        if(!Array.isArray(pair)||pair.length!==2||!Number.isInteger(pair[0])||pair[0]<=lastCell||pair[0]>=this.buildings[id].hp.length||!Number.isInteger(pair[1])||pair[1]<0||pair[1]>=HP) return false;
        cells.push([pair[0],pair[1]]);lastCell=pair[0];
      }
      if(!row.collapsed&&!cells.length) return false;
      if(!row.collapsed) {
        const check={...this.buildings[id],hp:new Uint8Array(this.buildings[id].hp.length).fill(HP)};
        for(const [c,hp] of cells)check.hp[c]=hp;
        if(this.unsupported(check))return false;
      }
      validated.push({id,collapsed:row.collapsed,cells});
    }
    this.reset();
    for(const row of validated) {
      const b=this.buildings[row.id];b.split=true;b.collapsed=row.collapsed;
      if(row.collapsed)b.hp.fill(0);else for(const [c,hp] of row.cells)b.hp[c]=hp;
      this.source.setMatrixAt(b.source,this.matrix.makeScale(0,0,0));
    }
    this.source.instanceMatrix.needsUpdate=true;this.dirty=true;this.stateRevision++;this.syncCells();
    return true;
  }

  reset():void {
    this.stateRevision++;
    this.buildings.forEach(b=> {b.hp.fill(HP);b.split=false;b.collapsed=false;this.source.setMatrixAt(b.source,this.matrices[b.source]);});
    this.source.instanceMatrix.needsUpdate=true;this.pieces.count=0;this.fragments.count=0;this.visibleCells=0;this.debris.length=0;this.dirty=false;
  }

  dispose():void {
    if(this.disposed)return;this.disposed=true;
    this.object.removeFromParent();this.object.clear();
    for(const mesh of [this.source,this.pieces,this.fragments]) {mesh.dispose();mesh.geometry.dispose();const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];materials.forEach(m=>m.dispose());}
    this.debris.length=0;
  }

  private unsupported(b:Building):boolean {
    // Any storey losing 65% of its load-bearing footprint can no longer carry the floors
    // above it. A single blast or a narrow traversable tunnel leaves other columns intact.
    const plane=b.nx*b.ny;
    for(let z=0;z<b.nz;z++) {
      let alive=0;for(let c=z*plane;c<(z+1)*plane;c++)if(b.hp[c])alive++;
      if(alive/plane<.35)return true;
    }
    return false;
  }

  private cellBox(b:Building,c:number):StaticBox {
    const x=c%b.nx,y=Math.floor(c/b.nx)%b.ny,z=Math.floor(c/(b.nx*b.ny));
    return {minX:b.box.minX+x*b.dx,maxX:b.box.minX+(x+1)*b.dx,minY:b.box.minY+y*b.dy,maxY:b.box.minY+(y+1)*b.dy,minZ:b.box.minZ+z*b.dz,maxZ:b.box.minZ+(z+1)*b.dz};
  }

  private *cellsIn(b:Building,minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number,direct?:number):Generator<number> {
    const x0=Math.max(0,Math.floor((minX-b.box.minX)/b.dx)),x1=Math.min(b.nx-1,Math.floor((maxX-b.box.minX)/b.dx));
    const y0=Math.max(0,Math.floor((minY-b.box.minY)/b.dy)),y1=Math.min(b.ny-1,Math.floor((maxY-b.box.minY)/b.dy));
    const z0=Math.max(0,Math.floor((minZ-b.box.minZ)/b.dz)),z1=Math.min(b.nz-1,Math.floor((maxZ-b.box.minZ)/b.dz));
    let found=false;
    for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {const c=x+b.nx*(y+b.ny*z);if(c===direct)found=true;yield c;}
    if(direct!==undefined&&!found)yield direct;
  }

  private syncCells():void {
    let slot=0;
    const ids=this.pieces.geometry.getAttribute('facadeIndex') as THREE.InstancedBufferAttribute;
    for(const b of this.buildings) {
      if(!b.split||b.collapsed)continue;
      const plane=b.nx*b.ny;
      for(let c=0;c<b.hp.length;c++) {
        if(!b.hp[c])continue;
        const x=c%b.nx,y=Math.floor(c/b.nx)%b.ny,z=Math.floor(c/plane);
        if(x>0&&x<b.nx-1&&y>0&&y<b.ny-1&&z>0&&z<b.nz-1&&b.hp[c-1]&&b.hp[c+1]&&b.hp[c-b.nx]&&b.hp[c+b.nx]&&b.hp[c-plane]&&b.hp[c+plane])continue;
        const box=this.cellBox(b,c);
        this.matrix.makeScale(b.dx,b.dy,b.dz).setPosition((box.minX+box.maxX)/2,(box.minY+box.maxY)/2,(box.minZ+box.maxZ)/2);
        this.pieces.setMatrixAt(slot,this.matrix);
        this.pieces.setColorAt(slot,this.color.copy(b.color).multiplyScalar(.78+.22*b.hp[c]/HP));
        ids.setX(slot,b.source);slot++;
      }
    }
    this.pieces.count=slot;this.visibleCells=slot;ids.needsUpdate=true;this.pieces.instanceMatrix.needsUpdate=true;if(this.pieces.instanceColor)this.pieces.instanceColor.needsUpdate=true;this.dirty=false;
  }

  private emitDebris(b:Building,box:StaticBox,impulse:number,seed:number,collapse=false):void {
    if(this.debris.length>=DEBRIS)this.debris.shift();
    const size=.3+(seed%5)*.07;
    const scale:[number,number,number]=collapse?[Math.min(5,b.dx*1.8),Math.min(5,b.dy*1.8),Math.min(2,b.dz*.7)]:[size,size,size];
    const angle=seed*2.399;
    const vz=Math.min(8,Math.max(1,Number.isFinite(impulse)?impulse*.03:1));
    const z=(box.minZ+box.maxZ)/2;
    const life=Math.max(2.4,Math.sqrt(Math.max(0,2*z/9.8))+vz/9.8+.9)+(seed%5)*.1;
    this.debris.push({x:(box.minX+box.maxX)/2,y:(box.minY+box.maxY)/2,z,vz,vx:Math.cos(angle)*(collapse?1.2:.8),vy:Math.sin(angle)*(collapse?1.2:.8),spin:(seed%7-3)*.5,angle:0,size,scale,age:0,life,tint:b.color.getHex()});
  }
}

function validPoint(p:ArrayLike<number>):boolean {return Number.isFinite(p[0])&&Number.isFinite(p[1])&&Number.isFinite(p[2]);}
function isRecord(v:unknown):v is Record<string,unknown> {return !!v&&typeof v==='object'&&!Array.isArray(v);}
function distanceBox(at:ArrayLike<number>,b:StaticBox):number {return Math.hypot(Math.max(b.minX-at[0],0,at[0]-b.maxX),Math.max(b.minY-at[1],0,at[1]-b.maxY),Math.max(b.minZ-at[2],0,at[2]-b.maxZ));}
function slab(b:StaticBox,from:ArrayLike<number>,dir:ArrayLike<number>,reach:number):{t:number;far:number;normal:[number,number,number]}|null {
  let t=0,far=reach;let normal:[number,number,number]=[0,0,0];
  for(let a=0;a<3;a++) {
    const lo=[b.minX,b.minY,b.minZ][a],hi=[b.maxX,b.maxY,b.maxZ][a];
    if(dir[a]===0){if(from[a]<lo||from[a]>hi)return null;continue;}
    const one=(lo-from[a])/dir[a],two=(hi-from[a])/dir[a],near=Math.min(one,two);
    if(near>t){t=near;normal=[0,0,0];normal[a]=dir[a]>0?-1:1;}
    far=Math.min(far,Math.max(one,two));if(t>far)return null;
  }
  return {t,far,normal};
}
