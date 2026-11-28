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

export type CameraPreset = 'broadcast' | 'tactical' | 'behind' | 'top' | 'follow' | 'player' | 'free';

export const CAMERA_PRESETS: { id: CameraPreset; label: string; title: string }[] = [
  { id: 'broadcast', label: 'TV', title: 'Broadcast camera from the stand, following the ball' },
  { id: 'tactical', label: 'Tactical', title: 'High camera showing the whole pitch' },
  { id: 'behind', label: 'Behind goal', title: 'From behind our goal, looking up the pitch' },
  { id: 'follow', label: 'Follow', title: 'Low camera following the ball' },
  { id: 'top', label: 'Top', title: 'Straight down, like the tactics board' },
  { id: 'player', label: 'Player', title: "See the move through a player's eyes (pick who below, or tap a player)" },
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
export function cameraView(preset: Exclude<CameraPreset, 'free' | 'player'>, p: PitchSpec, focus: V3, aspect = 16 / 9): CameraView {
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

// ---------------------------------------------------------------------------------------
// Player view: the move through one player's eyes (or from just behind them)

const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** First person ("eyes") or third person, just behind and above the player ("shoulder"). */
export type PovMode = 'eyes' | 'shoulder';

export const POV_FOV: Record<PovMode, number> = { eyes: 72, shoulder: 64 };

/**
 * Where a player's eyes are, from the centre of their head (world) and the way the head
 * faces: just in front of the face, so the camera never sits inside their own head.
 */
export function eyePoint(head: V3, headYaw: number, scale: number): V3 {
  const ahead = 0.17 * scale;
  return { x: head.x + Math.sin(headYaw) * ahead, y: head.y + 0.015 * scale, z: head.z + Math.cos(headYaw) * ahead };
}

/** Which way the camera looks: yaw (0 = +Z, as a figure's heading) and pitch (+ = up). */
export interface Gaze {
  yaw: number;
  pitch: number;
}

/**
 * Where a player looks: a blend of the way their head faces and the ball, so a pass or a
 * run reads naturally. On the ball they look ahead more (the ball sits low in the
 * picture); off it they follow the ball. If the ball is anywhere in front of them it is
 * kept in the picture, and the view never stares at the sky or the grass.
 */
export function gazeFor(eye: V3, headYaw: number, ball: V3 | undefined, onBall: boolean, fov: number, aspect: number): Gaze {
  const horizon = -0.06;
  if (!ball) return { yaw: headYaw, pitch: horizon };
  const dx = ball.x - eye.x;
  const dz = ball.z - eye.z;
  const d = Math.hypot(dx, dz);
  const ballYaw = Math.atan2(dx, dz);
  const ballPitch = Math.atan2(ball.y - eye.y, Math.max(0.3, d));
  const halfV = ((fov / 2) * Math.PI) / 180;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const off = wrap(ballYaw - headYaw);
  // 1 while the ball is in front of them, easing to 0 as it goes behind their back:
  // then they glance towards it rather than the view swinging round.
  const t = clampN((Math.abs(off) - 1.5) / 0.7, 0, 1);
  const front = 1 - t * t * (3 - 2 * t);
  let yaw = headYaw;
  if (d > 0.6) {
    yaw = headYaw + off * (onBall ? 0.3 : 0.65) * (0.45 + 0.55 * front);
    // Keep the ball in shot when it's in front of them.
    const lim = Math.min(halfH, halfV * 1.6) * 0.8;
    const kept = ballYaw + clampN(wrap(yaw - ballYaw), -lim, lim);
    yaw += wrap(kept - yaw) * front;
  }
  let pitch = horizon + (ballPitch - horizon) * (onBall ? 0.2 : 0.6) * (0.4 + 0.6 * front);
  // A ball a few metres away is kept in the picture; one at their own feet may drop out
  // of the bottom (they look up to see the play, as players are coached to).
  const far = clampN((d - 1.5) / 2.5, 0, 1);
  pitch += (clampN(pitch, ballPitch - halfV * 0.8, ballPitch + halfV * 0.8) - pitch) * front * far;
  return { yaw: wrap(yaw), pitch: clampN(pitch, -0.45, 0.45) };
}

/** The player-view camera's smoothed state. */
export interface PovState {
  eye: V3;
  yaw: number;
  pitch: number;
}

/** How fast (1/s) the player-view camera follows the eye across the grass, up and down, and turning. */
export interface PovRates {
  move: number;
  rise: number;
  turn: number;
}

export const POV_RATES: PovRates = { move: 40, rise: 3, turn: 5 };

/**
 * One frame of smoothing: the camera keeps up with the player across the pitch, but the
 * up-and-down bob of their stride is damped away and turns are eased (the short way round).
 */
export function smoothPov(prev: PovState | undefined, next: PovState, dt: number, rates: PovRates = POV_RATES): PovState {
  if (!prev) return { eye: { ...next.eye }, yaw: next.yaw, pitch: next.pitch };
  const k = (r: number) => 1 - Math.exp(-Math.max(0, dt) * r);
  const km = k(rates.move);
  const kt = k(rates.turn);
  return {
    eye: {
      x: prev.eye.x + (next.eye.x - prev.eye.x) * km,
      y: prev.eye.y + (next.eye.y - prev.eye.y) * k(rates.rise),
      z: prev.eye.z + (next.eye.z - prev.eye.z) * km,
    },
    yaw: wrap(prev.yaw + wrap(next.yaw - prev.yaw) * kt),
    pitch: prev.pitch + (next.pitch - prev.pitch) * kt,
  };
}

/** A unit vector for a yaw / pitch. */
export function gazeDir(g: Gaze): V3 {
  const c = Math.cos(g.pitch);
  return { x: Math.sin(g.yaw) * c, y: Math.sin(g.pitch), z: Math.cos(g.yaw) * c };
}

/**
 * The camera for a player view: at the eyes looking along the gaze, or over the right
 * shoulder (behind, above and a little to the side, looking past the head the same way).
 */
export function povCamera(s: PovState, mode: PovMode, scale: number): CameraView {
  const f = gazeDir(s);
  if (mode === 'eyes') {
    const reach = 25;
    return { position: { ...s.eye }, target: { x: s.eye.x + f.x * reach, y: s.eye.y + f.y * reach, z: s.eye.z + f.z * reach }, fov: POV_FOV.eyes };
  }
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const back = 2.6 * scale;
  const side = 0.55 * scale;
  const position = { x: s.eye.x - fx * back - fz * side, y: Math.max(0.8, s.eye.y + 0.5 * scale), z: s.eye.z - fz * back + fx * side };
  // Look a little lower than the eyes do, so the player sits in the lower part of the frame.
  const look = gazeDir({ yaw: s.yaw, pitch: s.pitch * 0.7 - 0.06 });
  const reach = 18;
  return { position, target: { x: s.eye.x + look.x * reach, y: s.eye.y + look.y * reach, z: s.eye.z + look.z * reach }, fov: POV_FOV.shoulder };
}
