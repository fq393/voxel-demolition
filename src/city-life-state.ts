/** A small, deterministic street simulation. It has no renderer or browser state. */
export interface Pose2 { x: number; y: number; heading: number }
export interface RoadBody extends Pose2 { halfLength?: number; halfWidth?: number }
export interface LifeFrame {
  car: (Pose2 & { speed: number }) | null;
  player: { x: number; y: number; z: number; driving: boolean };
}
export type StopReason = 'none' | 'signal' | 'following' | 'pedestrian' | 'player' | 'world';
export interface TrafficCar extends Pose2 {
  id: number; route: number; distance: number; speed: number; cruise: number;
  wheelPhase: number; stopped: StopReason; waiting: number;
}
export interface Pedestrian extends Pose2 {
  id: number; route: number; distance: number; direction: number; speed: number;
  phase: number; scared: number; offsetX: number; offsetY: number;
  threatX: number; threatY: number; waiting: number; moving: boolean; crossing: boolean; avoidUntil: number;
}
export interface Route {
  points: readonly (readonly [number, number])[];
  lengths: number[];
  cumulative: number[];
  length: number;
  /** Centre-distance stop lines before the four bends, and each incoming axis. */
  stops: { distance: number; axis: 'horizontal' | 'vertical' }[];
}
export interface LifeGuards {
  carBlocked: (x: number, y: number, heading: number) => boolean;
  pedestrianBlocked: (x: number, y: number) => boolean;
}
export interface CityLifeState {
  time: number; cars: TrafficCar[]; pedestrians: Pedestrian[];
  routes: readonly Route[]; walkRoutes: readonly Route[];
  signalPhase: 'horizontal' | 'vertical' | 'all-stop';
  stops: { signal: number; following: number; pedestrian: number; player: number; world: number };
}

const CAR_HALF_LENGTH = 2.15;
const CAR_HALF_WIDTH = 0.92;
const BRAKE = 8;
const FIXED_STEP = 1 / 60;
const TAU = Math.PI * 2;
const wrap = (n: number, length: number): number => ((n % length) + length) % length;

export function makeRoute(points: readonly (readonly [number, number])[]): Route {
  const lengths: number[] = [], cumulative = [0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    lengths.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    cumulative.push(cumulative[i] + lengths[i]);
  }
  return { points, lengths, cumulative, length: cumulative[points.length], stops: [] };
}

/** Rounded road loops keep steering continuous and never cut through a building corner. */
export function roundedLoop(radius: number, corner: number, clockwise = false): Route {
  const c = radius - corner;
  const points: [number, number][] = [];
  const centres: [number, number][] = [[c, -c], [c, c], [-c, c], [-c, -c]];
  for (let side = 0; side < 4; side++) {
    for (let j = 0; j <= 10; j++) {
      const angle = -Math.PI / 2 + side * Math.PI / 2 + j * Math.PI / 20;
      points.push([centres[side][0] + Math.cos(angle) * corner, centres[side][1] + Math.sin(angle) * corner]);
    }
  }
  if (clockwise) points.reverse();
  const route = makeRoute(points);
  // Long segments are the straights. Stop a vehicle's centre safely before its bend.
  for (let i = 0; i < route.lengths.length; i++) if (route.lengths[i] > 8) {
    const [x, y] = route.points[i], [nx, ny] = route.points[(i + 1) % route.points.length];
    route.stops.push({ distance: route.cumulative[i + 1] - 5, axis: Math.abs(nx - x) > Math.abs(ny - y) ? 'horizontal' : 'vertical' });
  }
  return route;
}

export function sampleRoute(route: Route, distance: number, out: Pose2 = { x: 0, y: 0, heading: 0 }): Pose2 {
  const d = wrap(distance, route.length);
  let i = 0;
  while (i + 1 < route.lengths.length && d >= route.cumulative[i + 1]) i++;
  const a = route.points[i], b = route.points[(i + 1) % route.points.length];
  const f = route.lengths[i] ? (d - route.cumulative[i]) / route.lengths[i] : 0;
  out.x = a[0] + (b[0] - a[0]) * f;
  out.y = a[1] + (b[1] - a[1]) * f;
  out.heading = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return out;
}

export function trafficSignal(time: number): CityLifeState['signalPhase'] {
  const t = wrap(time, 22);
  return t < 9 ? 'horizontal' : t < 11 ? 'all-stop' : t < 20 ? 'vertical' : 'all-stop';
}

/** Four-axis SAT, used by both the simulation and the player's vehicle collision gate. */
export function vehicleFootprintsOverlap(a: RoadBody, b: RoadBody, margin = 0): boolean {
  const ax = Math.cos(a.heading), ay = Math.sin(a.heading);
  const bx = Math.cos(b.heading), by = Math.sin(b.heading);
  const dx = b.x - a.x, dy = b.y - a.y;
  const al = (a.halfLength ?? CAR_HALF_LENGTH) + margin, aw = (a.halfWidth ?? CAR_HALF_WIDTH) + margin;
  const bl = b.halfLength ?? CAR_HALF_LENGTH, bw = b.halfWidth ?? CAR_HALF_WIDTH;
  const parallel = Math.abs(ax * bx + ay * by), across = Math.abs(ax * by - ay * bx);
  return Math.abs(dx * ax + dy * ay) < al + bl * parallel + bw * across
    && Math.abs(-dx * ay + dy * ax) < aw + bl * across + bw * parallel
    && Math.abs(dx * bx + dy * by) < bl + al * parallel + aw * across
    && Math.abs(-dx * by + dy * bx) < bw + al * across + aw * parallel;
}

export function pointNearVehicle(x: number, y: number, body: RoadBody, margin = 0): boolean {
  const dx = x - body.x, dy = y - body.y, c = Math.cos(body.heading), s = Math.sin(body.heading);
  return Math.abs(dx * c + dy * s) < (body.halfLength ?? CAR_HALF_LENGTH) + margin
    && Math.abs(-dx * s + dy * c) < (body.halfWidth ?? CAR_HALF_WIDTH) + margin;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export class StreetSimulation {
  readonly state: CityLifeState;
  private accumulator = 0;
  private readonly pose: Pose2 = { x: 0, y: 0, heading: 0 };
  private readonly playerBody: RoadBody = { x: 0, y: 0, heading: 0, halfLength: 0.3, halfWidth: 0.3 };
  private readonly vehicleBody: RoadBody = { x: 0, y: 0, heading: 0, halfLength: 2.3, halfWidth: 1 };
  private readonly guards: LifeGuards;

  constructor(guards: LifeGuards, seed = 341) {
    this.guards = guards;
    const rnd = seeded(seed);
    const routes = [roundedLoop(22, 4), roundedLoop(27, 5, true)];
    const walkRoutes = [roundedLoop(14.9, 1.1), roundedLoop(29.8, 1.1, true), makeRoute([[-5, 14.9], [-5, 29.8], [5, 29.8], [5, 14.9]])];
    const cars: TrafficCar[] = [];
    for (let route = 0; route < 2; route++) for (let j = 0; j < 4; j++) {
      const distance = wrap(routes[route].length * (j / 4 + (route ? 0.145 : 0.085)), routes[route].length);
      cars.push({ ...sampleRoute(routes[route], distance), id: cars.length, route, distance, speed: 0, cruise: 5.5 + rnd() * 2, wheelPhase: 0, stopped: 'none', waiting: 0 });
    }
    const pedestrians: Pedestrian[] = [];
    for (let i = 0; i < 14; i++) {
      const route = i < 6 ? 0 : i < 12 ? 1 : 2;
      const distance = wrap(walkRoutes[route].length * ((i % 6) / 6 + 0.045), walkRoutes[route].length);
      const direction = i % 3 === 0 && route !== 2 ? -1 : 1;
      const pose = sampleRoute(walkRoutes[route], distance);
      if (route !== 2) {
        const laneX = -Math.sin(pose.heading) * direction * 0.36, laneY = Math.cos(pose.heading) * direction * 0.36;
        if (!guards.pedestrianBlocked(pose.x + laneX, pose.y + laneY)) { pose.x += laneX; pose.y += laneY; }
      }
      pedestrians.push({ ...pose, heading: pose.heading + (direction < 0 ? Math.PI : 0), id: i, route, distance, direction,
        speed: 1.05 + rnd() * 0.45, phase: rnd() * TAU, scared: 0, offsetX: 0, offsetY: 0,
        threatX: 0, threatY: 0, waiting: 0, moving: false, crossing: route === 2, avoidUntil: 0 });
    }
    this.state = { time: 0, cars, pedestrians, routes, walkRoutes, signalPhase: 'horizontal', stops: { signal: 0, following: 0, pedestrian: 0, player: 0, world: 0 } };
  }

  update(dt: number, frame: LifeFrame): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.15);
    while (this.accumulator + 1e-9 >= FIXED_STEP) {
      this.step(FIXED_STEP, frame);
      this.accumulator -= FIXED_STEP;
    }
  }

  scare(x: number, y: number, radius: number): void {
    if (!(radius > 0)) return;
    for (const p of this.state.pedestrians) if (Math.hypot(p.x - x, p.y - y) < radius) {
      p.scared = 3.5; p.threatX = x; p.threatY = y;
    }
  }

  private step(dt: number, frame: LifeFrame): void {
    const state = this.state;
    state.time += dt;
    state.signalPhase = trafficSignal(state.time);
    this.playerBody.x = frame.player.x; this.playerBody.y = frame.player.y;
    if (frame.car) { this.vehicleBody.x = frame.car.x; this.vehicleBody.y = frame.car.y; this.vehicleBody.heading = frame.car.heading; }
    for (const car of state.cars) this.drive(car, dt, frame);
    for (const p of state.pedestrians) this.walk(p, dt, frame);
  }

  private drive(car: TrafficCar, dt: number, frame: LifeFrame): void {
    const { state } = this, route = state.routes[car.route];
    let wanted = car.cruise, limit = Infinity, reason: StopReason = 'none';
    const cap = (distance: number, stop: StopReason): void => {
      const allowed = Math.sqrt(2 * BRAKE * Math.max(0, distance));
      if (allowed < wanted) { wanted = allowed; reason = stop; }
      limit = Math.min(limit, Math.max(0, distance));
    };
    for (const stop of route.stops) {
      let distance = wrap(stop.distance - car.distance, route.length);
      if (distance > route.length - 1e-5) distance = 0;
      if (distance < 11 && state.signalPhase !== stop.axis) cap(distance, 'signal');
    }
    for (const other of state.cars) {
      if (other === car || other.route !== car.route) continue;
      const gap = wrap(other.distance - car.distance, route.length) - 5.7;
      if (gap < 16) cap(gap, 'following');
    }
    const c = Math.cos(car.heading), s = Math.sin(car.heading);
    const slowFor = (x: number, y: number, halfWidth: number, halfLength: number, stop: StopReason): void => {
      const dx = x - car.x, dy = y - car.y;
      const along = dx * c + dy * s, side = Math.abs(-dx * s + dy * c);
      if (along >= 0 && along < 18 && side < CAR_HALF_WIDTH + halfWidth + 0.3) cap(along - CAR_HALF_LENGTH - halfLength - 0.8, stop);
    };
    if (frame.car) slowFor(frame.car.x, frame.car.y, 1.2, 2.6, 'player');
    if (!frame.player.driving && frame.player.z < 1.8) slowFor(frame.player.x, frame.player.y, 0.35, 0.35, 'player');
    // A walker commits only after checking both lanes from the kerb. Reserve the
    // whole road during that crossing; pedestrians waiting on the pavement let
    // approaching traffic finish passing, rather than trapping it at a bumper.
    for (const p of state.pedestrians) {
      const crossingRoad = p.crossing && p.y > 17 && p.y < 28.9;
      slowFor(p.x, p.y, crossingRoad ? 12 : 0.35, 0.35, 'pedestrian');
    }
    const acceleration = wanted > car.speed ? 2.6 : BRAKE;
    const speed = car.speed + Math.max(-acceleration * dt, Math.min(acceleration * dt, wanted - car.speed));
    const move = Math.min(Math.max(0, speed * dt), limit);
    sampleRoute(route, car.distance + move, this.pose);
    let blocked: StopReason = 'none';
    if (this.guards.carBlocked(this.pose.x, this.pose.y, this.pose.heading)) blocked = 'world';
    if (blocked === 'none') {
      if (frame.car && vehicleFootprintsOverlap(this.pose, this.vehicleBody, 0.16)) blocked = 'player';
      else if (!frame.player.driving && frame.player.z < 1.35 && vehicleFootprintsOverlap(this.pose, this.playerBody, 0.12)) blocked = 'player';
      else for (const other of state.cars) if (other !== car && vehicleFootprintsOverlap(this.pose, other, 0.16)) { blocked = 'following'; break; }
      if (blocked === 'none') for (const p of state.pedestrians) if (pointNearVehicle(p.x, p.y, this.pose, 0.4)) { blocked = 'pedestrian'; break; }
    }
    const previous = car.stopped;
    if (blocked !== 'none') { car.speed = 0; car.stopped = blocked; }
    else {
      car.distance = wrap(car.distance + move, route.length);
      car.x = this.pose.x; car.y = this.pose.y; car.heading = this.pose.heading;
      car.speed = move / dt; car.wheelPhase += move / 0.29;
      car.stopped = car.speed < 0.5 && reason !== 'none' ? reason : 'none';
    }
    car.waiting = car.stopped === 'none' ? 0 : car.waiting + dt;
    if (car.stopped !== 'none' && previous !== car.stopped) state.stops[car.stopped]++;
  }

  private walk(p: Pedestrian, dt: number, frame: LifeFrame): void {
    const route = this.state.walkRoutes[p.route];
    p.scared = Math.max(0, p.scared - dt);
    p.avoidUntil = Math.max(0, p.avoidUntil - dt);
    if (frame.car && Math.hypot(p.x - frame.car.x, p.y - frame.car.y) < 5.3 && Math.abs(frame.car.speed) > 1.5) {
      p.scared = Math.max(p.scared, 1.7); p.threatX = frame.car.x; p.threatY = frame.car.y;
    }
    const stride = (p.scared > 0 ? 2.45 : p.speed) * dt;
    sampleRoute(route, p.distance + stride * p.direction, this.pose);
    const returnRate = p.avoidUntil > 0 ? 0.1 : 1.8;
    let offX = p.offsetX * Math.exp(-dt * returnRate), offY = p.offsetY * Math.exp(-dt * returnRate);
    if (p.scared > 0) {
      const dx = p.x - p.threatX, dy = p.y - p.threatY, distance = Math.max(0.2, Math.hypot(dx, dy));
      offX = Math.max(-1.5, Math.min(1.5, offX + dx / distance * dt * 2));
      offY = Math.max(-1.5, Math.min(1.5, offY + dy / distance * dt * 2));
    }
    // Two sidewalk lanes let opposing walkers pass without a permanent head-on queue.
    const laneX = p.crossing ? 0 : -Math.sin(this.pose.heading) * p.direction * 0.36;
    const laneY = p.crossing ? 0 : Math.cos(this.pose.heading) * p.direction * 0.36;
    let x = this.pose.x + offX + laneX, y = this.pose.y + offY + laneY;
    let blocked = this.guards.pedestrianBlocked(x, y);
    if (blocked && !this.guards.pedestrianBlocked(this.pose.x + offX, this.pose.y + offY)) {
      x = this.pose.x + offX; y = this.pose.y + offY; blocked = false;
    }
    if (blocked && (offX || offY) && !this.guards.pedestrianBlocked(this.pose.x, this.pose.y)) {
      offX = 0; offY = 0; x = this.pose.x; y = this.pose.y; blocked = false;
    }
    // Lane fallbacks and returning from a passing offset obey the same movement
    // budget as walking, including at abrupt route corners or a nearby prop.
    const displacement = Math.hypot(x - p.x, y - p.y), maximum = dt * (p.scared > 0 ? 3.2 : 2.4);
    if (displacement > maximum) {
      const ratio = maximum / displacement;
      x = p.x + (x - p.x) * ratio; y = p.y + (y - p.y) * ratio;
      offX = x - this.pose.x - laneX; offY = y - this.pose.y - laneY;
      blocked = this.guards.pedestrianBlocked(x, y);
    }
    if (frame.car && pointNearVehicle(x, y, this.vehicleBody, 0.5)) blocked = true;
    if (!frame.player.driving && frame.player.z < 1.8 && Math.hypot(frame.player.x - x, frame.player.y - y) < 0.7) blocked = true;
    const enteringRoad = p.crossing && (p.y <= 17 || p.y >= 28.9) && y > 17 && y < 28.9;
    for (const car of this.state.cars) {
      if (pointNearVehicle(x, y, car, 0.5)) { blocked = true; break; }
      if (enteringRoad) {
        const dx = x - car.x, dy = y - car.y, along = dx * Math.cos(car.heading) + dy * Math.sin(car.heading);
        const crossesLane = car.y > 18 && car.y < 29 && Math.abs(Math.cos(car.heading)) > 0.7;
        if (crossesLane && along > -3 && along < 5 + car.speed * 3.3 && (car.speed > 0.1 || Math.abs(along) < 2.8)) { blocked = true; break; }
      }
    }
    let conflict: Pedestrian | null = null;
    if (!blocked) for (const other of this.state.pedestrians) {
      if (other === p) continue;
      if (Math.abs(other.x - x) < 0.4 && Math.abs(other.y - y) < 0.4) {
        conflict = other; blocked = true; break;
      }
      if (other.route === p.route && other.direction === p.direction) {
        const ahead = wrap((other.distance - p.distance) * p.direction, route.length);
        if (ahead > route.length / 2) continue;
      }
      const wantedHeading = this.pose.heading + (p.direction < 0 ? Math.PI : 0);
      const along = (other.x - p.x) * Math.cos(wantedHeading) + (other.y - p.y) * Math.sin(wantedHeading);
      // At a merge, an actor ahead must be able to lead its follower out of the
      // overlap in comfort radii, including when their routes have different IDs.
      if (Math.cos(other.heading - wantedHeading) > 0.8 && along < -0.05) continue;
      if (Math.hypot(other.x - x, other.y - y) < 0.58) {
        // At a crossing/sidewalk merge both future points can enter the comfort
        // radius at once. Give the crossing walker right of way, while retaining
        // a real oriented torso clearance, so it can finish its bend safely.
        const priority = p.crossing !== other.crossing ? p.crossing : p.id < other.id;
        if (other.route !== p.route && priority) {
          // Each pedestrian has the same 0.2 m half-footprint used by blocksPlayer
          // (0.3 m player + 0.2 m actor = its 0.5 m overlap threshold).
          if (Math.abs(x - other.x) >= 0.4 || Math.abs(y - other.y) >= 0.4) continue;
        }
        conflict = other; blocked = true; break;
      }
    }
    p.moving = !blocked;
    if (blocked) {
      p.waiting += dt;
      if (conflict && p.waiting > 0.4) {
        const heading = this.pose.heading + (p.direction < 0 ? Math.PI : 0);
        const nx = -Math.sin(heading), ny = Math.cos(heading);
        const side = (p.x - conflict.x) * nx + (p.y - conflict.y) * ny;
        const preferred = Math.abs(side) > 0.04 ? Math.sign(side) : -1;
        const strideSide = dt * 1.25;
        for (const sign of [preferred, -preferred]) {
          const sx = nx * strideSide * sign, sy = ny * strideSide * sign;
          const nextX = p.x + sx, nextY = p.y + sy;
          if (Math.abs(p.offsetX + sx) > 1.5 || Math.abs(p.offsetY + sy) > 1.5) continue;
          if (Math.hypot(nextX - conflict.x, nextY - conflict.y) <= Math.hypot(p.x - conflict.x, p.y - conflict.y)) continue;
          if (!this.sideStepClear(nextX, nextY, p, frame)) continue;
          // A validated 2 cm step, never a position jump or a route teleport.
          p.x = nextX; p.y = nextY; p.offsetX += sx; p.offsetY += sy;
          p.avoidUntil = 3; p.phase += strideSide * 7.8; p.moving = true;
          break;
        }
      }
      // An unexpected solid obstacle changes the walker's direction; a crossing gap is
      // retried every step, without teleporting, and resumes when traffic clears.
      if (p.waiting > 2.8 && this.guards.pedestrianBlocked(x, y)) { p.direction *= -1; p.waiting = 0; }
    } else {
      p.waiting = 0; p.distance = wrap(p.distance + stride * p.direction, route.length);
      p.offsetX = offX; p.offsetY = offY; p.x = x; p.y = y;
      const wantedHeading = this.pose.heading + (p.direction < 0 ? Math.PI : 0);
      const delta = Math.atan2(Math.sin(wantedHeading - p.heading), Math.cos(wantedHeading - p.heading));
      p.heading += delta * Math.min(1, dt * 12);
      p.phase += stride * 7.8;
    }
  }

  private sideStepClear(x: number, y: number, p: Pedestrian, frame: LifeFrame): boolean {
    if (this.guards.pedestrianBlocked(x, y)) return false;
    if (frame.car && pointNearVehicle(x, y, this.vehicleBody, 0.5)) return false;
    if (!frame.player.driving && frame.player.z < 1.8 && Math.hypot(frame.player.x - x, frame.player.y - y) < 0.7) return false;
    for (const car of this.state.cars) if (pointNearVehicle(x, y, car, 0.5)) return false;
    for (const other of this.state.pedestrians) if (other !== p && Math.abs(other.x - x) < 0.4 && Math.abs(other.y - y) < 0.4) return false;
    return true;
  }
}
