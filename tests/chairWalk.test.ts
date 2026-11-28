import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it } from 'vitest';

import { WORLD_SIZE_X, WORLD_SIZE_Z } from '../src/config';
import { CameraController, CHAIR } from '../src/input/cameraController';

const engines: NullEngine[] = [];

function makeCam(waterDepth: (x: number, z: number) => number): CameraController {
  const engine = new NullEngine();
  engines.push(engine);
  const scene = new Scene(engine);
  const canvas = { clientWidth: 1280, clientHeight: 800 } as unknown as HTMLCanvasElement;
  const cam = new CameraController(scene, canvas, WORLD_SIZE_X / 192);
  cam.groundHeight = () => 0.5;
  cam.waterDepth = waterDepth;
  cam.setMode('chair', false);
  return cam;
}

afterEach(() => {
  while (engines.length) engines.pop()!.dispose();
});

describe('chair mode walking', () => {
  it('walks forward, back, left and right across dry sand', () => {
    // shoreline at z = 1: water for z <= 1, dry sand for z > 1
    const cam = makeCam((_x, z) => (z <= 1 ? 1 - z + 0.05 : 0));
    const startX = cam.seatX;
    const startZ = cam.seatZ;

    // walk forward (toward sea, -Z) with W
    cam.held.add('w');
    for (let i = 0; i < 30; i++) cam.update(1 / 60, false);
    cam.held.delete('w');
    expect(cam.seatZ).toBeLessThan(startZ - 0.5);
    expect(cam.seatX).toBeCloseTo(startX, 3);

    // walk back (inland, +Z) with on-screen button
    const midZ = cam.seatZ;
    cam.walkFwd = -1;
    for (let i = 0; i < 60; i++) cam.update(1 / 60, false);
    cam.walkFwd = 0;
    expect(cam.seatZ).toBeGreaterThan(midZ + 0.5);

    // walk right (-X when facing sea) with D
    cam.held.add('d');
    for (let i = 0; i < 40; i++) cam.update(1 / 60, false);
    cam.held.delete('d');
    expect(cam.seatX).toBeLessThan(startX - 0.5);
  });

  it('walks relative to where you are looking and allows full 360-degree turning', () => {
    const cam = makeCam((_x, z) => (z <= 1 ? 0.5 : 0));
    // turn 180 degrees to face inland (+Z)
    cam.look(Math.PI, 0);
    const startZ = cam.seatZ;
    cam.held.add('w');
    for (let i = 0; i < 40; i++) cam.update(1 / 60, false);
    cam.held.delete('w');
    expect(cam.seatZ).toBeGreaterThan(startZ + 0.5);
  });

  it('stops at the waterline and never lets the user walk into the water', () => {
    const shorelineZ = 2;
    const waterAt = (_x: number, z: number) => (z < shorelineZ ? (shorelineZ - z) * 0.2 : 0);
    const cam = makeCam(waterAt);

    // walk straight toward the sea for 10 seconds
    cam.held.add('w');
    for (let i = 0; i < 600; i++) cam.update(1 / 60, false);
    cam.held.delete('w');

    // stopped right outside the waterline (including foot clearance margin)
    expect(cam.seatZ).toBeGreaterThanOrEqual(shorelineZ + CHAIR.waterMargin - 0.15);
    expect(waterAt(cam.seatX, cam.seatZ)).toBeLessThanOrEqual(CHAIR.maxWaterDepth);
  });

  it('slides along the shoreline when walking diagonally into the water', () => {
    const shorelineZ = 4;
    const waterAt = (_x: number, z: number) => (z < shorelineZ ? 0.5 : 0);
    const cam = makeCam(waterAt);
    cam.seatZ = shorelineZ + CHAIR.waterMargin + 0.05;
    const startX = cam.seatX;

    // walk diagonally seaward + right
    cam.held.add('w');
    cam.held.add('d');
    for (let i = 0; i < 90; i++) cam.update(1 / 60, false);
    cam.held.clear();

    expect(cam.seatX).toBeLessThan(startX - 1);
    expect(cam.seatZ).toBeGreaterThanOrEqual(shorelineZ + CHAIR.waterMargin - 0.05);
    expect(waterAt(cam.seatX, cam.seatZ)).toBe(0);
  });

  it('blocks walking into or skipping over a water-filled trench on the beach', () => {
    // narrow 0.4 m wet trench across the beach at z = 7.5..7.9
    const waterAt = (_x: number, z: number) => (z >= 7.5 && z <= 7.9 ? 0.25 : 0);
    const cam = makeCam(waterAt);
    expect(cam.seatZ).toBeGreaterThan(8);

    // hold W long enough to reach top sprint speed
    cam.held.add('w');
    for (let i = 0; i < 300; i++) cam.update(1 / 60, false);
    cam.held.delete('w');

    // must stay on the inland side of the trench, never crossing it
    expect(cam.seatZ).toBeGreaterThan(7.9);
    expect(waterAt(cam.seatX, cam.seatZ)).toBe(0);
  });

  it('nudges the walker back inland onto dry sand when a wave or rising tide reaches them', () => {
    let waterlineZ = 2;
    const waterAt = (_x: number, z: number) => (z < waterlineZ ? (waterlineZ - z) * 0.2 : 0);
    const cam = makeCam(waterAt);
    cam.seatZ = 3;
    expect(waterAt(cam.seatX, cam.seatZ)).toBe(0);

    // wave washes up to z = 5
    waterlineZ = 5;
    for (let i = 0; i < 120; i++) cam.update(1 / 60, false);

    expect(cam.seatZ).toBeGreaterThanOrEqual(waterlineZ);
    expect(waterAt(cam.seatX, cam.seatZ)).toBeLessThanOrEqual(CHAIR.maxWaterDepth);
  });

  it('respects beach edges and off-beach Infinity waterDepth past the back of the beach', () => {
    const cam = makeCam((_x, z) => (z > WORLD_SIZE_Z / 2 ? Infinity : 0));
    cam.maxZ = WORLD_SIZE_Z / 2 + 12; // pretend another beach has inland rows

    // try walking inland past WORLD_SIZE_Z / 2
    cam.walkFwd = -1;
    for (let i = 0; i < 300; i++) cam.update(1 / 60, false);
    cam.walkFwd = 0;
    expect(cam.seatZ).toBeLessThanOrEqual(WORLD_SIZE_Z / 2 - CHAIR.waterMargin + 0.05);
  });

  it('places the chair on dry sand when entering chair mode over a flooded default seat', () => {
    const cam = makeCam((_x, z) => (z < 12 ? 0.4 : 0));
    expect(cam.seatZ).toBeGreaterThanOrEqual(12);
  });
});
