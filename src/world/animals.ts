// Wild beach visitors & feeding — pure TypeScript state machine & steering
// (no DOM or Babylon imports, so it runs cleanly in Vitest and on the main thread).
//
// Phase 1 (A1): a single wild sand crab occasionally emerges from the sand,
// scurries sideways in short bursts, pauses to wave its claws, dodges incoming
// waves and the player's brush, and burrows back into the sand.
// Phase 2 (A2): dropping a beach snack (`dropFood`) either baits a wild crab
// to appear sooner (4x faster wait) or draws an active crab over to nibble,
// extending its visit and calming it around the brush.

// Pets (docs/PETS.md): six species, each moving its own way: the crab and the
// sandpiper on the sand, the octopus in the shallows, the dolphin past the
// surf, and the seal and the turtle in both (swimming at the surface, then
// hauling out onto the sand). Sea animals keep their backs above the water so
// they can always be seen.

import { ANIMALS, PROFILE, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';
import { canLand, canSwim, petKind, pickWildSpecies, type PetSpecies } from './pets';

export type AnimalSpecies = PetSpecies;

export type PetMood = 'happy' | 'peckish' | 'hungry' | 'sleepy';

export type AnimalPhase =
  | 'absent'
  | 'emerging'
  | 'wandering'
  | 'pausing'
  | 'fleeing'
  | 'seeking_food'
  | 'eating'
  | 'sleeping'
  | 'burrowing'
  | 'swimming'
  | 'breaching'
  | 'carried';

export interface AnimalObstacle {
  x: number;
  z: number;
  radius: number;
}

export interface AnimalEnv {
  /** Sand height at world (x, z), or NaN outside the beach slab. */
  heightAt(x: number, z: number): number;
  /** Water depth at world (x, z), in metres. */
  waterAt(x: number, z: number): number;
  /** Active player brush in world coordinates, if any. */
  brush?: { x: number; z: number; active: boolean };
  /** Placed rocks and large objects to steer around. */
  obstacles?: readonly AnimalObstacle[];
}

export interface FoodSnapshot {
  active: boolean;
  x: number;
  y: number;
  z: number;
  timeLeft: number;
  /** tossed into the water: it floats, for sea animals */
  floating: boolean;
}

export interface ResidentPet {
  species: AnimalSpecies;
  name: string;
  mood: PetMood;
  /** its spot on the beach (picked up and set down), or none */
  home?: { x: number; z: number } | null;
}

export interface AnimalSnapshot {
  species: AnimalSpecies;
  active: boolean;
  isPet: boolean;
  petName: string;
  petMood: PetMood | null;
  phase: AnimalPhase;
  /** world coordinates */
  x: number;
  y: number;
  z: number;
  /** body yaw (radians); front (+Z in mesh space) faces this heading */
  facing: number;
  /** body pitch (radians, + = nose down, - = nose up; used for dolphin breaches) */
  pitch: number;
  /** current horizontal speed (m/s) */
  speed: number;
  /** accumulated leg-scuttle / tail-beat phase (radians) */
  scuttlePhase: number;
  /** 0 = underground/burrowed, 1 = fully on top of the sand */
  emerge: number;
  /** 0..1 claw wave animation intensity while pausing or eating */
  clawWave: number;
  /** visual scale (m) */
  size: number;
  /** seconds until next spawn roll while absent */
  nextSpawnIn: number;
  /** seconds remaining in the current visit */
  visitLeft: number;
  /** how many times the brush startled this visitor */
  startles: number;
  /** > 0 right after eating a treat (drives happy bounce) */
  happyTimer: number;
  /** > 0 after eating a treat (crab is calm around the brush) */
  calmTimer: number;
  /** currently dropped treat on the sand, if any */
  food: FoodSnapshot;
  /** swimming (seals and turtles switch; sea animals always are) */
  inWater: boolean;
  /** octopus: 0 = its own colour, 1 = blended into the sand */
  tint: number;
  /** octopus: seconds left of a puff of ink */
  ink: number;
  /** sandpiper: 0 = on the ground, 1 = flying */
  flap: number;
  /** picked up by the player and carried to a new spot */
  carried: boolean;
  /** turtle flipper tracks on the sand (x, z pairs, oldest first), `trackCount` of them */
  tracks: Float32Array;
  trackCount: number;
  /** seconds since each flipper print was laid, parallel to `tracks` */
  trackAge: Float32Array;
  /** bumps on every change to the tracks (laid, expired, cleared), so the renderer can tell the ring moved even when `trackCount` doesn't */
  trackGen: number;
}

const HALF_X = WORLD_SIZE_X / 2;
const HALF_Z = WORLD_SIZE_Z / 2;
const SHORELINE_Z = -HALF_Z + PROFILE.shoreline; // ~0.5 m in world Z
const EMERGE_DURATION = 0.85;
const BURROW_DURATION = 0.95;
const EAT_DURATION = 2.2;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrapAngle(a: number): number {
  let r = (a + Math.PI) % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r - Math.PI;
}

function lerpAngle(cur: number, target: number, t: number): number {
  return cur + wrapAngle(target - cur) * clamp(t, 0, 1);
}

/**
 * Controls rare wild animal visits, dropped food, and an optional resident pet
 * on the player's beach.
 */
export class AnimalController {
  private readonly rand: () => number;
  private readonly snap: AnimalSnapshot;

  private pet: ResidentPet | null = null;
  private waitTimer = 0;
  private phaseTimer = 0;
  private startleCooldown = 0;
  private foodWetTimer = 0;
  private targetX = 0;
  private targetZ = 4;
  /** +1 or -1: which side the crab faces relative to its travel direction */
  private sideSign = 1;
  /** dolphin swim direction along X (+1 or -1) and breach progress */
  private swimDir = 1;
  private breachClock = 0;
  private nextBreachIn = 2.5;
  /** seals and turtles: seconds left ashore before heading back to sea */
  private ashoreLeft = 0;
  /** a swimmer heading ashore (to food or to rest) */
  private headingAshore = false;
  /** which species the snack that's out will bring (decided when it's tossed) */
  private baitSpecies: AnimalSpecies | null = null;
  private lastTrackX = NaN;
  private lastTrackZ = NaN;
  private trackSide = 1;
  /** Optional callback fired whenever a wild animal finishes eating a treat. */
  onWildFed?: (species: AnimalSpecies) => void;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
    this.waitTimer = ANIMALS.firstWaitMin + this.rand() * (ANIMALS.firstWaitMax - ANIMALS.firstWaitMin);
    this.snap = {
      species: 'crab',
      active: false,
      isPet: false,
      petName: '',
      petMood: null,
      phase: 'absent',
      x: 0,
      y: 0,
      z: 4,
      facing: 0,
      pitch: 0,
      speed: 0,
      scuttlePhase: 0,
      emerge: 0,
      clawWave: 0,
      size: ANIMALS.crabSize,
      nextSpawnIn: this.waitTimer,
      visitLeft: 0,
      startles: 0,
      happyTimer: 0,
      calmTimer: 0,
      food: { active: false, x: 0, y: 0, z: 5, timeLeft: 0, floating: false },
      inWater: false,
      tint: 0,
      ink: 0,
      flap: 0,
      carried: false,
      tracks: new Float32Array(ANIMALS.turtleTracks * 2),
      trackCount: 0,
      trackAge: new Float32Array(ANIMALS.turtleTracks),
      trackGen: 0,
    };
  }

  /** The kind of the animal out now (or the pet). */
  private get kind() {
    return petKind(this.snap.species);
  }

  /** Read-only view of the current animal & food state (reused object — zero allocations per frame). */
  snapshot(): Readonly<AnimalSnapshot> {
    return this.snap;
  }

  /**
   * Configure or clear a resident pet for this beach. A resident pet is always
   * present (never leaves on a visit timer) and expresses its cozy mood
   * (`happy` / `peckish` / `hungry` / `sleepy`).
   */
  setPet(pet: ResidentPet | null, env?: AnimalEnv): void {
    this.pet = pet ? { ...pet } : null;
    const s = this.snap;
    if (!pet) {
      s.isPet = false;
      s.petName = '';
      s.petMood = null;
      return;
    }
    s.isPet = true;
    s.petName = pet.name;
    s.petMood = pet.mood;
    if (s.active && s.species !== pet.species) this.despawnNow();
    if (!s.active && env) {
      if (!pet.home || !this.spawnNow(env, pet.home, pet.species)) this.spawnNow(env, undefined, pet.species);
    }
    if (s.active && (pet.species === 'crab' || pet.species === 'sandpiper' || !s.inWater)) {
      s.species = pet.species;
      if (pet.mood === 'sleepy') {
        s.phase = 'sleeping';
        s.speed = 0;
        s.emerge = 0.45;
        s.clawWave = 0;
      } else if (s.phase === 'sleeping' || s.phase === 'burrowing') {
        s.phase = 'emerging';
        this.phaseTimer = EMERGE_DURATION;
      }
    }
  }

  /**
   * Drop a beach snack on dry sand. While active, it speeds up wild spawns
   * (bait) and draws any nearby active crab over to eat it.
   */
  dropFood(env: AnimalEnv, pos?: { x: number; z: number }): boolean {
    const depth = pos ? env.waterAt(pos.x, pos.z) : 0;
    const floating = !!pos && depth >= ANIMALS.snackMinSeaDepth;
    const spot = floating ? this.validateSeaSpot(pos.x, pos.z, env) : pos ? this.validateSpot(pos.x, pos.z, env) : this.pickSpawnSpot(env);
    if (!spot) return false;
    const f = this.snap.food;
    f.active = true;
    f.x = spot.x;
    f.y = spot.y;
    f.z = spot.z;
    f.floating = floating;
    f.timeLeft = ANIMALS.foodDuration;
    this.foodWetTimer = 0;
    if (!this.snap.active || !this.snap.isPet) this.baitSpecies ??= this.snackSpecies(env, spot);
    // Waking a sleepy resident pet when food is tossed
    if (this.pet && this.snap.phase === 'sleeping') {
      this.pet.mood = 'happy';
      this.snap.petMood = 'happy';
      this.snap.phase = 'emerging';
      this.phaseTimer = EMERGE_DURATION * 0.6;
    }
    // If absent and waiting a long time, cap the remaining wait so bait feels responsive
    if (!this.snap.active && this.waitTimer > 90) {
      this.waitTimer = 30 + this.rand() * 60;
      this.snap.nextSpawnIn = this.waitTimer;
    }
    return true;
  }

  /** Is a dropped snack out on the sand within `r` m of (x, z)? */
  foodNear(x: number, z: number, r: number): boolean {
    const f = this.snap.food;
    return f.active && Math.hypot(f.x - x, f.z - z) <= r;
  }

  /** Pick the dropped snack back up (a crab heading for it, or eating it, gives up). */
  takeFood(): boolean {
    const f = this.snap.food;
    if (!f.active) return false;
    f.active = false;
    f.timeLeft = 0;
    this.foodWetTimer = 0;
    this.baitSpecies = null;
    return true;
  }

  /**
   * Which species a snack tossed at `pos` feeds: the wild animal that's out,
   * if it can reach the spot, else the one the snack will bring (decided now,
   * so the server counts the feed toward the right species).
   */
  snackSpecies(env: AnimalEnv, pos: { x: number; z: number }): AnimalSpecies {
    const s = this.snap;
    const wet = env.waterAt(pos.x, pos.z) >= ANIMALS.snackMinSeaDepth;
    if (s.active && (s.isPet || (wet ? canSwim(s.species) : canLand(s.species)))) return s.species;
    if (this.baitSpecies && (wet ? canSwim(this.baitSpecies) : canLand(this.baitSpecies))) return this.baitSpecies;
    this.baitSpecies = pickWildSpecies(this.rand, wet);
    return this.baitSpecies;
  }

  /** Is the animal out (yours, or wild) within `r` m of (x, z)? */
  animalNear(x: number, z: number, r: number): boolean {
    const s = this.snap;
    return s.active && Math.hypot(s.x - x, s.z - z) <= r + s.size * 0.5;
  }

  /** Pick the pet up (it follows `carryTo`), or set it down where it is. */
  carry(on: boolean, env?: AnimalEnv): void {
    const s = this.snap;
    if (!s.active) return;
    s.carried = on;
    if (on) {
      s.phase = 'carried';
      s.speed = 0;
      s.emerge = 1;
      return;
    }
    if (this.pet) this.pet.home = { x: s.x, z: s.z };
    if (env) this.settleAfterCarry(env);
    else this.enterPause(0.6);
  }

  /** Move a carried pet to (x, z), held a little above the ground or the water. */
  carryTo(env: AnimalEnv, x: number, z: number): void {
    const s = this.snap;
    if (!s.carried) return;
    s.x = clamp(x, -HALF_X + ANIMALS.edgeMargin, HALF_X - ANIMALS.edgeMargin);
    s.z = clamp(z, -HALF_Z + ANIMALS.edgeMargin, HALF_Z - ANIMALS.edgeMargin);
    const h = env.heightAt(s.x, s.z);
    const w = env.waterAt(s.x, s.z);
    if (Number.isFinite(h)) s.y = h + Math.max(0, w) + 0.6;
  }

  /** Can this pet be set down here (sea pets in water, land pets on sand)? */
  canSetDown(env: AnimalEnv, x: number, z: number): boolean {
    return this.canSetDownSpecies(env, this.snap.species, x, z);
  }

  /** Can a pet of this species be set down here? */
  canSetDownSpecies(env: AnimalEnv, sp: AnimalSpecies, x: number, z: number): boolean {
    const d = env.waterAt(x, z);
    if (!Number.isFinite(env.heightAt(x, z))) return false;
    if (sp === 'dolphin') return d >= ANIMALS.dolphinMinDepth;
    if (sp === 'octopus') return d >= ANIMALS.octopusMinDepth;
    if (!canSwim(sp)) return d < ANIMALS.snackMaxWaterDepth + 0.02;
    return true;
  }

  private settleAfterCarry(env: AnimalEnv): void {
    const s = this.snap;
    const d = env.waterAt(s.x, s.z);
    const bed = env.heightAt(s.x, s.z);
    s.inWater = canSwim(s.species) && (!canLand(s.species) || d >= ANIMALS.swimMinDepth);
    if (s.inWater) {
      s.phase = 'swimming';
      s.y = this.surfaceY(bed, d);
      this.swimDir = this.rand() < 0.5 ? 1 : -1;
    } else {
      if (Number.isFinite(bed)) s.y = bed;
      this.enterPause(0.8);
      this.ashoreLeft = ANIMALS.ashoreMin + this.rand() * (ANIMALS.ashoreMax - ANIMALS.ashoreMin);
    }
  }

  /** Restore a snack's remaining time (after a pick-up that didn't go through). */
  setFoodTimeLeft(seconds: number): void {
    if (this.snap.food.active) this.snap.food.timeLeft = Math.max(0, seconds);
  }

  /** Immediately spawn a wild animal (`'crab'` or `'dolphin'`, used by ?debug=1 and tests). */
  spawnNow(env: AnimalEnv, pos?: { x: number; z: number }, species: AnimalSpecies = 'crab'): boolean {
    this.resetExtras();
    if (species === 'dolphin') return this.spawnDolphin(env, pos);
    if (species === 'octopus') return this.spawnOctopus(env, pos);
    if (species === 'seal' || species === 'turtle') {
      // amphibians: a pet with a spot on the sand starts there; otherwise in the surf
      const onSand = pos && env.waterAt(pos.x, pos.z) < ANIMALS.hauloutDepth;
      if (!onSand && this.spawnSwimmer(env, pos, species)) return true;
      if (!onSand && !pos) return false;
    }
    const spot = pos ? this.validateSpot(pos.x, pos.z, env) : this.pickSpawnSpot(env);
    if (!spot) return false;
    const s = this.snap;
    s.species = species;
    s.inWater = false;
    this.ashoreLeft = ANIMALS.ashoreMin + this.rand() * (ANIMALS.ashoreMax - ANIMALS.ashoreMin);
    s.active = true;
    s.phase = this.pet?.mood === 'sleepy' ? 'sleeping' : 'emerging';
    s.x = spot.x;
    s.y = spot.y;
    s.z = spot.z;
    // face roughly toward the sea (-Z) with a slight natural turn
    s.facing = Math.PI + (this.rand() - 0.5) * 1.1;
    s.pitch = 0;
    s.speed = 0;
    s.scuttlePhase = 0;
    s.emerge = this.pet?.mood === 'sleepy' ? 0.45 : 0;
    s.clawWave = 0;
    s.size = (species === 'crab' ? ANIMALS.crabSize : this.kind.size) * (0.9 + this.rand() * 0.2);
    s.visitLeft = ANIMALS.visitMin + this.rand() * (ANIMALS.visitMax - ANIMALS.visitMin);
    // a sandpiper flies in rather than coming up out of the sand
    if (species === 'sandpiper') s.flap = 1;
    s.nextSpawnIn = 0;
    s.startles = 0;
    s.happyTimer = 0;
    s.calmTimer = 0;
    this.phaseTimer = EMERGE_DURATION;
    this.startleCooldown = 0;
    this.sideSign = this.rand() < 0.5 ? 1 : -1;
    this.targetX = spot.x;
    this.targetZ = spot.z;
    return true;
  }

  /** Spawn an offshore dolphin cruising alongshore in deep water. */
  private spawnDolphin(env: AnimalEnv, pos?: { x: number; z: number }): boolean {
    this.swimDir = this.rand() < 0.5 ? 1 : -1;
    const startX = pos ? clamp(pos.x, -HALF_X + 1.5, HALF_X - 1.5) : -this.swimDir * (HALF_X - 2.0);
    let z = pos ? pos.z : -HALF_Z + 3.0 + this.rand() * 7.0;
    // Find a deep-water offshore lane
    if (!pos) {
      let found = false;
      // prefer a lane just past the surf (easy to see), falling back further out
      for (let i = 0; i < 16; i++) {
        const near = i < 8;
        const cz = near
          ? -HALF_Z + PROFILE.shoreline - 2.5 - this.rand() * 4.0
          : -HALF_Z + 2.5 + this.rand() * Math.max(2, PROFILE.shoreline - 6.0);
        if (env.waterAt(startX, cz) >= ANIMALS.dolphinMinDepth) {
          z = cz;
          found = true;
          break;
        }
      }
      if (!found && env.waterAt(startX, z) < ANIMALS.dolphinMinDepth) return false;
    }
    const bed = env.heightAt(startX, z);
    const depth = env.waterAt(startX, z);
    if (!Number.isFinite(bed) || depth < ANIMALS.dolphinMinDepth) return false;

    const s = this.snap;
    s.species = 'dolphin';
    s.active = true;
    s.inWater = true;
    s.phase = 'swimming';
    s.x = startX;
    s.z = z;
    s.y = bed + depth - 0.2;
    s.facing = this.swimDir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    s.pitch = 0;
    s.speed = ANIMALS.dolphinSpeed;
    s.scuttlePhase = 0;
    s.emerge = 1;
    s.clawWave = 0;
    s.size = ANIMALS.dolphinSize * (0.9 + this.rand() * 0.2);
    s.visitLeft = 16;
    s.nextSpawnIn = 0;
    s.startles = 0;
    s.happyTimer = 0;
    s.calmTimer = 0;
    this.breachClock = 0;
    this.nextBreachIn = 1.6 + this.rand() * 1.4;
    return true;
  }

  /** Immediately clear any active visitor and start a fresh quiet wait. */
  despawnNow(): void {
    const s = this.snap;
    s.active = false;
    s.phase = 'absent';
    s.speed = 0;
    s.pitch = 0;
    s.emerge = 0;
    s.clawWave = 0;
    s.visitLeft = 0;
    s.startles = 0;
    s.happyTimer = 0;
    s.calmTimer = 0;
    s.carried = false;
    s.inWater = false;
    this.clearTracks();
    this.waitTimer = this.rollWait();
    s.nextSpawnIn = this.waitTimer;
  }

  /** Drop every flipper print (the turtle is back in the sea, or gone). */
  private clearTracks(): void {
    const s = this.snap;
    if (s.trackCount === 0) return;
    s.trackCount = 0;
    s.trackAge.fill(0);
    s.trackGen++;
  }

  private resetExtras(): void {
    const s = this.snap;
    s.tint = 0;
    s.ink = 0;
    s.flap = 0;
    s.carried = false;
    this.clearTracks();
    this.lastTrackX = NaN;
    this.headingAshore = false;
  }

  /** Advance the state machine by `dt` seconds. */
  update(dt: number, env: AnimalEnv): void {
    if (dt <= 0) return;
    const step = Math.min(dt, 0.1);
    const s = this.snap;

    // Tick dropped food (hugs sand height, expires over time, washes away in big waves)
    const f = s.food;
    if (f.active) {
      f.timeLeft -= step;
      const fh = env.heightAt(f.x, f.z);
      const fw = env.waterAt(f.x, f.z);
      if (Number.isFinite(fh)) f.y = f.floating ? fh + Math.max(fw, 0) : fh;
      if (f.floating) {
        this.foodWetTimer = 0;
      } else if (fw > 0.08) {
        this.foodWetTimer += step;
      } else {
        this.foodWetTimer = Math.max(0, this.foodWetTimer - step * 2);
      }
      if (f.timeLeft <= 0 || this.foodWetTimer >= 1.2) {
        f.active = false;
        f.timeLeft = 0;
        this.baitSpecies = null;
      }
    }
    if (s.ink > 0) s.ink = Math.max(0, s.ink - step);
    this.ageTracks(step);

    if (s.happyTimer > 0) s.happyTimer = Math.max(0, s.happyTimer - step);
    if (s.calmTimer > 0) s.calmTimer = Math.max(0, s.calmTimer - step);

    // Resident pet is always present on the beach
    if (this.pet && s.phase === 'absent') {
      if (!this.spawnNow(env, this.pet.home ?? undefined, this.pet.species)) this.spawnNow(env, undefined, this.pet.species);
      return;
    }
    if (s.carried) {
      s.speed = 0;
      s.scuttlePhase += step * 6;
      return;
    }

    if (s.phase === 'absent') {
      const rate = f.active ? ANIMALS.foodBaitMultiplier : 1;
      this.waitTimer -= step * rate;
      s.nextSpawnIn = Math.max(0, this.waitTimer / rate);
      if (this.waitTimer <= 0) {
        const chance = f.active ? Math.min(0.95, ANIMALS.visitChance + 0.25) : ANIMALS.visitChance;
        if (this.rand() < chance) {
          // Bait brings the species decided when it was tossed; unbaited rolls
          // can bring an offshore dolphin, or any of the others
          if (f.active) {
            const sp = this.baitSpecies ?? (f.floating ? 'dolphin' : 'crab');
            const near = f.floating ? this.pickSeaSpotNear(f.x, f.z, sp, env) : this.pickSpotNear(f.x, f.z, 3.5, 7.5, env);
            if (this.spawnNow(env, near ?? undefined, sp)) return;
            if (!f.floating && this.spawnNow(env, near ?? undefined, 'crab')) return;
          } else {
            const pickDolphin = this.rand() < ANIMALS.dolphinChance;
            if (pickDolphin && this.spawnNow(env, undefined, 'dolphin')) return;
            const sp = pickWildSpecies(this.rand, null);
            if (sp !== 'dolphin' && sp !== 'crab' && this.spawnNow(env, undefined, sp)) return;
            if (this.spawnNow(env, undefined, 'crab')) return;
          }
        }
        // quiet miss — wait another interval so the beach stays empty most of the time
        this.waitTimer = this.rollWait();
        s.nextSpawnIn = this.waitTimer / rate;
      }
      return;
    }

    if (s.species === 'dolphin') {
      this.updateDolphin(step, env);
      return;
    }
    if (s.species === 'octopus') {
      this.updateOctopus(step, env);
      return;
    }
    if (s.inWater) {
      this.updateSwimmer(step, env);
      return;
    }
    if (s.flap > 0 && s.phase !== 'burrowing') s.flap = Math.max(0, s.flap - step * 1.6);

    if (this.startleCooldown > 0) this.startleCooldown = Math.max(0, this.startleCooldown - step);

    // Cozy sleeping state for a sleepy resident pet (tucked half into the sand until fed)
    if (s.phase === 'sleeping') {
      s.speed = 0;
      s.emerge = 0.45;
      s.clawWave = 0;
      this.syncHeight(env);
      if (f.active) {
        if (this.pet) this.pet.mood = 'happy';
        s.petMood = 'happy';
        s.phase = 'emerging';
        this.phaseTimer = EMERGE_DURATION * 0.6;
      }
      return;
    }

    if (s.phase === 'emerging') {
      this.phaseTimer -= step;
      s.emerge = clamp(1 - this.phaseTimer / EMERGE_DURATION, 0, 1);
      s.scuttlePhase += step * 10;
      s.speed = 0;
      s.clawWave = 0;
      this.syncHeight(env);
      if (this.phaseTimer <= 0) {
        s.emerge = 1;
        this.enterPause(0.7 + this.rand() * 0.9);
      }
      return;
    }

    if (s.phase === 'burrowing') {
      this.phaseTimer -= step;
      s.emerge = clamp(this.phaseTimer / BURROW_DURATION, 0, 1);
      s.scuttlePhase += step * 14;
      s.speed = 0;
      s.clawWave = 0;
      this.syncHeight(env);
      if (this.phaseTimer <= 0) {
        this.despawnNow();
      }
      return;
    }

    // Active surface phases: pausing, wandering, fleeing, seeking_food, eating
    if (!this.pet) {
      s.visitLeft = Math.max(0, s.visitLeft - step);
      if (s.visitLeft <= 0 && s.phase !== 'eating' && env.waterAt(s.x, s.z) < ANIMALS.crabWetDepth) {
        this.enterBurrow();
        return;
      }
    }

    // React to player brush (unless calmed by a recent treat)
    if (env.brush?.active && s.calmTimer <= 0) {
      const dx = s.x - env.brush.x;
      const dz = s.z - env.brush.z;
      const d = Math.hypot(dx, dz);
      if (d < ANIMALS.crabFleeRadius) {
        if (this.startleCooldown <= 0) {
          s.startles++;
          this.startleCooldown = 1.6;
          if (!this.pet && s.startles >= ANIMALS.crabMaxStartles) {
            s.visitLeft = Math.min(s.visitLeft, 1.4);
          }
        }
        const awayAngle = d > 0.01 ? Math.atan2(dz, dx) : (this.rand() - 0.5) * Math.PI;
        const fleeDist = 3.2 + this.rand() * 2.0;
        this.enterFlee(
          this.clampX(s.x + Math.cos(awayAngle) * fleeDist),
          this.clampZ(s.z + Math.sin(awayAngle) * fleeDist),
        );
      }
    }

    // Seals and turtles ashore: back to sea when the waves reach them, or after a rest
    if (canSwim(s.species)) {
      if (s.phase !== 'eating' && s.phase !== 'seeking_food') this.ashoreLeft -= step;
      const here = env.waterAt(s.x, s.z);
      // waves up to its body, or back at the water's edge after its rest
      if (here >= ANIMALS.swimMinDepth || (this.ashoreLeft <= 0 && here >= ANIMALS.hauloutDepth * 1.5)) {
        this.enterWater(env);
        return;
      }
      if (this.ashoreLeft <= 0 && s.phase !== 'eating' && s.phase !== 'seeking_food') {
        // crawl down the beach toward the sea
        if (s.phase !== 'wandering' || this.targetZ > s.z) {
          s.phase = 'wandering';
          this.targetX = this.clampX(s.x + (this.rand() - 0.5) * 2);
          this.targetZ = SHORELINE_Z - 2.5;
          this.phaseTimer = 30;
        }
      }
    }
    if (s.species === 'turtle') this.layTrack();

    // React to incoming wave wash
    if (!canSwim(s.species) && env.waterAt(s.x, s.z) > ANIMALS.crabWetDepth && s.phase !== 'fleeing') {
      const upslopeZ = this.clampZ(s.z + 2.2 + this.rand() * 1.8);
      const sideX = this.clampX(s.x + (this.rand() - 0.5) * 2.4);
      this.enterFlee(sideX, upslopeZ);
    }

    // Eating a treat
    if (s.phase === 'eating') {
      this.phaseTimer -= step;
      s.speed = 0;
      s.scuttlePhase += step * 8;
      s.clawWave = 0.85;
      this.syncHeight(env);
      if (!f.active) {
        this.enterPause(0.8);
        return;
      }
      if (this.phaseTimer <= 0) {
        f.active = false;
        f.timeLeft = 0;
        s.visitLeft = Math.min(ANIMALS.foodMaxVisit, s.visitLeft + ANIMALS.foodExtendSec);
        s.happyTimer = 3.0;
        s.calmTimer = ANIMALS.foodCalmSec;
        s.startles = 0;
        if (this.pet) {
          this.pet.mood = 'happy';
          s.petMood = 'happy';
        }
        this.onWildFed?.(s.species);
        this.enterPause(1.5 + this.rand());
      }
      return;
    }

    // Notice dropped food nearby when pausing or wandering
    if (f.active && !f.floating && (s.phase === 'pausing' || s.phase === 'wandering')) {
      const fd = Math.hypot(f.x - s.x, f.z - s.z);
      if (fd <= ANIMALS.foodNoticeRadius) {
        s.phase = 'seeking_food';
        this.targetX = f.x;
        this.targetZ = f.z;
        this.phaseTimer = fd / ANIMALS.crabSpeed + 3.0;
      }
    }

    if (s.phase === 'pausing') {
      this.phaseTimer -= step;
      s.speed = 0;
      // gentle claw wave during the middle of a pause
      s.clawWave = Math.sin(clamp(this.phaseTimer * 2.5, 0, Math.PI));
      this.syncHeight(env);
      if (this.phaseTimer <= 0) {
        if (!this.pet && s.visitLeft <= 0) {
          this.enterBurrow();
        } else {
          this.pickWanderTarget(env);
        }
      }
      return;
    }

    // Moving: wandering, fleeing, or seeking_food
    if (s.phase === 'seeking_food') {
      if (!f.active) {
        this.enterPause(0.8);
        return;
      }
      this.targetX = f.x;
      this.targetZ = f.z;
    }

    const moodScale = this.pet?.mood === 'hungry' ? 0.55 : this.pet?.mood === 'peckish' ? 0.75 : 1;
    const walk = this.kind.landSpeed;
    const maxSpeed =
      s.phase === 'fleeing'
        ? walk * 2
        : s.phase === 'seeking_food'
          ? walk * 1.2
          : walk * moodScale;
    // a startled sandpiper flutters up as it runs
    if (s.species === 'sandpiper' && s.phase === 'fleeing') s.flap = Math.min(1, s.flap + step * 4);
    const dx = this.targetX - s.x;
    const dz = this.targetZ - s.z;
    const dist = Math.hypot(dx, dz);

    const stopDist = s.phase === 'seeking_food' ? 0.35 : 0.14;
    if (dist < stopDist || this.phaseTimer <= 0) {
      if (s.phase === 'seeking_food' && f.active && dist < 0.5) {
        s.phase = 'eating';
        s.speed = 0;
        // turn to face the snack
        s.facing = Math.atan2(f.x - s.x, f.z - s.z);
        this.phaseTimer = EAT_DURATION;
        return;
      }
      if (!this.pet && s.visitLeft <= 0 && env.waterAt(s.x, s.z) < ANIMALS.crabWetDepth && !canSwim(s.species)) {
        this.enterBurrow();
      } else {
        this.enterPause(s.phase === 'fleeing' ? 0.5 + this.rand() * 0.8 : 1.0 + this.rand() * 3.0);
      }
      return;
    }

    this.phaseTimer -= step;
    let dirX = dx / dist;
    let dirZ = dz / dist;

    // Softly deflect around rocks and large placed objects
    if (env.obstacles) {
      for (let i = 0; i < env.obstacles.length; i++) {
        const o = env.obstacles[i];
        const ox = s.x - o.x;
        const oz = s.z - o.z;
        const minD = o.radius + s.size * 0.75;
        const od2 = ox * ox + oz * oz;
        if (od2 > 1e-6 && od2 < minD * minD) {
          const od = Math.sqrt(od2);
          const push = (minD - od) / minD;
          dirX += (ox / od) * push * 2.2;
          dirZ += (oz / od) * push * 2.2;
        }
      }
      const norm = Math.hypot(dirX, dirZ);
      if (norm > 1e-4) {
        dirX /= norm;
        dirZ /= norm;
      }
    }

    const moveDist = Math.min(dist, maxSpeed * step);
    const nx = this.clampX(s.x + dirX * moveDist);
    const nz = this.clampZ(s.z + dirZ * moveDist);

    // Don't voluntarily walk into deep water; turn upslope instead (seals and turtles swim off)
    const nextWater = env.waterAt(nx, nz);
    const curWater = env.waterAt(s.x, s.z);
    if (canSwim(s.species) && nextWater >= (this.ashoreLeft <= 0 ? ANIMALS.hauloutDepth * 1.5 : ANIMALS.swimMinDepth)) {
      s.x = nx;
      s.z = nz;
      this.enterWater(env);
      return;
    }
    const wetLimit = canSwim(s.species) ? ANIMALS.swimMinDepth : s.species === 'sandpiper' ? ANIMALS.crabWetDepth * 3 : ANIMALS.crabWetDepth * 2;
    if (nextWater > wetLimit && nextWater > curWater) {
      this.enterFlee(this.clampX(s.x + (this.rand() - 0.5) * 2.0), this.clampZ(s.z + 2.5));
      return;
    }

    const nextH = env.heightAt(nx, nz);
    if (Number.isFinite(nextH)) {
      s.x = nx;
      s.z = nz;
      s.y = nextH;
    } else {
      this.enterPause(0.8);
      return;
    }

    s.speed = moveDist / step;
    // leg cycle per metre travelled shrinks as the crab grows, so a big crab strides rather than buzzes
    s.scuttlePhase += (s.speed * step * 26 * 0.32) / Math.max(0.1, s.size);
    s.clawWave = 0;

    // Sideways crab gait: face perpendicular to movement direction; the others walk forwards
    const moveYaw = Math.atan2(dirX, dirZ);
    const desiredFacing = s.species === 'crab' ? moveYaw + this.sideSign * (Math.PI * 0.5) : moveYaw;
    s.facing = lerpAngle(s.facing, desiredFacing, step * 8);
  }

  private rollWait(): number {
    return ANIMALS.waitMin + this.rand() * (ANIMALS.waitMax - ANIMALS.waitMin);
  }

  private clampX(x: number): number {
    return clamp(x, -HALF_X + ANIMALS.edgeMargin, HALF_X - ANIMALS.edgeMargin);
  }

  private clampZ(z: number): number {
    // stay on the beach side of the slab (never wander off the offshore edge)
    const minZ = Math.max(-HALF_Z + ANIMALS.edgeMargin, SHORELINE_Z - 1.5);
    return clamp(z, minZ, HALF_Z - ANIMALS.edgeMargin);
  }

  private syncHeight(env: AnimalEnv): void {
    const h = env.heightAt(this.snap.x, this.snap.z);
    if (Number.isFinite(h)) this.snap.y = h;
  }

  private enterPause(duration: number): void {
    this.snap.phase = 'pausing';
    this.snap.speed = 0;
    this.phaseTimer = duration;
  }

  private enterFlee(tx: number, tz: number): void {
    this.snap.phase = 'fleeing';
    this.targetX = tx;
    this.targetZ = tz;
    this.phaseTimer = 2.6;
  }

  private enterBurrow(): void {
    this.snap.phase = 'burrowing';
    this.snap.speed = 0;
    this.snap.clawWave = 0;
    this.phaseTimer = BURROW_DURATION;
  }

  private pickWanderTarget(env: AnimalEnv): void {
    const s = this.snap;
    if (this.rand() < 0.35) this.sideSign = -this.sideSign;
    if (s.species === 'sandpiper' && this.pickSwashTarget(env)) return;
    if (canSwim(s.species) && this.rand() < 0.6) {
      // seals and turtles mostly rest when ashore
      this.enterPause(4 + this.rand() * 8);
      s.clawWave = 0;
      return;
    }
    const home = this.pet?.home;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = this.rand() * Math.PI * 2;
      const dist = 1.1 + this.rand() * 3.2;
      // a pet with a spot wanders around it, and drifts back when it strays
      const away = home ? Math.hypot(s.x - home.x, s.z - home.z) : 0;
      const ox = home && away > ANIMALS.homeRadius ? home.x : s.x;
      const oz = home && away > ANIMALS.homeRadius ? home.z : s.z;
      const tx = this.clampX(ox + Math.cos(angle) * dist);
      const tz = this.clampZ(oz + Math.sin(angle) * dist);
      if (env.waterAt(tx, tz) < ANIMALS.crabWetDepth && Number.isFinite(env.heightAt(tx, tz))) {
        s.phase = 'wandering';
        this.targetX = tx;
        this.targetZ = tz;
        this.phaseTimer = dist / Math.max(0.2, this.kind.landSpeed) + 1.0;
        return;
      }
    }
    // Fallback: move upslope toward dry sand
    s.phase = 'wandering';
    this.targetX = this.clampX(s.x + (this.rand() - 0.5) * 2.0);
    this.targetZ = this.clampZ(s.z + 2.0);
    this.phaseTimer = 2.5;
  }

  private pickSpotNear(
    cx: number,
    cz: number,
    rMin: number,
    rMax: number,
    env: AnimalEnv,
  ): { x: number; z: number } | null {
    for (let i = 0; i < 12; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = rMin + this.rand() * (rMax - rMin);
      const x = this.clampX(cx + Math.cos(a) * r);
      const z = this.clampZ(cz + Math.sin(a) * r);
      if (env.waterAt(x, z) > 0.02) continue;
      if (this.insideObstacle(x, z, env.obstacles)) continue;
      if (Number.isFinite(env.heightAt(x, z))) return { x, z };
    }
    return null;
  }

  private validateSpot(x: number, z: number, env: AnimalEnv): { x: number; y: number; z: number } | null {
    const cx = this.clampX(x);
    const cz = this.clampZ(z);
    const y = env.heightAt(cx, cz);
    if (!Number.isFinite(y)) return null;
    return { x: cx, y, z: cz };
  }

  private pickSpawnSpot(env: AnimalEnv): { x: number; y: number; z: number } | null {
    // Prefer the lively damp-to-dry band between the waterline and the upper berm
    const zLo = Math.max(-HALF_Z + ANIMALS.edgeMargin, SHORELINE_Z + 1.0);
    const zHi = HALF_Z - ANIMALS.edgeMargin - 1.0;
    for (let attempt = 0; attempt < 24; attempt++) {
      // middle of the beach, so it's in view on narrow (phone) screens that crop the sides
      const x = (this.rand() * 2 - 1) * HALF_X * ANIMALS.spawnSpreadX;
      const z = zLo + this.rand() * Math.max(0.5, zHi - zLo);
      if (env.waterAt(x, z) > 0.02) continue;
      if (this.insideObstacle(x, z, env.obstacles)) continue;
      const y = env.heightAt(x, z);
      if (Number.isFinite(y)) return { x, y, z };
    }
    // Fallback near the dry mid-beach
    return this.validateSpot(0, Math.min(zHi, SHORELINE_Z + 5.5), env);
  }

  private insideObstacle(x: number, z: number, obstacles?: readonly AnimalObstacle[]): boolean {
    if (!obstacles) return false;
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const r = o.radius + ANIMALS.crabSize;
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  /** Offshore dolphin: cruises alongshore in deep water with periodic breaching arcs. */
  private updateDolphin(step: number, env: AnimalEnv): void {
    const s = this.snap;
    s.visitLeft = Math.max(0, s.visitLeft - step);
    const speed = ANIMALS.dolphinSpeed * (s.phase === 'breaching' ? 1.15 : 1);
    s.x += this.swimDir * speed * step;
    s.scuttlePhase += step * 8;

    // Gentle sinusoidal offshore weave, nudged seaward if water gets shallow
    let dz = Math.sin(s.scuttlePhase * 0.22) * 0.35 * step;
    const curDepth = env.waterAt(s.x, s.z);
    if (curDepth < ANIMALS.dolphinMinDepth) dz -= 1.5 * step;
    s.z = clamp(s.z + dz, -HALF_Z + 2.0, SHORELINE_Z - 3.5);

    const bed = env.heightAt(s.x, s.z);
    const depth = env.waterAt(s.x, s.z);
    const surface = Number.isFinite(bed) ? bed + Math.max(depth, 0.4) : 0;

    // A pet dolphin turns round at the ends of its beach and heads for floating snacks
    const f = s.food;
    if (this.pet || (f.active && f.floating)) {
      s.visitLeft = Math.max(s.visitLeft, 4);
      if (s.x > HALF_X - 2.5) this.swimDir = -1;
      else if (s.x < -HALF_X + 2.5) this.swimDir = 1;
      const home = this.pet?.home;
      if (home && Math.abs(s.x - home.x) > 9) this.swimDir = home.x > s.x ? 1 : -1;
    }
    if (f.active && f.floating) {
      this.swimDir = f.x >= s.x ? 1 : -1;
      s.z += clamp(f.z - s.z, -1, 1) * step * 1.4;
      if (Math.abs(f.x - s.x) < 0.8 && Math.abs(f.z - s.z) < 1.2 && s.phase !== 'breaching') {
        this.eatFloating();
        s.phase = 'breaching';
        this.breachClock = 0;
      }
    }

    // Leave once crossed the beach or visit timer finishes
    if (!this.pet && (Math.abs(s.x) > HALF_X - 1.0 || (s.visitLeft <= 0 && s.phase !== 'breaching'))) {
      this.despawnNow();
      return;
    }

    const BREACH_SEC = 1.65;
    if (s.phase === 'breaching') {
      this.breachClock += step;
      const t = clamp(this.breachClock / BREACH_SEC, 0, 1);
      // Graceful parabolic arc out of the water and back in
      const arc = Math.sin(t * Math.PI);
      s.y = surface - 0.35 + arc * ANIMALS.dolphinBreachHeight;
      // Nose up on ascent, nose down on dive
      s.pitch = -Math.cos(t * Math.PI) * 0.72;
      if (t >= 1) {
        s.phase = 'swimming';
        s.pitch = 0;
        this.nextBreachIn = 2.0 + this.rand() * 2.2;
      }
    } else {
      // Surface glide with dorsal fin cutting the water
      s.y = surface - 0.14 + Math.sin(s.scuttlePhase * 0.6) * 0.06;
      s.pitch = Math.cos(s.scuttlePhase * 0.6) * 0.08;
      this.nextBreachIn -= step;
      if (this.nextBreachIn <= 0 && depth >= ANIMALS.dolphinMinDepth && Math.abs(s.x) < HALF_X - 5.0) {
        s.phase = 'breaching';
        this.breachClock = 0;
      }
    }

    s.speed = speed;
    s.facing = this.swimDir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
  }

  // ---------------------------------------------------------------- sea and amphibians (docs/PETS.md)

  /** Water surface at a spot: the sea bed plus the water on it. */
  private surfaceY(bed: number, depth: number): number {
    return (Number.isFinite(bed) ? bed : 0) + Math.max(depth, 0);
  }

  /**
   * Where a swimmer's origin sits so the top of its body (`kind.top × size`)
   * stays above the water: what makes sea pets visible from the diorama.
   */
  private swimY(bed: number, depth: number): number {
    const top = this.kind.top * this.snap.size;
    return this.surfaceY(bed, depth) - top + 0.05 + Math.sin(this.snap.scuttlePhase * 0.5) * 0.02;
  }

  private validateSeaSpot(x: number, z: number, env: AnimalEnv): { x: number; y: number; z: number } | null {
    const cx = clamp(x, -HALF_X + ANIMALS.edgeMargin, HALF_X - ANIMALS.edgeMargin);
    const cz = clamp(z, -HALF_Z + ANIMALS.edgeMargin, HALF_Z - ANIMALS.edgeMargin);
    const bed = env.heightAt(cx, cz);
    if (!Number.isFinite(bed)) return null;
    return { x: cx, y: bed + Math.max(0, env.waterAt(cx, cz)), z: cz };
  }

  private pickSeaSpotNear(cx: number, cz: number, species: AnimalSpecies, env: AnimalEnv): { x: number; z: number } | null {
    const min = species === 'dolphin' ? ANIMALS.dolphinMinDepth : species === 'octopus' ? ANIMALS.octopusMinDepth : ANIMALS.swimMinDepth;
    for (let i = 0; i < 16; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 3 + this.rand() * 5;
      const x = clamp(cx + Math.cos(a) * r, -HALF_X + 2, HALF_X - 2);
      const z = clamp(cz + Math.sin(a) * r, -HALF_Z + 2, HALF_Z - 2);
      if (env.waterAt(x, z) >= min && Number.isFinite(env.heightAt(x, z))) return { x, z };
    }
    return null;
  }

  /** Find a swimming spot in the surf: water deep enough, close to the sand (easy to see). */
  private pickSurfSpot(env: AnimalEnv, minDepth: number, maxDepth = Infinity, pos?: { x: number; z: number }): { x: number; z: number } | null {
    if (pos) {
      const d = env.waterAt(pos.x, pos.z);
      if (d >= minDepth && Number.isFinite(env.heightAt(pos.x, pos.z))) return { x: this.clampX(pos.x), z: pos.z };
    }
    for (let i = 0; i < 24; i++) {
      const x = pos ? this.clampX(pos.x + (this.rand() - 0.5) * 6) : (this.rand() * 2 - 1) * HALF_X * ANIMALS.spawnSpreadX * 1.4;
      const z = SHORELINE_Z - 0.5 - this.rand() * (i < 12 ? 5 : 12);
      const d = env.waterAt(x, z);
      if (d >= minDepth && d <= maxDepth && Number.isFinite(env.heightAt(x, z))) return { x, z };
    }
    return null;
  }

  private startSwim(species: AnimalSpecies, x: number, z: number, env: AnimalEnv): void {
    const s = this.snap;
    s.species = species;
    s.active = true;
    s.inWater = true;
    s.phase = 'swimming';
    s.x = x;
    s.z = z;
    s.pitch = 0;
    s.speed = 0;
    s.scuttlePhase = 0;
    s.emerge = 1;
    s.clawWave = 0;
    s.size = this.kind.size * (0.9 + this.rand() * 0.2);
    s.visitLeft = ANIMALS.visitMin + this.rand() * (ANIMALS.visitMax - ANIMALS.visitMin);
    s.nextSpawnIn = 0;
    s.startles = 0;
    s.happyTimer = 0;
    s.calmTimer = 0;
    this.swimDir = this.rand() < 0.5 ? 1 : -1;
    s.facing = this.swimDir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    s.y = this.swimY(env.heightAt(x, z), env.waterAt(x, z));
    this.headingAshore = false;
    this.phaseTimer = 4 + this.rand() * 6;
    this.targetX = x;
    this.targetZ = z;
  }

  private spawnSwimmer(env: AnimalEnv, pos: { x: number; z: number } | undefined, species: AnimalSpecies): boolean {
    const spot = this.pickSurfSpot(env, ANIMALS.swimMinDepth, Infinity, pos);
    if (!spot) return false;
    this.startSwim(species, spot.x, spot.z, env);
    return true;
  }

  private spawnOctopus(env: AnimalEnv, pos?: { x: number; z: number }): boolean {
    const spot = this.pickSurfSpot(env, ANIMALS.octopusMinDepth, ANIMALS.octopusMaxDepth, pos);
    if (!spot) return false;
    this.startSwim('octopus', spot.x, spot.z, env);
    this.snap.emerge = this.snap.isPet ? 1 : 0;
    this.snap.tint = 0.6;
    return true;
  }

  /** Seals and turtles: slide from the sand into the sea. */
  private enterWater(env: AnimalEnv): void {
    const s = this.snap;
    this.clearTracks();
    s.inWater = true;
    s.phase = 'swimming';
    s.pitch = 0;
    this.headingAshore = false;
    this.phaseTimer = 6 + this.rand() * 10;
    this.swimDir = this.rand() < 0.5 ? 1 : -1;
    s.y = this.swimY(env.heightAt(s.x, s.z), env.waterAt(s.x, s.z));
  }

  /** A swimmer eats the floating snack it reached. */
  private eatFloating(): void {
    const s = this.snap;
    s.food.active = false;
    s.food.timeLeft = 0;
    this.baitSpecies = null;
    s.visitLeft = Math.min(ANIMALS.foodMaxVisit, s.visitLeft + ANIMALS.foodExtendSec);
    s.happyTimer = 3.0;
    s.calmTimer = ANIMALS.foodCalmSec;
    s.startles = 0;
    if (this.pet) {
      this.pet.mood = 'happy';
      s.petMood = 'happy';
    }
    this.onWildFed?.(s.species);
  }

  /** Seals and turtles in the water: swim along the surf at the surface, then haul out. */
  private updateSwimmer(step: number, env: AnimalEnv): void {
    const s = this.snap;
    const f = s.food;
    s.scuttlePhase += step * 4;
    if (!this.pet) s.visitLeft = Math.max(0, s.visitLeft - step);
    if (s.happyTimer > 0) s.pitch = Math.sin(s.happyTimer * 6) * 0.25;
    else s.pitch = 0;

    // a sleepy pet floats still at the surface
    if (this.pet?.mood === 'sleepy' && !f.active) {
      s.phase = 'sleeping';
      s.speed = 0;
      s.y = this.swimY(env.heightAt(s.x, s.z), env.waterAt(s.x, s.z));
      return;
    }
    if (s.phase === 'sleeping') s.phase = 'swimming';

    // wild ones swim off when their visit is up
    if (!this.pet && s.visitLeft <= 0) {
      this.targetX = s.x + this.swimDir * 4;
      this.targetZ = -HALF_Z + 1;
      if (s.z < -HALF_Z + 2.5) {
        this.despawnNow();
        return;
      }
    } else if (f.active) {
      // food: floating snacks are eaten in the water; a snack on the sand brings it ashore
      this.targetX = f.x;
      this.targetZ = f.floating ? f.z : Math.max(f.z, SHORELINE_Z);
      this.headingAshore = !f.floating;
      if (f.floating && Math.hypot(f.x - s.x, f.z - s.z) < 0.6) {
        this.eatFloating();
        return;
      }
    } else {
      this.phaseTimer -= step;
      if (this.phaseTimer <= 0) {
        this.headingAshore = !this.headingAshore && this.rand() < 0.7;
        this.phaseTimer = 6 + this.rand() * 10;
        const home = this.pet?.home;
        if (this.headingAshore) {
          this.targetX = home ? home.x : this.clampX(s.x + (this.rand() - 0.5) * 6);
          this.targetZ = home ? Math.max(home.z, SHORELINE_Z + 1) : SHORELINE_Z + 1.5 + this.rand() * 3;
        } else {
          this.swimDir = this.rand() < 0.5 ? 1 : -1;
          this.targetX = this.clampX((home ? home.x : s.x) + this.swimDir * (3 + this.rand() * 6));
          this.targetZ = SHORELINE_Z - 1.5 - this.rand() * 4;
        }
      }
    }

    const dx = this.targetX - s.x;
    const dz = this.targetZ - s.z;
    const dist = Math.hypot(dx, dz);
    const speed = this.kind.swimSpeed * (this.pet?.mood === 'hungry' ? 0.6 : 1);
    if (dist > 0.05) {
      const mv = Math.min(dist, speed * step);
      const nx = this.clampX(s.x + (dx / dist) * mv);
      const nz = clamp(s.z + (dz / dist) * mv, -HALF_Z + 1, HALF_Z - ANIMALS.edgeMargin);
      if (Number.isFinite(env.heightAt(nx, nz))) {
        s.x = nx;
        s.z = nz;
      }
      s.speed = mv / step;
      s.facing = lerpAngle(s.facing, Math.atan2(dx, dz), step * 3);
    } else {
      s.speed = 0;
    }

    const depth = env.waterAt(s.x, s.z);
    const bed = env.heightAt(s.x, s.z);
    if (depth < ANIMALS.hauloutDepth && (this.headingAshore || !this.pet)) {
      // out on the sand: crawl up and rest a while
      s.inWater = false;
      if (Number.isFinite(bed)) s.y = bed;
      this.ashoreLeft = ANIMALS.ashoreMin + this.rand() * (ANIMALS.ashoreMax - ANIMALS.ashoreMin);
      if (f.active && !f.floating) {
        s.phase = 'seeking_food';
        this.targetX = f.x;
        this.targetZ = f.z;
        this.phaseTimer = 30;
      } else {
        this.enterPause(1.2);
      }
      return;
    }
    if (depth < ANIMALS.hauloutDepth) {
      // too shallow and not meaning to land: turn back out
      this.targetZ = SHORELINE_Z - 3;
    }
    s.y = this.swimY(bed, depth);
  }

  /** The octopus: creeps through the shallows, blends in when still, inks at the brush. */
  private updateOctopus(step: number, env: AnimalEnv): void {
    const s = this.snap;
    const f = s.food;
    if (!this.pet) s.visitLeft = Math.max(0, s.visitLeft - step);
    s.emerge = clamp(s.emerge + step * (s.visitLeft <= 0 && !this.pet ? -0.6 : 0.8), 0, 1);
    if (!this.pet && s.visitLeft <= 0 && s.emerge <= 0) {
      this.despawnNow();
      return;
    }
    // brush near: a puff of ink, and it jets away seaward
    if (env.brush?.active && s.calmTimer <= 0 && Math.hypot(env.brush.x - s.x, env.brush.z - s.z) < ANIMALS.octopusInkRadius && s.ink <= 0) {
      s.ink = 1.6;
      s.startles++;
      const away = Math.atan2(s.z - env.brush.z, s.x - env.brush.x);
      this.targetX = this.clampX(s.x + Math.cos(away) * 3);
      this.targetZ = Math.min(s.z - 1.5, s.z + Math.sin(away) * 3);
      s.phase = 'fleeing';
      this.phaseTimer = 2.5;
    }
    if (f.active && f.floating && s.phase !== 'fleeing' && Math.hypot(f.x - s.x, f.z - s.z) < ANIMALS.foodNoticeRadius) {
      s.phase = 'seeking_food';
      this.targetX = f.x;
      this.targetZ = f.z;
      if (Math.hypot(f.x - s.x, f.z - s.z) < 0.5) {
        this.eatFloating();
        s.phase = 'pausing';
        this.phaseTimer = 2;
      }
    }
    if (this.pet?.mood === 'sleepy' && !f.active) {
      s.phase = 'sleeping';
      s.speed = 0;
    } else if (s.phase === 'sleeping') {
      s.phase = 'pausing';
      this.phaseTimer = 1;
    }

    this.phaseTimer -= step;
    if ((s.phase === 'pausing' || s.phase === 'swimming' || s.phase === 'wandering') && this.phaseTimer <= 0) {
      if (s.phase === 'pausing') {
        // pick a new spot in the shallows, near its home when it has one
        const home = this.pet?.home;
        const spot = this.pickSurfSpot(env, ANIMALS.octopusMinDepth, ANIMALS.octopusMaxDepth, home ?? { x: s.x + (this.rand() - 0.5) * 5, z: s.z });
        this.targetX = spot ? spot.x : s.x;
        this.targetZ = spot ? spot.z : s.z - 1;
        s.phase = 'wandering';
        this.phaseTimer = 6;
      } else {
        s.phase = 'pausing';
        this.phaseTimer = 2.5 + this.rand() * 5;
      }
    }
    if (s.phase === 'fleeing' && this.phaseTimer <= 0) {
      s.phase = 'pausing';
      this.phaseTimer = 2;
    }

    const moving = s.phase === 'wandering' || s.phase === 'fleeing' || s.phase === 'seeking_food';
    if (moving) {
      const dx = this.targetX - s.x;
      const dz = this.targetZ - s.z;
      const dist = Math.hypot(dx, dz);
      const speed = this.kind.swimSpeed * (s.phase === 'fleeing' ? 3.5 : 1);
      if (dist > 0.1) {
        const mv = Math.min(dist, speed * step);
        const nx = this.clampX(s.x + (dx / dist) * mv);
        const nz = clamp(s.z + (dz / dist) * mv, -HALF_Z + 1, SHORELINE_Z + 2);
        // stays in the water: never creeps out onto the sand
        if (env.waterAt(nx, nz) >= ANIMALS.octopusMinDepth * 0.7) {
          s.x = nx;
          s.z = nz;
        } else {
          this.targetZ = s.z - 1.5;
        }
        s.speed = mv / step;
        s.facing = lerpAngle(s.facing, Math.atan2(dx, dz), step * 2.5);
      } else if (s.phase === 'wandering') {
        s.phase = 'pausing';
        this.phaseTimer = 2 + this.rand() * 4;
      }
    } else {
      s.speed = 0;
    }
    // the water went out from under it: move seaward
    if (env.waterAt(s.x, s.z) < ANIMALS.octopusMinDepth && !moving) {
      s.phase = 'wandering';
      this.targetX = s.x;
      this.targetZ = s.z - 2;
      this.phaseTimer = 6;
    }
    s.scuttlePhase += step * (moving ? 5 : 1.2);
    // blends into the sand when still, shows its colours when it moves or inks
    s.tint = clamp(s.tint + step * (moving || s.ink > 0 ? -1.5 : 0.35), 0, 1);
    s.y = this.swimY(env.heightAt(s.x, s.z), env.waterAt(s.x, s.z));
  }

  /** Turtle flipper prints, left and right, as it crawls over the sand. */
  private layTrack(): void {
    const s = this.snap;
    if (Number.isFinite(this.lastTrackX) && Math.hypot(s.x - this.lastTrackX, s.z - this.lastTrackZ) < 0.35) return;
    this.lastTrackX = s.x;
    this.lastTrackZ = s.z;
    this.trackSide = -this.trackSide;
    const side = this.trackSide * s.size * 0.32;
    const px = s.x + Math.cos(s.facing) * side;
    const pz = s.z - Math.sin(s.facing) * side;
    const n = ANIMALS.turtleTracks;
    if (s.trackCount >= n) {
      s.tracks.copyWithin(0, 2);
      s.trackAge.copyWithin(0, 1);
      s.trackCount = n - 1;
    }
    s.tracks[s.trackCount * 2] = px;
    s.tracks[s.trackCount * 2 + 1] = pz;
    s.trackAge[s.trackCount] = 0;
    s.trackCount++;
    s.trackGen++;
  }

  /**
   * Age the turtle's flipper prints and drop the ones older than
   * `turtleTrackLife`, so the trail stays a short fresh one behind the turtle
   * instead of piling up permanently behind a resident pet.
   */
  private ageTracks(step: number): void {
    const s = this.snap;
    if (s.species !== 'turtle' || s.trackCount === 0) return;
    const life = ANIMALS.turtleTrackLife;
    for (let i = 0; i < s.trackCount; i++) s.trackAge[i] += step;
    let expired = 0;
    while (expired < s.trackCount && s.trackAge[expired] >= life) expired++;
    if (expired === 0) return;
    const keep = s.trackCount - expired;
    if (keep > 0) {
      s.tracks.copyWithin(0, expired * 2);
      s.trackAge.copyWithin(0, expired);
    }
    s.trackCount = keep;
    s.trackGen++;
  }

  /** The sandpiper's favourite spot: just below where the last wave reached, as it pulls back. */
  private pickSwashTarget(env: AnimalEnv): boolean {
    const s = this.snap;
    const x = this.clampX(s.x + (this.rand() - 0.5) * 5);
    // walk up from the sea to the first dry cell: that's the wave's edge now
    for (let z = SHORELINE_Z - 1.5; z < HALF_Z - ANIMALS.edgeMargin; z += 0.25) {
      if (!Number.isFinite(env.heightAt(x, z))) continue;
      if (env.waterAt(x, z) < ANIMALS.crabWetDepth) {
        s.phase = 'wandering';
        this.targetX = x;
        this.targetZ = this.clampZ(z - 0.2 + this.rand() * 0.6);
        this.phaseTimer = Math.hypot(x - s.x, this.targetZ - s.z) / this.kind.landSpeed + 0.6;
        return true;
      }
    }
    return false;
  }
}
