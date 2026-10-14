import { pointNearVehicle, vehicleFootprintsOverlap, type RoadBody } from './city-life-state.ts';
import type { PoliceFrame, PoliceProbes, PoliceStep, PoliceUnit } from './police-types.ts';

const STEP = 1 / 60;
const ROADS = [-69, -23, 23, 69];
/** Shared patrol-road bounds for both live movement and restored healthy cars. */
export function policeOnRoad(x:number,y:number):boolean {
  return Number.isFinite(x)&&Number.isFinite(y)&&ROADS.some(road=>Math.abs(x-road)<6.7||Math.abs(y-road)<6.7);
}
type Point = readonly [number, number];
interface Brain {
  lane: number; route: Point[]; goal: Point; replan: number; blocked: number;
  reverse: number; yield: number; patrol: number; caught: number; officerRoute: Point[]; officerGoal: Point; officerReplan: number;
}
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const finitePlayer = (f: PoliceFrame) => [f.player.x, f.player.y, f.player.z].every(Number.isFinite);

/** Bounded, fixed-step road pursuit. Commands contain only a last known position;
 * seeing the player is an output, never an implicit omniscient target update. */
export class PoliceSimulation {
  readonly units: PoliceUnit[] = [];
  readonly diagnostics = { time: 0, carStops: 0, officerStops: 0, replans: 0, seen: false, catchProgress: 0 };
  private readonly probes: PoliceProbes;
  private readonly brains: Brain[] = [];
  private accumulator = 0;

  constructor(probes: PoliceProbes) { this.probes = probes; this.reset(); }

  reset(): void {
    this.units.length = 0; this.brains.length = 0; this.accumulator = 0;
    Object.assign(this.diagnostics, { time: 0, carStops: 0, officerStops: 0, replans: 0, seen: false, catchProgress: 0 });
    for (let id = 0; id < 2; id++) {
      const lane = id ? 6.1 : -6.1, x = id ? 69 : -23 + lane, y = id ? 23 + lane : -69;
      this.units.push({ id, x, y, heading: id ? Math.PI : Math.PI / 2, speed: 0, wheelPhase: 0, mode: 'patrol', carDestroyed:false, officerDestroyed:false,
        officer: { x, y, heading: 0, moving: false, phase: 0, active: false } });
      this.brains.push({ lane, route: [], goal: [x, y], replan: 0, blocked: 0, reverse: 0, yield: 0, patrol: id ? 2 : 0, caught: 0, officerRoute: [], officerGoal: [x, y], officerReplan: 0 });
    }
  }

  update(dt: number, frame: PoliceFrame): PoliceStep {
    const result = { seen: false, caught: false };
    // Inactive callers pass dt=0. Reject invalid input without changing clocks or pursuit progress.
    if (!Number.isFinite(dt) || dt <= 0 || !finitePlayer(frame)) return result;
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-9 >= STEP) {
      this.accumulator -= STEP;
      const step = this.step(frame); result.seen ||= step.seen; result.caught ||= step.caught;
    }
    this.diagnostics.seen = result.seen;
    this.diagnostics.catchProgress = Math.max(...this.brains.map(b => b.caught));
    return result;
  }

  private step(frame: PoliceFrame): PoliceStep {
    this.diagnostics.time += STEP;
    const active = frame.wanted.stars > 0 && frame.wanted.phase !== 'quiet' && !frame.safe;
    const target = active && frame.wanted.target?.every(Number.isFinite) ? frame.wanted.target : null;
    let seen = false, caught = false;
    for (const unit of this.units) {
      const brain = this.brains[unit.id];
      if(unit.carDestroyed && unit.officerDestroyed){unit.speed=0;unit.officer.active=false;brain.caught=0;continue;}
      if(unit.officerDestroyed){unit.officer.active=false;unit.officer.moving=false;unit.speed=0;unit.mode='patrol';brain.caught=0;continue;}
      if(unit.carDestroyed){unit.speed=0;unit.officer.moving=false;if(!unit.officerDestroyed&&!unit.officer.active)this.exit(unit,frame);}
      brain.replan -= STEP;
      brain.officerReplan -= STEP;
      unit.mode = target ? frame.wanted.phase === 'search' ? 'search' : 'chase' : 'patrol';
      let goal: Point;
      if (target) goal = this.project([target[0], target[1]], brain.lane);
      else {
        const corners: Point[] = [[-69 + brain.lane, -69 + brain.lane], [69 + brain.lane, -69 + brain.lane],
          [69 + brain.lane, 69 + brain.lane], [-69 + brain.lane, 69 + brain.lane]];
        goal = corners[brain.patrol];
        if (distance([unit.x, unit.y], goal) < 1.5) { brain.patrol = (brain.patrol + 1) % 4; goal = corners[brain.patrol]; }
      }
      if (distance(goal, brain.goal) > 4 || brain.replan <= 0) {
        brain.goal = goal; brain.route = this.plan([unit.x, unit.y], goal, brain); brain.replan = 2; this.diagnostics.replans++;
      }
      const nearGoal = target && (distance([unit.x, unit.y], goal) < 3
        || frame.player.driving && distance([unit.x, unit.y], [target[0], target[1]]) < 5);
      if (!unit.officer.active && !unit.carDestroyed) {
        this.drive(unit, brain, frame, nearGoal ? 0 : unit.mode === 'patrol' ? 5.5 : 11);
        if (nearGoal && frame.player.driving && target) this.approach(unit, [target[0], target[1]], frame);
      }
      else unit.speed = 0;
      if (!unit.officerDestroyed && nearGoal && !frame.player.driving && unit.speed < 0.5 && target && !unit.officer.active) this.exit(unit, frame);
      if (unit.officer.active) {
        if (!unit.carDestroyed && (!target || frame.player.driving || distance([unit.officer.x, unit.officer.y], [target[0], target[1]]) > 38)) {
          // Board only after physically returning to the car, never teleport across a room.
          this.walk(unit, [unit.x, unit.y], frame, true);
          if (distance([unit.officer.x, unit.officer.y], [unit.x, unit.y]) < 1.5) unit.officer.active = false;
        } else if (target) this.walk(unit, [target[0], target[1]], frame, false);
      }
      const eye: readonly [number, number, number] = unit.officer.active
        ? [unit.officer.x, unit.officer.y, 1.65] : [unit.x, unit.y, 1.45];
      const range = unit.officer.active ? 32 : 42;
      const visible = !unit.officerDestroyed && (!unit.carDestroyed || unit.officer.active) && active && Math.hypot(eye[0] - frame.player.x, eye[1] - frame.player.y, eye[2] - (frame.player.z + 1.3)) < range
        && this.probes.visible(eye, [frame.player.x, frame.player.y, frame.player.z + 1.3]);
      seen ||= visible;
      const close = frame.player.driving ? !!frame.car && Math.abs(frame.car.speed) < 1.5
        && distance(unit.carDestroyed ? [unit.officer.x,unit.officer.y] : [unit.x, unit.y], [frame.car.x, frame.car.y]) < 5
        : unit.officer.active && distance([unit.officer.x, unit.officer.y], [frame.player.x, frame.player.y]) <= 1.5;
      const eligible = visible && close && !frame.player.flying && frame.player.z >= -0.2 && frame.player.z < 1.1;
      brain.caught = eligible ? brain.caught + STEP : 0;
      if (brain.caught + 1e-9 >= (frame.player.driving ? 3 : 2)) caught = true;
    }
    return { seen, caught };
  }

  private project(point: Point, lane: number): Point {
    let best: Point = [0, 0], cost = Infinity;
    const min = ROADS[0] + lane, max = ROADS[3] + lane;
    for (const road of ROADS) {
      const candidates: Point[] = [[road + lane, Math.max(min, Math.min(max, point[1]))],
        [Math.max(min, Math.min(max, point[0])), road + lane]];
      for (const candidate of candidates) if (distance(point, candidate) < cost) { best = candidate; cost = distance(point, candidate); }
    }
    return best;
  }

  private plan(start: Point, goal: Point, brain: Brain): Point[] {
    const nodes: Point[] = ROADS.flatMap(y => ROADS.map(x => [x + brain.lane, y + brain.lane] as Point));
    const startOnRoad = this.project(start, brain.lane);
    nodes.push(startOnRoad, goal);
    const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = nodes.map(() => false);
    costs[16] = 0;
    const aligned = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01;
    for (let iteration = 0; iteration < nodes.length; iteration++) {
      let at = -1;
      for (let i = 0; i < nodes.length; i++) if (!visited[i] && (at < 0 || costs[i] < costs[at])) at = i;
      if (at < 0 || !Number.isFinite(costs[at])) break;
      if (at === 17) break;
      visited[at] = true;
      for (let next = 0; next < nodes.length; next++) {
        if (visited[next] || at === next || !aligned(nodes[at], nodes[next])) continue;
        // Intersection nodes connect only neighbouring intersections, while projected start/end
        // connect to the ends of their segment. This permits meaningful blocked-edge reroutes.
        const length = distance(nodes[at], nodes[next]);
        if (at < 16 && next < 16 && length > 46.01) continue;
        if ((at >= 16 || next >= 16) && length > 46.01) continue;
        if (length > 0.01 && !this.edgeClear(nodes[at], nodes[next])) continue;
        const cost = costs[at] + length;
        if (cost < costs[next]) { costs[next] = cost; previous[next] = at; }
      }
    }
    if (!Number.isFinite(costs[17])) return [];
    const route: Point[] = [];
    for (let at = 17; at !== 16 && at >= 0; at = previous[at]) route.unshift(nodes[at]);
    if (distance(start, startOnRoad) > 0.15) route.unshift(startOnRoad);
    return route;
  }

  private edgeClear(a: Point, b: Point): boolean {
    const length = distance(a, b), heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const steps = Math.ceil(length / 1.2);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.probes.carBlocked(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, heading)) return false;
    }
    return true;
  }

  private drive(unit: PoliceUnit, brain: Brain, frame: PoliceFrame, cruise: number): void {
    if (brain.reverse > 0 || brain.yield > 0) {
      this.releaseQueue(unit, brain, frame); return;
    }
    while (brain.route.length && distance([unit.x, unit.y], brain.route[0]) < 0.35) brain.route.shift();
    if (!brain.route.length || cruise === 0) { unit.speed = Math.max(0, unit.speed - STEP * 14); return; }
    const goal = brain.route[0], desired = Math.atan2(goal[1] - unit.y, goal[0] - unit.x);
    const delta = angleDelta(unit.heading, desired);
    const turn = Math.max(-2.6 * STEP, Math.min(2.6 * STEP, delta));
    const heading = unit.heading + turn;
    if (!this.carBlocked(unit, unit.x, unit.y, heading, frame)) unit.heading = heading;
    if (this.entryBlocked(unit, brain, frame)) {
      unit.speed = 0; this.diagnostics.carStops++; brain.blocked += STEP;
      if (brain.blocked > 1) { brain.reverse = 6.5; brain.yield = 1.5; brain.blocked = 0; }
      return;
    }
    const speed = Math.min(cruise, unit.speed + STEP * 6) * (Math.abs(delta) > 0.4 ? 0.72 : 1);
    const amount = Math.min(speed * STEP, distance([unit.x, unit.y], goal));
    const count = Math.max(1, Math.ceil(amount / 0.25));
    let moved = false;
    for (let i = 0; i < count; i++) {
      const x = unit.x + Math.cos(unit.heading) * amount / count, y = unit.y + Math.sin(unit.heading) * amount / count;
      if (this.carBlocked(unit, x, y, unit.heading, frame) || !this.onRoad(x, y)) break;
      unit.x = x; unit.y = y; unit.wheelPhase += amount / count / 0.32; moved = true;
    }
    unit.speed = moved ? speed : 0;
    brain.blocked = moved ? 0 : brain.blocked + STEP;
    if (!moved) this.diagnostics.carStops++;
    if (brain.blocked > 0.65) {
      // A crossing vehicle cannot release a mutual stop if our nose remains in
      // its lane. Back the actual car out before waiting for a crossing gap.
      brain.reverse = 6.5; brain.yield = 1.5; brain.blocked = 0;
    }
  }

  /** Police yield before entering the swept crossing corridor. Waiting only
   * for immediate footprint contact leaves a sedan's nose in curved traffic. */
  private entryBlocked(unit: PoliceUnit, brain: Brain, frame: PoliceFrame): boolean {
    let from: Point = [unit.x, unit.y], remaining = 9;
    for (const goal of brain.route) {
      const length = distance(from, goal);
      if (length < 0.01) { from = goal; continue; }
      const heading = Math.atan2(goal[1] - from[1], goal[0] - from[0]);
      const limit = Math.min(remaining, length);
      for (let ahead = 1; ahead <= limit; ahead += 1) {
        const body = { x: from[0] + Math.cos(heading) * ahead, y: from[1] + Math.sin(heading) * ahead, heading };
        for (const car of frame.traffic) if (vehicleFootprintsOverlap(body, car, 0.02)) return true;
      }
      remaining -= length; if (remaining <= 0) break; from = goal;
    }
    return false;
  }

  private releaseQueue(unit: PoliceUnit, brain: Brain, frame: PoliceFrame): void {
    unit.speed = 0;
    if (brain.reverse > 0) {
      const amount = Math.min(brain.reverse, STEP * 2);
      const x = unit.x - Math.cos(unit.heading) * amount, y = unit.y - Math.sin(unit.heading) * amount;
      if (this.onRoad(x, y) && !this.carBlocked(unit, x, y, unit.heading, frame)) {
        unit.x = x; unit.y = y; unit.speed = -amount / STEP; unit.wheelPhase -= amount / 0.32;
        brain.reverse -= amount;
      } else {
        // If rear space is occupied, a bounded side manoeuvre may make room,
        // still using swept small increments and all normal collision gates.
        let shifted = false;
        for (const sign of [unit.id ? 1 : -1, unit.id ? -1 : 1]) {
          const sx = unit.x - Math.sin(unit.heading) * amount * sign;
          const sy = unit.y + Math.cos(unit.heading) * amount * sign;
          if (!this.onRoad(sx, sy) || this.carBlocked(unit, sx, sy, unit.heading, frame)) continue;
          unit.x = sx; unit.y = sy; brain.reverse -= amount; shifted = true; break;
        }
        if (!shifted) brain.reverse = 0;
      }
      return;
    }
    brain.yield -= STEP;
    if (brain.yield <= 0) {
      // Recompute the legal route from the actual backed-up pose. The old car
      // heading can point diagonally toward a building or crossing queue;
      // testing that heading forever would prevent the next safe turn.
      brain.route = this.plan([unit.x, unit.y], brain.goal, brain);
      brain.replan = 2; this.diagnostics.replans++;
      if (this.entryBlocked(unit, brain, frame)) brain.yield = 0.25;
    }
  }

  /** Within the destination intersection/lane, close a small side gap to a slow
   * vehicle. This is still physical road motion, not a lane-position snap. */
  private approach(unit: PoliceUnit, target: Point, frame: PoliceFrame): void {
    const d = distance([unit.x, unit.y], target);
    if (d < 4.6 || d > 11) return;
    const desired = Math.atan2(target[1] - unit.y, target[0] - unit.x);
    const delta = angleDelta(unit.heading, desired), turn = Math.max(-2.6 * STEP, Math.min(2.6 * STEP, delta));
    const heading = unit.heading + turn;
    if (this.carBlocked(unit, unit.x, unit.y, heading, frame)) return;
    unit.heading = heading;
    if (Math.abs(delta) > 0.35) return;
    const amount = Math.min(STEP * 2, d - 4.6);
    const x = unit.x + Math.cos(heading) * amount, y = unit.y + Math.sin(heading) * amount;
    if (!this.onRoad(x, y) || this.carBlocked(unit, x, y, heading, frame)) return;
    unit.x = x; unit.y = y; unit.speed = amount / STEP; unit.wheelPhase += amount / 0.32;
  }

  private onRoad(x: number, y: number): boolean {
    return policeOnRoad(x,y);
  }

  private carBlocked(unit: PoliceUnit, x: number, y: number, heading: number, frame: PoliceFrame): boolean {
    if (this.probes.carBlocked(x, y, heading)) return true;
    const body: RoadBody = { x, y, heading, halfLength: 2.15, halfWidth: 0.92 };
    if (frame.car && vehicleFootprintsOverlap(body, frame.car, 0.08)) return true;
    for (const car of frame.traffic) if (vehicleFootprintsOverlap(body, car, 0.08)) return true;
    for (const other of this.units) if (!other.carDestroyed && other !== unit && vehicleFootprintsOverlap(body, other, 0.08)) return true;
    for (const person of frame.pedestrians) if (pointNearVehicle(person.x, person.y, body, 0.4)) return true;
    for (const other of this.units) if (!other.officerDestroyed && other.officer.active && pointNearVehicle(other.officer.x, other.officer.y, body, 0.4)) return true;
    return !frame.player.driving && frame.player.z < 1.6 && pointNearVehicle(frame.player.x, frame.player.y, body, 0.4);
  }

  private exit(unit: PoliceUnit, frame: PoliceFrame): void {
    for (const side of [1, -1]) {
      const x = unit.x - Math.sin(unit.heading) * 1.7 * side, y = unit.y + Math.cos(unit.heading) * 1.7 * side;
      if (this.officerBlocked(unit, x, y, frame, false)) continue;
      Object.assign(unit.officer, { x, y, heading: unit.heading, active: true, moving: false }); return;
    }
  }

  private officerBlocked(unit: PoliceUnit, x: number, y: number, frame: PoliceFrame, boarding: boolean): boolean {
    if (this.probes.officerBlocked(x, y)) return true;
    if (frame.car && pointNearVehicle(x, y, frame.car, 0.28)) return true;
    for (const car of frame.traffic) if (pointNearVehicle(x, y, car, 0.28)) return true;
    for (const other of this.units) if (!other.carDestroyed && (!boarding || other !== unit) && pointNearVehicle(x, y, other, 0.28)) return true;
    for (const other of this.units) if (other !== unit && !other.officerDestroyed && other.officer.active && Math.hypot(other.officer.x - x, other.officer.y - y) < 0.65) return true;
    for (const person of frame.pedestrians) if (Math.hypot(person.x - x, person.y - y) < 0.65) return true;
    return !frame.player.driving && frame.player.z < 1.6 && Math.hypot(frame.player.x - x, frame.player.y - y) < 0.68;
  }

  /** A local, bounded capsule grid finds real door openings and routes around the
   * parked patrol car. Dynamic pedestrians are handled by the per-step gate. */
  private walkPlan(unit: PoliceUnit, target: Point, frame: PoliceFrame, boarding: boolean): Point[] {
    const start: Point = [unit.officer.x, unit.officer.y], cell = 0.65, padding = 7;
    if (distance(start, target) > 55) return [];
    const minX = Math.min(start[0], target[0]) - padding, minY = Math.min(start[1], target[1]) - padding;
    const width = Math.ceil((Math.abs(start[0] - target[0]) + padding * 2) / cell) + 1;
    const height = Math.ceil((Math.abs(start[1] - target[1]) + padding * 2) / cell) + 1;
    const count = width * height;
    if (count > 11000) return [];
    const index = (p: Point) => Math.round((p[0] - minX) / cell) + width * Math.round((p[1] - minY) / cell);
    const point = (i: number): Point => [minX + (i % width) * cell, minY + Math.floor(i / width) * cell];
    const from = index(start), to = index(target), costs = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1), closed = new Uint8Array(count), blocked = new Int8Array(count).fill(-1);
    const staticBlocked = (i: number) => {
      if (blocked[i] >= 0) return blocked[i] === 1;
      const [x, y] = point(i);
      let value = this.probes.officerBlocked(x, y);
      if (!value && frame.car) value = pointNearVehicle(x, y, frame.car, 0.28);
      if (!value) for (const car of frame.traffic) if (pointNearVehicle(x, y, car, 0.28)) { value = true; break; }
      if (!value) for (const other of this.units) if (!other.carDestroyed && (!boarding || other !== unit) && pointNearVehicle(x, y, other, 0.28)) { value = true; break; }
      blocked[i] = value ? 1 : 0; return value;
    };
    const pending = [from]; costs[from] = 0;
    let found = -1;
    for (let visits = 0; pending.length && visits < 7000; visits++) {
      let best = 0;
      for (let i = 1; i < pending.length; i++) if (costs[pending[i]] + distance(point(pending[i]), target)
        < costs[pending[best]] + distance(point(pending[best]), target)) best = i;
      const at = pending.splice(best, 1)[0]; if (closed[at]) continue;
      closed[at] = 1;
      if (at === to || distance(point(at), target) < (boarding ? 1.35 : 0.85)) { found = at; break; }
      const x = at % width, y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dy) || x + dx < 0 || y + dy < 0 || x + dx >= width || y + dy >= height) continue;
        const next = at + dx + dy * width;
        if (closed[next] || staticBlocked(next)) continue;
        if (dx && dy && (staticBlocked(at + dx) || staticBlocked(at + dy * width))) continue;
        const cost = costs[at] + Math.hypot(dx, dy) * cell;
        if (cost >= costs[next]) continue;
        costs[next] = cost; previous[next] = at; pending.push(next);
      }
    }
    if (found < 0) return [];
    const path: Point[] = [];
    for (let at = found; at !== from && at >= 0; at = previous[at]) path.unshift(point(at));
    return path;
  }

  private walk(unit: PoliceUnit, target: Point, frame: PoliceFrame, boarding: boolean): void {
    const officer = unit.officer, brain = this.brains[unit.id], d = distance([officer.x, officer.y], target);
    officer.moving = false;
    if (d < (boarding ? 1.3 : 0.85)) return;
    if (distance(target, brain.officerGoal) > 1.5 || brain.officerReplan <= 0) {
      brain.officerRoute = this.walkPlan(unit, target, frame, boarding);
      brain.officerGoal = target; brain.officerReplan = 2;
    }
    while (brain.officerRoute.length && distance([officer.x, officer.y], brain.officerRoute[0]) < 0.2) brain.officerRoute.shift();
    const waypoint = brain.officerRoute[0] ?? target;
    const desired = Math.atan2(waypoint[1] - officer.y, waypoint[0] - officer.x);
    // Fan steering follows walls and finds door openings without stepping through the capsule probe.
    for (const offset of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 1.9, -1.9]) {
      const heading = desired + offset, amount = Math.min(d, STEP * 2.6);
      const x = officer.x + Math.cos(heading) * amount, y = officer.y + Math.sin(heading) * amount;
      if (this.officerBlocked(unit, x, y, frame, boarding)) continue;
      officer.x = x; officer.y = y; officer.heading += Math.max(-0.16, Math.min(0.16, angleDelta(officer.heading, heading)));
      officer.phase += amount * 5; officer.moving = true; return;
    }
    this.diagnostics.officerStops++;
  }
}
