import { describe, expect, it } from 'vitest';
import { pitchFor } from '../../model/pitch';
import { cameraView, goalHeight, stadiumLayout, stride, toWorld, turnTowards, type CameraPreset, type V3 } from '../views';

// An independent check of what a camera sees (not the code under test).
const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const norm = (a: V3): V3 => {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
function inView(cam: { position: V3; target: V3; fov: number }, aspect: number, pt: V3): boolean {
  const f = norm(sub(cam.target, cam.position));
  const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
  const u = cross(r, f);
  const d = sub(pt, cam.position);
  const z = dot(d, f);
  if (z <= 0) return false;
  const t = Math.tan(((cam.fov / 2) * Math.PI) / 180);
  return Math.abs(dot(d, u) / z) <= t * 1.001 && Math.abs(dot(d, r) / z) <= t * aspect * 1.001;
}

describe('3D view maths', () => {
  it('puts the centre spot at the origin with home attacking +X', () => {
    const p = pitchFor(11);
    expect(toWorld(p, { x: p.length / 2, y: p.width / 2 })).toEqual({ x: 0, y: 0, z: 0 });
    expect(toWorld(p, { x: p.length, y: 0 }).x).toBe(p.length / 2);
  });

  it('uses real goal sizes', () => {
    expect(goalHeight(pitchFor(11))).toBeCloseTo(2.44);
    expect(goalHeight(pitchFor(5))).toBe(2);
  });

  it('animates running with speed: still when standing, longer swings when sprinting', () => {
    expect(stride(0).swing).toBe(0);
    expect(stride(3).swing).toBeGreaterThan(0);
    expect(stride(8).swing).toBeGreaterThan(stride(3).swing);
    expect(stride(15).swing).toBeLessThanOrEqual(0.85);
    expect(stride(8).rate).toBeGreaterThan(stride(3).rate);
  });

  it('turns the short way round', () => {
    expect(turnTowards(3, -3, 10)).toBeCloseTo(-3 + 2 * Math.PI, 6);
    expect(turnTowards(0, 1, 0.25)).toBeCloseTo(0.25, 6);
  });

  it('keeps every camera above the grass and out of the stands, on any pitch and screen', () => {
    const presets: Exclude<CameraPreset, 'free'>[] = ['broadcast', 'tactical', 'behind', 'follow', 'top'];
    for (const format of [5, 7, 9, 11]) {
      const p = pitchFor(format);
      const st = stadiumLayout(p);
      for (const aspect of [16 / 9, 0.55]) {
        for (const focus of [{ x: 0, y: 0, z: 0 }, { x: -p.length / 2, y: 0, z: p.width / 2 }, { x: p.length / 2, y: 0, z: -p.width / 2 }]) {
          for (const preset of presets) {
            const v = cameraView(preset, p, focus, aspect);
            expect(v.position.y, `${format} ${preset}`).toBeGreaterThan(1);
            // Never behind (inside) the near stand or the end stand behind our goal.
            const inStandSide = v.position.z > st.front + 0.5 && v.position.y < st.rise + 2;
            const inStandEnd = v.position.x < -(p.length / 2 + st.goalDepth + st.off + st.gap) && v.position.y < st.rise + 2;
            expect(inStandSide || inStandEnd, `${format} ${preset} ${aspect}`).toBe(false);
            if (preset === 'broadcast') expect(v.position.z).toBeLessThanOrEqual(st.front + 3.01);
          }
        }
      }
    }
  });

  it('frames the whole pitch in the tactical and top views, wide or tall screen', () => {
    for (const format of [5, 11]) {
      const p = pitchFor(format);
      for (const aspect of [16 / 9, 4 / 3, 0.55]) {
        for (const preset of ['tactical', 'top'] as const) {
          const v = cameraView(preset, p, { x: 0, y: 0, z: 0 }, aspect);
          for (const cx of [-1, 1]) {
            for (const cz of [-1, 1]) {
              expect(inView(v, aspect, { x: (cx * p.length) / 2, y: 0, z: (cz * p.width) / 2 }), `${format} ${preset} ${aspect}`).toBe(true);
            }
          }
        }
      }
    }
  });
});
