import * as THREE from 'three/webgpu';
import { CityJobState, CITY_JOBS, CLEANUP_ZONE, type CityJobId, type JobFrame } from './city-job-state.ts';
import { State, type City } from './world.ts';

const CSS = `
.city-jobs {position:fixed;left:calc(env(safe-area-inset-left) + 14px);top:calc(env(safe-area-inset-top) + 64px);z-index:4;width:236px;padding:10px 12px;box-sizing:border-box;border-left:3px solid #9cccba;border-radius:0 8px 8px 0;background:#162321e8;color:#f4e7ce;font:11px/1.4 system-ui,sans-serif;pointer-events:none;}
.city-jobs[hidden] {display:none;}
.city-jobs .cj-heading {display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;}
.city-jobs .cj-badges {color:#edc785;font-size:10px;white-space:nowrap;}
.city-jobs .cj-note {margin:5px 0 8px;color:#c8d8ca;min-height:15px;}
.city-jobs .cj-progress {color:#f1cb83;font-size:10px;min-height:14px;}
.city-jobs button,.cj-menu button {min-height:44px;border:1px solid #779b8550;border-radius:6px;background:#30483b;color:#f4e7ce;font:600 11px system-ui;cursor:pointer;touch-action:manipulation;}
.city-jobs button {pointer-events:auto;width:100%;margin-top:5px;}
.city-jobs button:hover,.cj-menu button:hover {border-color:#edc785;}
.city-jobs button:focus-visible,.cj-menu button:focus-visible {outline:2px solid #edc785;outline-offset:2px;}
.cj-menu {margin:12px 0;border-top:1px solid #ffffff20;padding-top:10px;}
.cj-menu .cj-menu-heading {font-size:12px;color:#edc785;margin:0 0 8px;}
.cj-menu .cj-options {display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}
.cj-menu button {padding:7px 3px;}
.cj-menu button[aria-pressed=true] {border-color:#edc785;background:#514125;}
.cj-menu button:disabled {opacity:.45;cursor:default;}
.cj-menu small {display:block;margin-top:7px;font-size:11px;color:#c8d8ca;}
body.city-jobs-active:not(.touch) .hud .keys {top:212px;}
@media(orientation:portrait) and (max-width:680px) {.city-jobs {top:calc(env(safe-area-inset-top) + 150px);width:236px;padding:8px 10px;} .city-jobs .cj-note {margin:3px 0 4px;font-size:10px;} body.city-jobs-active .city-guide {top:calc(env(safe-area-inset-top) + 288px);}}
@media(orientation:landscape) {body.touch .city-jobs {width:230px;} body.touch.city-jobs-active .city-guide {left:calc(env(safe-area-inset-left) + 250px);width:178px;grid-template-columns:64px 88px;gap:8px;} body.touch.city-jobs-active .city-guide .cg-status,body.touch.city-jobs-active .city-guide .cg-map-note {display:none;} body.touch.city-jobs-active .city-guide .cg-legend {gap:4px;font-size:7px;} body.touch.city-jobs-active .city-guide .cg-heading {font-size:8px;}}
@media(max-height:640px) and (min-width:681px) {body.city-jobs-active:not(.touch) .hud .keys {display:none;}}
`;

/** Optional sandbox tasks. Completion badges never alter ranked demolition scores. */
export class CityJobs {
  readonly state: CityJobState;
  readonly object = new THREE.Group();
  private readonly root = document.createElement('aside');
  private readonly name = document.createElement('strong');
  private readonly badges = document.createElement('span');
  private readonly note = document.createElement('div');
  private readonly progress = document.createElement('div');
  private readonly choose = document.createElement('button');
  private readonly ringMaterial = new THREE.MeshBasicMaterial({color:0x9de0c4,transparent:true,opacity:0.65,side:THREE.DoubleSide,depthWrite:false});
  private readonly ring = new THREE.Mesh(new THREE.RingGeometry(2.8,3.05,48),this.ringMaterial);
  private readonly beacon = new THREE.Group();
  private readonly materials: THREE.Material[] = [this.ringMaterial];
  private readonly geometries: THREE.BufferGeometry[] = [this.ring.geometry];
  private readonly storageKey: string;
  private city: City;
  private watch: number[] = [];
  private counted = new Set<number>();
  private demolished = 0;
  private scanElapsed = 0;
  private clock = 0;
  private menu: HTMLElement | null = null;
  private menuNote: HTMLElement | null = null;
  private eligible = true;
  private lastPaint = '';
  private readonly onChoose: () => void;
  private readonly onFeedback: (text:string,complete:boolean) => void;

  constructor(city:City,playerId:string,onChoose:()=>void,onFeedback:(text:string,complete:boolean)=>void) {
    this.city=city;this.storageKey=`city.jobs.${playerId}`;this.onChoose=onChoose;this.onFeedback=onFeedback;
    let saved:string[]=[];
    try {const data:unknown=JSON.parse(localStorage.getItem(this.storageKey)??'[]');if(Array.isArray(data)) saved=data.filter((v):v is string=>typeof v==='string');}catch {/* fresh badges */}
    this.state=new CityJobState(saved);
    const style=document.createElement('style');style.textContent=CSS;document.head.append(style);
    this.root.className='city-jobs';this.root.hidden=true;this.root.setAttribute('aria-label','街区小任务');
    const heading=document.createElement('div');heading.className='cj-heading';this.badges.className='cj-badges';heading.append(this.name,this.badges);
    this.note.className='cj-note';this.progress.className='cj-progress';this.choose.type='button';
    this.choose.addEventListener('click',e=>{e.stopPropagation();this.choose.blur();this.onChoose();});
    for(const kind of ['pointerdown','pointerup','mousedown','mouseup'])this.root.addEventListener(kind,e=>e.stopPropagation());
    this.root.append(heading,this.note,this.progress,this.choose);document.body.append(this.root);
    this.object.name='city-task-target';this.object.visible=false;this.ring.position.z=0.035;this.object.add(this.ring,this.beacon);
    const box=new THREE.BoxGeometry(0.7,0.7,0.7);const trim=new THREE.BoxGeometry(0.73,0.12,0.73);
    const parcel=new THREE.MeshStandardMaterial({color:0xd3a66c,roughness:0.85});const ribbon=new THREE.MeshStandardMaterial({color:0xf6e7bc,roughness:0.7});
    this.materials.push(parcel,ribbon);this.geometries.push(box,trim);
    const body=new THREE.Mesh(box,parcel);body.castShadow=true;
    const strip=new THREE.Mesh(trim,ribbon);const strip2=new THREE.Mesh(trim,ribbon);strip2.rotation.z=Math.PI/2;
    this.beacon.add(body,strip,strip2);this.reset(city);
  }
  mountMenu(menu:HTMLElement):void {
    this.menu=document.createElement('section');this.menu.className='cj-menu';
    const label=document.createElement('p');label.className='cj-menu-heading';label.textContent='街区小任务 · 自由模式';
    const options=document.createElement('div');options.className='cj-options';
    for(const job of CITY_JOBS){const b=document.createElement('button');b.type='button';b.dataset.job=job.id;b.textContent=job.name;b.addEventListener('click',()=>{b.blur();this.start(job.id);});options.append(b);}
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='暂时不接任务';cancel.style.gridColumn='1 / -1';cancel.addEventListener('click',()=>{cancel.blur();this.cancel();});options.append(cancel);
    this.menuNote=document.createElement('small');this.menu.append(label,options,this.menuNote);
    menu.querySelector('.buttons')?.before(this.menu);this.lastPaint='';this.paint();
  }
  start(id:CityJobId):boolean {
    if(!this.eligible)return false;
    this.scan();
    if(!this.state.start(id,this.demolished,this.watch.length-this.demolished)){this.onFeedback('街角已经清空了，按 R 重建后再试',false);return false;}
    this.onFeedback(`${CITY_JOBS.find(job=>job.id===id)!.name} · 跟着绿色标记走`,false);this.lastPaint='';this.paint();return true;
  }
  cancel():void {this.state.cancel();this.lastPaint='';this.paint();}
  reset(city:City):void {
    this.city=city;this.watch=[];this.counted.clear();this.demolished=this.scanElapsed=0;
    for(let i=0;i<city.count;i++){const x=city.position[3*i],y=city.position[3*i+1],z=city.position[3*i+2];if(Math.hypot(x-CLEANUP_ZONE[0],y-CLEANUP_ZONE[1])<=4&&z<5)this.watch.push(i);}
    this.state.restart(this.watch.length);this.lastPaint='';this.paint();
  }
  setEligible(value:boolean):void {this.eligible=value;this.paint();}
  update(dt:number,active:boolean,frame:Omit<JobFrame,'demolished'>):void {
    this.root.hidden=!active||!this.eligible;document.body.classList.toggle('city-jobs-active',!this.root.hidden);
    this.object.visible=active&&this.eligible&&!!this.state.target;
    if(!active||!this.eligible)return;
    this.clock+=dt;this.scanElapsed+=dt;if(this.scanElapsed>=0.25){this.scan();this.scanElapsed=0;}
    if(this.state.update({...frame,demolished:this.demolished})){
      try {localStorage.setItem(this.storageKey,JSON.stringify([...this.state.badges]));}catch {/* badges still live for this session */}
      this.onFeedback(`${CITY_JOBS.find(job=>job.id===this.state.active)!.name}完成 · 街区徽章 ${this.state.badges.size}/3`,true);
    }
    const target=this.state.target;if(target){this.object.position.set(target[0],target[1],0);this.beacon.position.z=2.25+Math.sin(this.clock*2.8)*0.15;this.beacon.rotation.z=this.clock*0.5;this.ring.rotation.z=this.clock*0.1;this.ring.scale.setScalar(this.state.active==='cleanup'?1.32:1);}
    this.object.visible=active&&!!target;this.paint();
  }
  get diagnostics():{active:CityJobId|null;stage:number;progress:number;complete:boolean;badges:CityJobId[];regionVoxels:number;demolished:number} {
    return {active:this.state.active,stage:this.state.stage,progress:this.state.progress,complete:this.state.complete,badges:[...this.state.badges],regionVoxels:this.watch.length,demolished:this.demolished};
  }
  dispose():void {this.root.remove();this.menu?.remove();for(const g of this.geometries)g.dispose();for(const m of this.materials)m.dispose();}
  private scan():void {for(const v of this.watch)if(this.city.state[v]!==State.Fixed)this.counted.add(v);this.demolished=this.counted.size;}
  private paint():void {
    const key=`${this.state.active},${this.state.stage},${this.state.progress},${this.state.complete},${this.state.badges.size},${this.eligible}`;if(key===this.lastPaint)return;this.lastPaint=key;
    this.name.textContent=this.state.active?CITY_JOBS.find(job=>job.id===this.state.active)!.name:'街区小任务';
    this.badges.textContent=`徽章 ${this.state.badges.size}/3`;
    this.note.textContent=this.state.active?this.state.instruction:'兜风、送包裹，或者清理街角';
    this.progress.textContent=this.state.active&&!this.state.complete?`${this.state.progress} / ${this.state.goal} · 地图上找绿色菱形`:'不赶时间，想做哪件就做哪件';
    this.choose.textContent=this.state.complete?'选下一件事 · G':'选择 / 更换任务 · G';
    this.menu?.querySelectorAll<HTMLButtonElement>('button[data-job]').forEach(button=>{const id=button.dataset.job as CityJobId;button.disabled=!this.eligible;button.setAttribute('aria-pressed',String(this.state.active===id));button.textContent=`${this.state.badges.has(id)?'✓ ':''}${CITY_JOBS.find(job=>job.id===id)!.name}`;});
    if(this.menuNote)this.menuNote.textContent=this.eligible?(this.state.active?CITY_JOBS.find(job=>job.id===this.state.active)!.description:'完成任务，收集三枚街区徽章。任务没有倒计时。'):'90 秒挑战专注拆除；自由模式可接小任务。';
  }
}
