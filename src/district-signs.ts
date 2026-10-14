import * as THREE from 'three/webgpu';
import { State, type City } from './world.ts';

/** Small authored shop signs share the buildings' damage state; no collider is added. */
export class DistrictSigns {
  readonly object = new THREE.Group();
  private signs: { mesh: THREE.Mesh; watch: number[] }[] = [];
  private materials: THREE.Material[] = [];
  private textures: THREE.Texture[] = [];
  private geometry = new THREE.PlaneGeometry(1, 1);
  private clock = 0;
  constructor(city: City) { this.object.name = 'district-addresses'; this.reset(city); }
  reset(city: City): void {
    this.object.clear();this.signs=[];
    for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();this.materials=[];this.textures=[];
    for(const building of city.district??[]){
      const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;
      const ctx=canvas.getContext('2d')!;
      ctx.fillStyle=building.id==='store'?'#335f57':building.id==='home'?'#b96e57':'#596c63';ctx.fillRect(0,0,768,192);
      ctx.strokeStyle='#e3cc9a';ctx.lineWidth=7;ctx.strokeRect(8,8,752,176);
      ctx.fillStyle='#fff0ce';ctx.textAlign='center';ctx.font='600 61px system-ui';ctx.fillText(building.name,384,90);
      ctx.font='26px system-ui';ctx.fillText(building.id==='store'?'柜台取件 · 货架可拆':building.id==='home'?'两层住宅 · 楼梯在左侧':'旧家具清理 · 大门常开',384,148);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.push(texture);
      const material=new THREE.MeshStandardNodeMaterial({map:texture,roughness:.86,side:THREE.DoubleSide});this.materials.push(material);
      const mesh=new THREE.Mesh(this.geometry,material);mesh.rotation.x=Math.PI/2;mesh.scale.set(3.75,.9375,1);
      const at=[building.entrance[0],building.bounds.minY-.14,2.92];mesh.position.set(at[0],at[1],at[2]);this.object.add(mesh);
      const near:number[]=[];for(let v=0;v<city.count;v++)if(city.building[v]===building.object)near.push(v);
      near.sort((a,b)=>{const distance=(v:number)=>Math.hypot(city.position[3*v]-at[0],city.position[3*v+1]-at[1],city.position[3*v+2]-at[2]);return distance(a)-distance(b);});
      this.signs.push({mesh,watch:near.slice(0,24)});
    }
  }
  update(city: City): void {
    if(++this.clock%12!==0)return;
    for(const {mesh,watch} of this.signs){let fixed=0;for(const v of watch)if(city.state[v]===State.Fixed)fixed++;mesh.visible=fixed>=watch.length*.6;}
  }
  dispose():void {for(const m of this.materials)m.dispose();for(const t of this.textures)t.dispose();this.geometry.dispose();this.object.removeFromParent();this.object.clear();}
}
