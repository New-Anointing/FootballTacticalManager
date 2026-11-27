import type { PitchSpec } from '../model/pitch';
import type { Vec } from '../model/types';

/**
 * Pure helpers for the 3D view (no WebGL), so they can be tested.
 *
 * World coordinates are metres: X along the pitch (home attacks towards +X, as in the
 * 2D view), Z across it (the 2D view's y, so the far touchline is at -Z) and Y up,
 * with the centre spot at the origin.
 */

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const toWorld = (p: PitchSpec, v: Vec, height = 0): V3 => ({ x: v.x - p.length / 2, y: height, z: v.y - p.width / 2 });

/** Crossbar height: full-size goals are 2.44 m, futsal and small-sided goals 2 m. */
export function goalHeight(p: PitchSpec): number {
  return p.goalWidth >= 7 ? 2.44 : 2;
}

/**
 * Players are drawn a little larger than life on big pitches (as tactical replays do),
 * so they stay readable from a broadcast camera.
 */
export function figureScale(p: PitchSpec): number {
  return Math.min(1.3, Math.max(1, p.length / 80));
}

/** Where the stadium sits round the pitch (shared by the scene and the cameras). */
export function stadiumLayout(p: PitchSpec) {
  const L = p.length;
  const goalDepth = Math.max(1, goalHeight(p) * 0.8);
  const off = Math.max(2.5, L * 0.04); // advertising boards beyond the lines
  const gap = Math.max(1.5, L * 0.015); // walkway between boards and stand
  const rise = Math.max(5, L * 0.12); // height of the seating bank
  const deep = Math.max(8, L * 0.19); // depth of the seating bank
  return { goalDepth, off, gap, rise, deep, front: p.width / 2 + off + gap };
}

export type CameraPreset = 'broadcast' | 'tactical' | 'behind' | 'top' | 'follow' | 'free';

export const CAMERA_PRESETS: { id: CameraPreset; label: string; title: string }[] = [
  { id: 'broadcast', label: 'TV', title: 'Broadcast camera from the stand, following the ball' },
  { id: 'tactical', label: 'Tactical', title: 'High camera showing the whole pitch' },
  { id: 'behind', label: 'Behind goal', title: 'From behind our goal, looking up the pitch' },
  { id: 'follow', label: 'Follow', title: 'Low camera following the ball' },
  { id: 'top', label: 'Top', title: 'Straight down, like the tactics board' },
  { id: 'free', label: 'Free', title: 'Drag to look around, scroll or pinch to zoom' },
];

export interface CameraView {
  position: V3;
  target: V3;
  fov: number;
}

/** Is a world point inside a perspective camera's view? */
export function seesPoint(cam: { position: V3; target: V3; fov: number }, aspect: number, pt: V3): boolean {
  const fx = cam.target.x - cam.position.x;
  const fy = cam.target.y - cam.position.y;
  const fz = cam.target.z - cam.position.z;
  const fl = Math.hypot(fx, fy, fz) || 1;
  const f = { x: fx / fl, y: fy / fl, z: fz / fl };
  // right = f × up(0,1,0), up' = right × f
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.z) || 1;
  r = { x: r.x / rl, y: 0, z: r.z / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const d = { x: pt.x - cam.position.x, y: pt.y - cam.position.y, z: pt.z - cam.position.z };
  const depth = d.x * f.x + d.y * f.y + d.z * f.z;
  if (depth <= 0) return false;
  const t = Math.tan((cam.fov / 2) * THREE_DEG);
  const up = (d.x * u.x + d.y * u.y + d.z * u.z) / depth;
  const side = (d.x * r.x + d.y * r.y + d.z * r.z) / depth;
  return Math.abs(up) <= t && Math.abs(side) <= t * aspect;
}

/**
 * How far a camera at `elevation` (radians above horizontal, looking at the centre spot
 * from the near side) must be for the whole pitch, plus a margin, to be in shot.
 */
function fitDistance(p: PitchSpec, aspect: number, fov: number, elevation: number, margin: number): number {
  const corners: V3[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push({ x: sx * (p.length / 2 + margin), y: 0, z: sz * (p.width / 2 + margin) });
  const dir = { x: 0, y: Math.sin(elevation), z: Math.cos(elevation) + (elevation > 1.5 ? 0.035 : 0) };
  let d = p.length * 0.3;
  for (let k = 0; k < 80; k++) {
    const cam = { position: { x: 0, y: dir.y * d, z: dir.z * d }, target: { x: 0, y: 0, z: 0 }, fov };
    if (corners.every((c) => seesPoint(cam, aspect, c))) return d;
    d *= 1.04;
  }
  return d;
}

const THREE_DEG = Math.PI / 180;

/**
 * Where a camera preset sits for a given focus point (normally the ball), in world
 * coordinates. Sizes scale with the pitch so a futsal court and a full pitch both frame
 * well; on a tall screen (a phone held upright) the cameras pull back to keep the play in.
 */
export function cameraView(preset: Exclude<CameraPreset, 'free'>, p: PitchSpec, focus: V3, aspect = 16 / 9): CameraView {
  const L = p.length;
  const W = p.width;
  const fx = Math.max(-L / 2, Math.min(L / 2, focus.x));
  const fz = Math.max(-W / 2, Math.min(W / 2, focus.z));
  const pull = Math.max(1, 1.35 / Math.max(0.3, aspect));
  const away = (target: V3, offset: V3, k = pull): V3 => ({ x: target.x + offset.x * k, y: target.y + offset.y * k, z: target.z + offset.z * k });
  // Cameras stay inside the stadium (in front of the advertising boards).
  const inside = (v: V3): V3 => ({
    x: Math.max(-L / 2 - 1, Math.min(L / 2 + 1, v.x)),
    y: v.y,
    z: Math.min(W / 2 + Math.max(2, L * 0.03), v.z),
  });
  switch (preset) {
    case 'broadcast': {
      // The TV gantry on the front of the main stand's roof, panning with the play. It
      // can't back away on a tall screen, so it widens its angle instead.
      const st = stadiumLayout(p);
      const target = { x: fx, y: 0, z: fz * 0.3 };
      return { position: { x: fx * 0.85, y: st.rise + 6.5, z: st.front + 3 }, target, fov: Math.min(70, 34 * pull) };
    }
    case 'tactical': {
      const fov = 40;
      const elevation = 54 * THREE_DEG;
      const d = fitDistance(p, aspect, fov, elevation, Math.max(3, L * 0.04));
      return { position: { x: 0, y: d * Math.sin(elevation), z: d * Math.cos(elevation) }, target: { x: 0, y: 0, z: 0 }, fov };
    }
    case 'behind': {
      // On a crane in the walkway behind our goal, in front of the end stand.
      const st = stadiumLayout(p);
      const target = { x: Math.max(-L / 4, fx * 0.6), y: 0, z: fz * 0.6 };
      const position = { x: -(L / 2 + st.goalDepth + st.off + st.gap * 0.5), y: 0.13 * L * pull, z: fz * 0.45 };
      return { position, target, fov: 52 };
    }
    case 'follow': {
      // Low, slightly behind the play and to the near side.
      const target = { x: fx + 0.04 * L, y: 0, z: fz };
      return { position: inside(away(target, { x: -0.2 * L, y: 0.075 * L, z: 0.13 * L })), target, fov: 50 };
    }
    case 'top': {
      const fov = 45;
      const d = fitDistance(p, aspect, fov, Math.PI / 2, Math.max(2, L * 0.03));
      // A touch off vertical so "up" on screen is the far touchline, as in 2D.
      return { position: { x: 0, y: d, z: d * (Math.cos(Math.PI / 2) + 0.035) }, target: { x: 0, y: 0, z: 0 }, fov };
    }
  }
}

/** Running animation: how far the legs swing, and how fast the stride turns over. */
export function stride(speed: number): { swing: number; rate: number; lean: number } {
  const v = Math.max(0, speed);
  if (v < 0.25) return { swing: 0, rate: 0, lean: 0 };
  // About 1.4 m per stride at a jog, 2.3 m at a sprint; rate is in radians per second.
  const length = 0.9 + 0.17 * v;
  return { swing: Math.min(0.85, 0.13 * v), rate: (2 * Math.PI * v) / length, lean: Math.min(0.28, 0.032 * v) };
}

/** Turn smoothly from one heading to another (radians), the short way round. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return from + Math.max(-maxStep, Math.min(maxStep, d));
}
