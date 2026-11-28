import { describe, expect, it } from 'vitest';
import { povSubject } from '../../components/Pitch3D';
import type { Snapshot3D } from '../Scene3D';
import { eyePoint, gazeDir, gazeFor, POV_FOV, povCamera, seesPoint, smoothPov, type PovState, type V3 } from '../views';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const head = (x: number, z: number, scale = 1): V3 => ({ x, y: 1.77 * scale, z });

describe('player view camera', () => {
  it('puts the eyes just in front of the face, at the figure scale', () => {
    const e = eyePoint({ x: 10, y: 2.3, z: -4 }, 0, 1.3);
    expect(e.x).toBeCloseTo(10);
    expect(e.z).toBeGreaterThan(-4 + 0.15 * 1.3); // in front of the head (and past the nose)
    expect(e.z).toBeLessThan(-4 + 0.3 * 1.3);
    expect(e.y).toBeGreaterThan(2.3);
    // Facing +X (yaw π/2) the eyes move along +X instead.
    const side = eyePoint({ x: 0, y: 1.8, z: 0 }, Math.PI / 2, 1);
    expect(side.x).toBeGreaterThan(0.15);
    expect(Math.abs(side.z)).toBeLessThan(1e-9);
    // Larger figures: further from the head centre.
    expect(eyePoint({ x: 0, y: 0, z: 0 }, 0, 1.3).z).toBeGreaterThan(eyePoint({ x: 0, y: 0, z: 0 }, 0, 1).z);
  });

  it('looks where the head faces when the ball is straight ahead', () => {
    const eye = head(0, 0);
    const g = gazeFor(eye, 0.4, { x: Math.sin(0.4) * 20, y: 0.1, z: Math.cos(0.4) * 20 }, false, 72, 16 / 9);
    expect(g.yaw).toBeCloseTo(0.4, 5);
    expect(g.pitch).toBeLessThan(0); // a little down, at the grass and the ball
    expect(g.pitch).toBeGreaterThan(-0.2);
  });

  it('blends the head direction with the ball, more so off the ball', () => {
    const eye = head(0, 0);
    const ball = { x: 15, y: 0.1, z: 0 }; // 90° to the player's left (+X), head facing +Z
    const off = gazeFor(eye, 0, ball, false, 72, 16 / 9);
    const on = gazeFor(eye, 0, ball, true, 72, 16 / 9);
    expect(off.yaw).toBeGreaterThan(0);
    expect(off.yaw).toBeLessThan(Math.PI / 2);
    expect(on.yaw).toBeLessThan(off.yaw); // on the ball they look ahead more
    // Either way the ball stays in the picture.
    for (const g of [on, off]) {
      const cam = povCamera({ eye, ...g }, 'eyes', 1);
      expect(seesPoint(cam, 16 / 9, ball)).toBe(true);
    }
  });

  it('keeps the ball in shot on a narrow (phone) screen too', () => {
    const eye = head(0, 0);
    const ball = { x: 12, y: 0.1, z: 6 };
    const g = gazeFor(eye, 0, ball, false, 72, 0.6);
    expect(seesPoint(povCamera({ eye, ...g }, 'eyes', 1), 0.6, ball)).toBe(true);
  });

  it('blends the short way round across ±π', () => {
    const eye = head(0, 0);
    const ball = { x: Math.sin(-3.0) * 20, y: 0.1, z: Math.cos(-3.0) * 20 };
    const g = gazeFor(eye, 3.0, ball, false, 72, 16 / 9);
    // Between 3.0 and -3.0 the short way is through π, not through 0.
    expect(Math.abs(wrap(g.yaw - Math.PI))).toBeLessThan(0.3);
  });

  it("doesn't spin round to a ball behind the player's back", () => {
    const g = gazeFor(head(0, 0), 0, { x: 0.5, y: 0.1, z: -20 }, false, 72, 16 / 9);
    // It turns towards it (as a head would) but isn't forced to face it.
    expect(Math.abs(g.yaw)).toBeLessThan(Math.PI * 0.75);
  });

  it('looks down for a ball at the feet and up for a high ball, within limits', () => {
    const eye = head(0, 0);
    const feet = gazeFor(eye, 0, { x: -0.1, y: 0.15, z: 1.2 }, false, 72, 16 / 9);
    const high = gazeFor(eye, 0, { x: 0, y: 9, z: 10 }, false, 72, 16 / 9);
    const dribble = gazeFor(eye, 0, { x: -0.1, y: 0.15, z: 1.2 }, true, 72, 16 / 9);
    expect(feet.pitch).toBeLessThan(-0.3);
    expect(feet.pitch).toBeGreaterThanOrEqual(-0.45); // never just the grass
    expect(high.pitch).toBeGreaterThan(0.1);
    expect(high.pitch).toBeLessThanOrEqual(0.45);
    expect(dribble.pitch).toBeGreaterThan(feet.pitch); // dribbling: head up, ball low in the picture
    // No ball: straight ahead, slightly down.
    expect(gazeFor(eye, 1, undefined, false, 72, 1)).toEqual({ yaw: 1, pitch: -0.06 });
  });

  it('damps the stride bob but keeps up with the run', () => {
    let s: PovState | undefined;
    const dt = 1 / 60;
    let minY = Infinity;
    let maxY = -Infinity;
    let lag = 0;
    for (let i = 0; i < 600; i++) {
      const t = i * dt;
      const x = 7 * t; // sprinting at 7 m/s
      const y = 1.8 + 0.05 * Math.abs(Math.cos(t * 9)); // bob of 5 cm
      s = smoothPov(s, { eye: { x, y, z: 0 }, yaw: Math.PI / 2, pitch: -0.1 }, dt);
      if (i > 300) {
        minY = Math.min(minY, s.eye.y);
        maxY = Math.max(maxY, s.eye.y);
        lag = Math.max(lag, x - s.eye.x);
      }
    }
    expect(maxY - minY).toBeLessThan(0.05 * 0.25);
    expect(lag).toBeLessThan(0.25);
  });

  it('starts exactly where asked, and turns the short way round', () => {
    const first = smoothPov(undefined, { eye: { x: 1, y: 2, z: 3 }, yaw: 1, pitch: 0 }, 0.016);
    expect(first.eye).toEqual({ x: 1, y: 2, z: 3 });
    const a = smoothPov({ eye: { x: 0, y: 0, z: 0 }, yaw: 3.0, pitch: 0 }, { eye: { x: 0, y: 0, z: 0 }, yaw: -3.0, pitch: 0 }, 0.05);
    // From 3.0 towards -3.0 through π: the yaw grows (or wraps past π), never heads to 0.
    expect(Math.abs(wrap(a.yaw - 3.0))).toBeLessThan(0.3);
    expect(wrap(a.yaw - 3.0)).toBeGreaterThan(0);
  });

  it('first person: at the eyes, looking along the gaze, with a natural field of view', () => {
    const s: PovState = { eye: { x: 3, y: 1.8, z: 4 }, yaw: 0.3, pitch: -0.1 };
    const cam = povCamera(s, 'eyes', 1);
    expect(cam.position).toEqual(s.eye);
    expect(cam.fov).toBeGreaterThanOrEqual(70);
    expect(cam.fov).toBeLessThanOrEqual(75);
    const d = gazeDir(s);
    const len = Math.hypot(cam.target.x - cam.position.x, cam.target.y - cam.position.y, cam.target.z - cam.position.z);
    expect((cam.target.x - cam.position.x) / len).toBeCloseTo(d.x);
    expect((cam.target.z - cam.position.z) / len).toBeCloseTo(d.z);
  });

  it('over the shoulder: behind, above and to the side, with the player and the view ahead in shot', () => {
    const s: PovState = { eye: { x: 0, y: 2.3, z: 0 }, yaw: 0, pitch: -0.1 };
    const cam = povCamera(s, 'shoulder', 1.3);
    expect(cam.position.z).toBeLessThan(-2); // behind (player faces +Z)
    expect(cam.position.y).toBeGreaterThan(s.eye.y);
    expect(Math.abs(cam.position.x)).toBeGreaterThan(0.3);
    expect(cam.fov).toBe(POV_FOV.shoulder);
    expect(seesPoint(cam, 16 / 9, { x: 0, y: 2.0, z: 0 })).toBe(true); // their head
    expect(seesPoint(cam, 16 / 9, { x: 0, y: 0, z: 20 })).toBe(true); // the grass ahead
    // Never below the grass, even for a tiny figure looking down.
    expect(povCamera({ eye: { x: 0, y: 0.5, z: 0 }, yaw: 0, pitch: -0.6 }, 'shoulder', 0.3).position.y).toBeGreaterThan(0.5);
  });
});

describe('whose eyes', () => {
  const snap = (carrier?: string, owner?: string): Snapshot3D => ({
    players: ['a', 'b', 'c'].map((id) => ({ id, team: 'home', gk: false, number: '1', label: id, x: 0, y: 0 })),
    ball: { x: 0, y: 0, height: 0, carrier, owner },
    playing: true,
    arrows: [],
  });

  it('uses the chosen player while they are on the pitch', () => {
    expect(povSubject('b', snap('a'))).toBe('b');
    expect(povSubject('gone', snap('a'))).toBe('a');
  });

  it('follows the ball carrier, keeping the last one while nobody has it', () => {
    expect(povSubject('carrier', snap('c'))).toBe('c');
    expect(povSubject('carrier', snap(undefined), 'a')).toBe('a');
    expect(povSubject('carrier', snap(undefined, 'b'))).toBe('b');
    expect(povSubject('carrier', snap('zzz'), 'zzz')).toBeUndefined();
  });
});

describe('gaze continuity', () => {
  it('changes smoothly as the ball moves round behind the player', () => {
    const eye = head(0, 0);
    let prev: number | undefined;
    for (let a = 0; a <= Math.PI; a += 0.01) {
      const g = gazeFor(eye, 0, { x: Math.sin(a) * 15, y: 0.1, z: Math.cos(a) * 15 }, false, 72, 16 / 9);
      if (prev !== undefined) expect(Math.abs(wrap(g.yaw - prev))).toBeLessThan(0.05);
      prev = g.yaw;
    }
  });
});
