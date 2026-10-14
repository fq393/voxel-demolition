import { Player } from './player.ts';
import type { City } from './world.ts';
const probes = new WeakMap<City, Player>();
/** Structural doorway test. The real player still collides with temporary rubble and actors while crossing. */
export function warehouseBreachOpen(city: City): boolean {
  let probe = probes.get(city);
  if (!probe) { probe = new Player(city); probes.set(city, probe); }
  for (let x = 39.5; x <= 41; x += .1) if (probe.blocked(x,47.25,.25,1.8)) return false;
  return true;
}
