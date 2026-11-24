// Wild beach visitors & feeding — pure TypeScript state machine & steering
// (no DOM or Babylon imports, so it runs cleanly in Vitest and on the main thread).
//
// Phase 1 (A1): a single wild sand crab occasionally emerges from the sand,
// scurries sideways in short bursts, pauses to wave its claws, dodges incoming
// waves and the player's brush, and burrows back into the sand.
// Phase 2 (A2): dropping a beach snack (`dropFood`) either baits a wild crab
// to appear sooner (4x faster wait) or draws an active crab over to nibble,
// extending its visit and calming it around the brush.

import { ANIMALS, PROFILE, WORLD_SIZE_X, WORLD_SIZE_Z } from '../config';

export type AnimalSpecies = 'crab' | 'dolphin';

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
  | 'breaching';

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
}

export interface ResidentPet {
  species: AnimalSpecies;
  name: string;
  mood: PetMood;
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
      food: { active: false, x: 0, y: 0, z: 5, timeLeft: 0 },
    };
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
    if (!s.active && env) {
      this.spawnNow(env, undefined, pet.species);
    }
    if (s.active) {
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
    const spot = pos ? this.validateSpot(pos.x, pos.z, env) : this.pickSpawnSpot(env);
    if (!spot) return false;
    const f = this.snap.food;
    f.active = true;
    f.x = spot.x;
    f.y = spot.y;
    f.z = spot.z;
    f.timeLeft = ANIMALS.foodDuration;
    this.foodWetTimer = 0;
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

  /** Immediately spawn a wild animal (`'crab'` or `'dolphin'`, used by ?debug=1 and tests). */
  spawnNow(env: AnimalEnv, pos?: { x: number; z: number }, species: AnimalSpecies = 'crab'): boolean {
    if (species === 'dolphin') return this.spawnDolphin(env, pos);
    const spot = pos ? this.validateSpot(pos.x, pos.z, env) : this.pickSpawnSpot(env);
    if (!spot) return false;
    const s = this.snap;
    s.species = 'crab';
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
    s.size = ANIMALS.crabSize * (0.9 + this.rand() * 0.2);
    s.visitLeft = ANIMALS.visitMin + this.rand() * (ANIMALS.visitMax - ANIMALS.visitMin);
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
    this.waitTimer = this.rollWait();
    s.nextSpawnIn = this.waitTimer;
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
      if (Number.isFinite(fh)) f.y = fh;
      if (env.waterAt(f.x, f.z) > 0.08) {
        this.foodWetTimer += step;
      } else {
        this.foodWetTimer = Math.max(0, this.foodWetTimer - step * 2);
      }
      if (f.timeLeft <= 0 || this.foodWetTimer >= 1.2) {
        f.active = false;
        f.timeLeft = 0;
      }
    }

    if (s.happyTimer > 0) s.happyTimer = Math.max(0, s.happyTimer - step);
    if (s.calmTimer > 0) s.calmTimer = Math.max(0, s.calmTimer - step);

    // Resident pet is always present on the beach
    if (this.pet && s.phase === 'absent') {
      this.spawnNow(env, undefined, this.pet.species);
      return;
    }

    if (s.phase === 'absent') {
      const rate = f.active ? ANIMALS.foodBaitMultiplier : 1;
      this.waitTimer -= step * rate;
      s.nextSpawnIn = Math.max(0, this.waitTimer / rate);
      if (this.waitTimer <= 0) {
        const chance = f.active ? Math.min(0.95, ANIMALS.visitChance + 0.25) : ANIMALS.visitChance;
        if (this.rand() < chance) {
          // Bait on dry sand attracts crabs; unbaited rolls can spawn an offshore dolphin
          const pickDolphin = !f.active && this.rand() < ANIMALS.dolphinChance;
          if (pickDolphin && this.spawnNow(env, undefined, 'dolphin')) return;
          const nearFood = f.active ? this.pickSpotNear(f.x, f.z, 3.5, 7.5, env) : null;
          if (this.spawnNow(env, nearFood ?? undefined, 'crab')) return;
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

    // React to incoming wave wash
    if (env.waterAt(s.x, s.z) > ANIMALS.crabWetDepth && s.phase !== 'fleeing') {
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
    if (f.active && (s.phase === 'pausing' || s.phase === 'wandering')) {
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
    const maxSpeed =
      s.phase === 'fleeing'
        ? ANIMALS.crabFleeSpeed
        : s.phase === 'seeking_food'
          ? ANIMALS.crabSpeed * 1.2
          : ANIMALS.crabSpeed * moodScale;
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
      if (s.visitLeft <= 0 && env.waterAt(s.x, s.z) < ANIMALS.crabWetDepth) {
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

    // Don't voluntarily walk into deep water; turn upslope instead
    const nextWater = env.waterAt(nx, nz);
    const curWater = env.waterAt(s.x, s.z);
    if (nextWater > ANIMALS.crabWetDepth * 2 && nextWater > curWater) {
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

    // Sideways crab gait: face perpendicular to movement direction
    const moveYaw = Math.atan2(dirX, dirZ);
    const desiredFacing = moveYaw + this.sideSign * (Math.PI * 0.5);
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
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = this.rand() * Math.PI * 2;
      const dist = 1.1 + this.rand() * 3.2;
      const tx = this.clampX(s.x + Math.cos(angle) * dist);
      const tz = this.clampZ(s.z + Math.sin(angle) * dist);
      if (env.waterAt(tx, tz) < ANIMALS.crabWetDepth && Number.isFinite(env.heightAt(tx, tz))) {
        s.phase = 'wandering';
        this.targetX = tx;
        this.targetZ = tz;
        this.phaseTimer = dist / ANIMALS.crabSpeed + 1.0;
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

    // Leave once crossed the beach or visit timer finishes
    if (Math.abs(s.x) > HALF_X - 1.0 || (s.visitLeft <= 0 && s.phase !== 'breaching')) {
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
}
