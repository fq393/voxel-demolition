/** Navigation for the city streets. UI emits intents; main owns the vehicle. */
export interface CityGuideFrame {
  readonly active: boolean;
  readonly driving: boolean;
  readonly player: readonly [number, number];
  /** Radians, +x is forward at zero; positive turns toward +y. */
  readonly heading: number;
  readonly car: readonly [number, number];
  readonly carHeading: number;
  readonly canEnter: boolean;
  /** Vehicle speed in metres per second. */
  readonly speed: number;
  readonly target?: readonly [number, number] | null;
  readonly traffic?: readonly { x: number; y: number; heading: number }[];
  readonly police?: readonly { x: number; y: number; heading: number }[];
  readonly garage?: readonly [number, number];
  readonly pedestrians?: readonly { x: number; y: number }[];
}
export interface CityGuideLandmark {
  readonly minX: number; readonly maxX: number;
  readonly minY: number; readonly maxY: number;
}
interface CityGuideOptions {
  onToggleVehicle: () => void;
  onRecallVehicle: () => void;
}

const CSS = `
.city-guide { position:fixed; left:calc(env(safe-area-inset-left) + 14px); bottom:calc(env(safe-area-inset-bottom) + 174px); z-index:4; width:166px; padding:10px; box-sizing:border-box; border:1px solid #ffffff24; border-top:2px solid #ffb347; border-radius:8px; background:#121419de; backdrop-filter:blur(8px); color:#f3efe6; font:11px/1.35 system-ui,sans-serif; pointer-events:none; user-select:none; }
.city-guide[hidden], .city-guide [hidden] { display:none !important; }
.city-guide .cg-heading { display:flex; justify-content:space-between; align-items:center; margin-bottom:7px; color:#d7cbb8; font-size:11px; font-weight:600; }
.city-guide .cg-north { color:#969b9f; font-size:9px; }
.city-guide .cg-map { display:block; width:100%; aspect-ratio:1; background:#101318; border:1px solid #ffffff12; box-sizing:border-box; border-radius:4px; }
.city-guide .cg-legend { display:flex; justify-content:center; gap:12px; margin-top:5px; font-size:9px; color:#b2b5b7; }
.city-guide .cg-legend-player { color:#ffb347; }
.city-guide .cg-legend-car { color:#7fcada; }
.city-guide .cg-legend-building { color:#c0b5a4; }
.city-guide .cg-legend span { white-space:nowrap; }
.city-guide .cg-map-note { display:block; margin-top:5px; color:#959a9b; text-align:center; font-size:9px; line-height:1.4; white-space:nowrap; }
.city-guide .cg-status { margin:8px 0 6px; min-height:15px; color:#d8d0c2; font-size:10px; font-variant-numeric:tabular-nums; }
.city-guide .cg-actions { display:grid; gap:6px; }
.city-guide button { min-height:44px; width:100%; border:1px solid #ffffff28; border-radius:6px; padding:9px 6px; color:#efe8de; background:#23272d; cursor:pointer; font:600 11px/1.3 system-ui,sans-serif; pointer-events:auto; touch-action:manipulation; }
.city-guide button:hover { border-color:#ffb347; }
.city-guide button:focus-visible { outline:2px solid #ffb347; outline-offset:2px; }
.city-guide button:active { background:#3b3022; }
.city-guide button:disabled { opacity:.4; cursor:default; }
.city-guide .cg-toggle { background:#49321b; color:#ffcd87; border-color:#aa713a; }
.city-guide .cg-recall { background:transparent; color:#bbb8b1; }
.city-guide kbd { padding:1px 4px; margin-left:3px; border:1px solid #ffffff30; border-radius:3px; font:10px system-ui,sans-serif; color:#e7d5ba; }
@media (max-height:760px) and (min-width:681px) {
  .city-guide { width:274px; bottom:calc(env(safe-area-inset-bottom) + 124px); display:grid; grid-template-columns:122px minmax(0,1fr); gap:10px; }
  .city-guide .cg-status { margin:0 0 7px; }
  .city-guide .cg-heading { font-size:10px; }
}
@media (max-height:640px) and (min-width:681px) {
  body:not(.touch) .city-guide { width:240px; grid-template-columns:94px minmax(0,1fr); bottom:calc(env(safe-area-inset-bottom) + 108px); }
  body:not(.touch) .city-guide .cg-legend { gap:5px; }
}
body.touch .city-guide { left:calc(env(safe-area-inset-left) + 12px); }
body.touch .city-guide kbd { display:none; }
@media (orientation:portrait) and (max-width:680px) {
  .city-guide { top:calc(env(safe-area-inset-top) + 260px); bottom:auto; left:calc(env(safe-area-inset-left) + 12px); width:136px; padding:8px; }
  .city-guide .cg-heading { font-size:10px; margin-bottom:5px; }
  .city-guide .cg-status { margin:7px 0 5px; }
  .city-guide .cg-legend { gap:10px; }
}
@media (orientation:landscape) {
  body.touch .city-guide { top:calc(env(safe-area-inset-top) + 64px); bottom:auto; width:236px; padding:8px; display:grid; grid-template-columns:94px minmax(0,1fr); gap:10px; }
  body.touch .city-guide .cg-heading { margin-bottom:4px; font-size:9px; }
  body.touch .city-guide .cg-north { font-size:8px; }
  body.touch .city-guide .cg-legend { margin-top:3px; gap:7px; font-size:8px; }
  body.touch .city-guide .cg-status { margin:0 0 5px; }
  body.touch .city-guide .cg-map-note { font-size:8px; margin-top:3px; }
  body.touch:has(.mission-objective:not([hidden])) .city-guide { left:calc(env(safe-area-inset-left) + 250px); }
}
@media (max-width:360px) and (orientation:portrait) {
  .city-guide { width:126px; }
}
`;

const MAP_SIZE = 168;
const WORLD_HALF = 72;
const EDGE_PADDING = 9;
const BLOCK_PITCH = 46;
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag); result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

export class CityGuide {
  private readonly root = element('aside', 'city-guide');
  private readonly canvas = element('canvas', 'cg-map');
  private readonly context: CanvasRenderingContext2D | null;
  private readonly status = element('div', 'cg-status');
  private readonly toggle = element('button', 'cg-toggle');
  private readonly recall = element('button', 'cg-recall', '召回车辆');
  private readonly options: CityGuideOptions;
  private active = false;
  private driving = false;
  private canEnter = false;
  private lastDraw = -Infinity;
  private lastStatus = '';
  private landmarks: CityGuideLandmark[] = [];
  private worldHalf = WORLD_HALF;

  constructor(options: CityGuideOptions) {
    this.options = options;
    const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
    this.root.hidden = true; this.root.setAttribute('aria-label', '城市导航和车辆操作');
    const mapGroup = element('div', 'cg-map-group');
    const heading = element('div', 'cg-heading'); heading.append(element('span', '', '城市导航'), element('span', 'cg-north', '北 ↑'));
    const legend = element('div', 'cg-legend'); legend.append(element('span', 'cg-legend-player', '▲ 你'), element('span', 'cg-legend-car', '▰ 车'), element('span', 'cg-legend-building', '■ 楼体'));
    this.canvas.setAttribute('role', 'img'); this.canvas.setAttribute('aria-label', '北朝上的城市示意图：全城楼体可拆，红蓝矩形为警车，绿屋为安全车库，黄色箭头为你，青色矩形为车辆');
    mapGroup.append(heading, this.canvas, legend, element('small', 'cg-map-note', '全城可拆 · 绿屋避风头'));
    const controls = element('div', 'cg-control-group'); const actions = element('div', 'cg-actions');
    this.toggle.type = 'button'; this.recall.type = 'button';
    this.toggle.addEventListener('click', (event) => { event.stopPropagation(); this.toggle.blur(); if (this.active && (this.driving || this.canEnter)) this.options.onToggleVehicle(); });
    this.recall.addEventListener('click', (event) => { event.stopPropagation(); this.recall.blur(); if (this.active && !this.driving) this.options.onRecallVehicle(); });
    for (const kind of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick']) this.root.addEventListener(kind, (event) => event.stopPropagation());
    this.root.addEventListener('keydown', (event) => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); });
    this.root.addEventListener('keyup', (event) => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation(); });
    actions.append(this.toggle, this.recall); controls.append(this.status, actions); this.root.append(mapGroup, controls);
    document.body.append(this.root);
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(MAP_SIZE * ratio); this.canvas.height = Math.round(MAP_SIZE * ratio);
    this.context = this.canvas.getContext('2d'); this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.paintToggle(false);
  }

  /** A copy of static, solid skyline footprints, supplied once by main. */
  setLandmarks(boxes: readonly CityGuideLandmark[]): void {
    this.landmarks = boxes.filter((box) => [box.minX, box.maxX, box.minY, box.maxY].every(Number.isFinite) && box.minX < box.maxX && box.minY < box.maxY).map((box) => ({ ...box }));
    this.lastDraw = -Infinity;
  }

  /** Called from the existing game loop; no independent timer or animation frame. */
  update(frame: CityGuideFrame): void {
    const newlyActive = !this.active && frame.active;
    const changedVehicle = this.driving !== frame.driving;
    this.active = frame.active; this.driving = frame.driving; this.canEnter = frame.canEnter;
    this.root.hidden = !frame.active;
    if (!frame.active) return;
    if (newlyActive || changedVehicle) this.paintToggle(frame.driving);
    this.toggle.hidden = !frame.driving && !frame.canEnter;
    this.toggle.disabled = !frame.driving && !frame.canEnter;
    this.recall.hidden = frame.driving;
    const distance = Math.hypot(finite(frame.player[0]) - finite(frame.car[0]), finite(frame.player[1]) - finite(frame.car[1]));
    const text = frame.driving ? `驾驶中 · ${Math.round(Math.abs(finite(frame.speed)) * 3.6)} km/h` : frame.canEnter ? '车辆就在身边' : `车辆距你 ${Math.round(distance)} 米`;
    if (text !== this.lastStatus) { this.lastStatus = text; this.status.textContent = text; }
    const now = performance.now();
    if (newlyActive || changedVehicle || now - this.lastDraw >= 100) { this.lastDraw = now; this.draw(frame); }
  }

  private paintToggle(driving: boolean): void {
    this.toggle.replaceChildren(element('span', '', driving ? '下车' : '上车'), element('kbd', '', 'F'));
    this.toggle.setAttribute('aria-label', driving ? '下车，快捷键 F' : '上车，快捷键 F');
    this.recall.title = '把车辆重新放回街边起点';
  }

  private draw(frame: CityGuideFrame): void {
    const ctx = this.context;
    if (!ctx) return;
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#10151a'; ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    // Keep the origin/central demolition site and both actors in view as they roam.
    this.worldHalf = Math.min(200, Math.max(WORLD_HALF, ...[...frame.player, ...frame.car, ...(frame.target ?? [])].map((v) => Math.abs(finite(v)) + 12)));
    const mapScale = (MAP_SIZE - EDGE_PADDING * 2) / (this.worldHalf * 2);
    const x = (world: number) => MAP_SIZE / 2 + finite(world) * mapScale;
    const y = (world: number) => MAP_SIZE / 2 - finite(world) * mapScale;
    ctx.save(); ctx.beginPath(); ctx.rect(EDGE_PADDING, EDGE_PADDING, MAP_SIZE - EDGE_PADDING * 2, MAP_SIZE - EDGE_PADDING * 2); ctx.clip();
    ctx.fillStyle = '#30373d'; ctx.fillRect(EDGE_PADDING, EDGE_PADDING, MAP_SIZE - EDGE_PADDING * 2, MAP_SIZE - EDGE_PADDING * 2);
    const lastBlock = Math.ceil((this.worldHalf + 15) / BLOCK_PITCH);
    for (let bx = -lastBlock; bx <= lastBlock; bx++) {
      for (let by = -lastBlock; by <= lastBlock; by++) {
        const cx = bx * BLOCK_PITCH, cy = by * BLOCK_PITCH;
        ctx.fillStyle = bx === 0 && by === 0 ? '#596058' : '#404b45';
        ctx.fillRect(x(cx - 15), y(cy + 15), 30 * mapScale, 30 * mapScale);
        ctx.strokeStyle = '#bbc8b01c'; ctx.lineWidth = 0.7;
        ctx.strokeRect(x(cx - 15), y(cy + 15), 30 * mapScale, 30 * mapScale);
      }
    }
    // Dashed street centrelines separate the repeating 30 m blocks / 16 m roads.
    ctx.strokeStyle = '#a7a18a45'; ctx.lineWidth = 0.7; ctx.setLineDash([3, 4]); ctx.beginPath();
    for (let lane = -lastBlock; lane <= lastBlock; lane++) {
      const coordinate = lane * BLOCK_PITCH + BLOCK_PITCH / 2;
      ctx.moveTo(x(coordinate), y(-this.worldHalf)); ctx.lineTo(x(coordinate), y(this.worldHalf));
      ctx.moveTo(x(-this.worldHalf), y(coordinate)); ctx.lineTo(x(this.worldHalf), y(coordinate));
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const box of this.landmarks) {
      if (box.maxX < -this.worldHalf || box.minX > this.worldHalf || box.maxY < -this.worldHalf || box.minY > this.worldHalf) continue;
      ctx.fillStyle = '#68716f'; ctx.fillRect(x(box.minX), y(box.maxY), (box.maxX - box.minX) * mapScale, (box.maxY - box.minY) * mapScale);
      ctx.strokeStyle = '#88928b'; ctx.lineWidth = 0.7;
      ctx.strokeRect(x(box.minX), y(box.maxY), (box.maxX - box.minX) * mapScale, (box.maxY - box.minY) * mapScale);
    }
    // Warm centre: the only destructible tower, 13 x 11 m. Rubble is not mapped.
    ctx.fillStyle = '#b0804a'; ctx.fillRect(x(-6.5), y(5.5), 13 * mapScale, 11 * mapScale);
    ctx.strokeStyle = '#ffba5b'; ctx.lineWidth = 1; ctx.strokeRect(x(-6.5), y(5.5), 13 * mapScale, 11 * mapScale);
    ctx.restore();
    for (const vehicle of frame.traffic ?? []) {
      const [tx,ty] = this.point([vehicle.x,vehicle.y]);
      ctx.save();ctx.translate(tx,ty);ctx.rotate(-vehicle.heading);ctx.fillStyle='#d9bea0';ctx.fillRect(-3,-1.5,6,3);ctx.restore();
    }
    for (const pedestrian of frame.pedestrians ?? []) {
      const [tx,ty] = this.point([pedestrian.x,pedestrian.y]);
      ctx.fillStyle='#a3c8a8';ctx.beginPath();ctx.arc(tx,ty,1.25,0,Math.PI*2);ctx.fill();
    }
    for (const vehicle of frame.police ?? []) {
      const [tx,ty]=this.point([vehicle.x,vehicle.y]);
      ctx.save();ctx.translate(tx,ty);ctx.rotate(-vehicle.heading);ctx.fillStyle='#dce8ef';ctx.fillRect(-4,-2,8,4);
      ctx.fillStyle='#86bce4';ctx.fillRect(-1,-2,2,2);ctx.fillStyle='#ec8175';ctx.fillRect(-1,0,2,2);ctx.restore();
    }
    if(frame.garage){const [gx,gy]=this.point(frame.garage);ctx.fillStyle='#9de0c4';ctx.beginPath();ctx.moveTo(gx,gy-5);ctx.lineTo(gx+5,gy);ctx.lineTo(gx+3,gy);ctx.lineTo(gx+3,gy+4);ctx.lineTo(gx-3,gy+4);ctx.lineTo(gx-3,gy);ctx.lineTo(gx-5,gy);ctx.closePath();ctx.fill();}
    if (frame.target) {
      const [tx, ty] = this.point(frame.target);
      ctx.strokeStyle = '#a0efd0'; ctx.fillStyle = '#3e8e72'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(tx,ty-7);ctx.lineTo(tx+7,ty);ctx.lineTo(tx,ty+7);ctx.lineTo(tx-7,ty);ctx.closePath();ctx.fill();ctx.stroke();
    }
    this.drawCar(ctx, frame.car, frame.carHeading, frame.driving);
    if (!frame.driving) this.drawPlayer(ctx, frame.player, frame.heading);
    ctx.strokeStyle = '#ffffff14'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, MAP_SIZE - 1, MAP_SIZE - 1);
  }

  private point(position: readonly [number, number]): [number, number, boolean] {
    const limit = MAP_SIZE / 2 - EDGE_PADDING;
    const mapScale = (MAP_SIZE - EDGE_PADDING * 2) / (this.worldHalf * 2);
    const rawX = finite(position[0]) * mapScale, rawY = -finite(position[1]) * mapScale;
    const scale = Math.min(1, limit / Math.max(1, Math.abs(rawX), Math.abs(rawY)));
    return [MAP_SIZE / 2 + rawX * scale, MAP_SIZE / 2 + rawY * scale, scale < 1];
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, position: readonly [number, number], heading: number): void {
    const [x, y, outside] = this.point(position);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-finite(heading));
    ctx.fillStyle = '#ffba5b'; ctx.strokeStyle = '#241907'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-4.5, -4.5); ctx.lineTo(-2, 0); ctx.lineTo(-4.5, 4.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore(); if (outside) this.edgeRing(ctx, x, y, '#ffba5b');
  }

  private drawCar(ctx: CanvasRenderingContext2D, position: readonly [number, number], heading: number, driving: boolean): void {
    const [x, y, outside] = this.point(position);
    ctx.save(); ctx.translate(x, y); ctx.rotate(-finite(heading));
    if (driving) { ctx.strokeStyle = '#ffba5b'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#79c5d7'; ctx.strokeStyle = '#0a252d'; ctx.lineWidth = 1;
    ctx.fillRect(-6.5, -3.5, 13, 7); ctx.strokeRect(-6.5, -3.5, 13, 7);
    ctx.fillStyle = '#e4f5ff'; ctx.fillRect(3.5, -2.5, 2, 5);
    ctx.restore(); if (outside) this.edgeRing(ctx, x, y, '#79c5d7');
  }

  private edgeRing(ctx: CanvasRenderingContext2D, x: number, y: number, colour: string): void {
    ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
}
