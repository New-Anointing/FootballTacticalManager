/**
 * Pure body mechanics for the 3D footballers (no WebGL), so they can be tested.
 *
 * Angles follow the figure's rig: the figure faces local +Z, a positive X rotation of
 * a hip or shoulder swings the limb backwards (negative = forwards), a positive knee
 * angle bends the shin back, a positive elbow angle bends the forearm forwards, and a
 * positive torso lean tips the chest forwards. Limb index 0 is the right side (local
 * -X), index 1 the left. Lengths are in the figure's local units (metres at scale 1).
 */

export const THIGH = 0.45;
export const SHIN = 0.43;
/** Height of the ankle joint above the sole. */
export const ANKLE = 0.05;
/** Hip height standing tall. */
export const HIP_HEIGHT = THIGH + SHIN + ANKLE;
/** Where the ball sits relative to the hips when it's at a player's feet (local units). */
export const BALL_SPOT = { x: -0.1, z: 0.3 };

export type KickKind = 'pass' | 'cross' | 'shot' | 'clearance';
export type ActionKind = KickKind | 'receive' | 'dribble';

/** What a player is doing with the ball; phase runs 0..1 and contact is at 0.5. */
export interface PlayerAction {
  kind: ActionKind;
  phase: number;
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Ease between two values with zero speed at both ends. */
const ease = (a: number, b: number, t: number) => mix(a, b, (1 - Math.cos(Math.PI * clamp(t, 0, 1))) / 2);

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// ---------------------------------------------------------------------------------------
// Looking at the ball

/** How far the head turns on the shoulders, and the chest on the hips (radians). */
export const NECK_LIMIT = 1.25;
export const CHEST_LIMIT = 0.45;

/**
 * Split a turn towards the ball (relative to the body's heading) between the chest and
 * the neck. A player standing still turns the upper body a little; a running one keeps
 * the chest square and only turns the head. Beyond the limits the head stays turned
 * as far as it goes.
 */
export function lookAngles(relYaw: number, stillness: number): { chest: number; neck: number } {
  const r = wrapAngle(relYaw);
  const chest = clamp(r * 0.35, -CHEST_LIMIT, CHEST_LIMIT) * clamp(stillness, 0, 1);
  const neck = clamp(r - chest, -NECK_LIMIT, NECK_LIMIT);
  return { chest, neck };
}

/** Head tilt (positive = looking down) to see a point `dist` away at height `height`. */
export function headPitch(eyeHeight: number, dist: number, height: number): number {
  return clamp(-Math.atan2(height - eyeHeight, Math.max(0.5, dist)) * 0.75, -0.45, 0.55);
}

/**
 * Which way the body faces while moving. Jogging or walking a few metres, players keep
 * their chest to the ball and side-step or backpedal; at speed they face where they
 * run. `prev` (the current facing) breaks the tie when the ball is straight behind.
 */
export function facingFor(moveAngle: number, ballAngle: number, speed: number, prev: number): number {
  const k = clamp((3.8 - speed) / 2.2, 0, 1);
  let off = wrapAngle(ballAngle - moveAngle);
  if (Math.abs(off) > 2.6) {
    const side = wrapAngle(prev - moveAngle);
    if (Math.sign(side) !== Math.sign(off) && Math.abs(side) > 0.05) off = Math.sign(side) * Math.abs(off);
  }
  const limit = k * Math.PI;
  return moveAngle + clamp(off, -limit, limit);
}

// ---------------------------------------------------------------------------------------
// Running

export interface GaitBlend {
  still: number;
  walk: number;
  jog: number;
  sprint: number;
}

/** How much of each gait a speed (m/s) is: walk up to ~2, jog ~3-5.5, sprint from ~7. */
export function gaitBlend(speed: number): GaitBlend {
  const v = Math.max(0, speed);
  const moving = smoothstep(0.12, 0.7, v);
  const jogIn = smoothstep(1.6, 3, v);
  const sprintIn = smoothstep(5.2, 7.5, v);
  return { still: 1 - moving, walk: moving * (1 - jogIn), jog: moving * jogIn * (1 - sprintIn), sprint: moving * jogIn * sprintIn };
}

/**
 * Distance covered in one full gait cycle (two steps), in metres. Side-steps and
 * backpedalling take shorter, quicker steps.
 */
export function cycleLength(speed: number, fwd = 1, lat = 0): number {
  const base = 0.9 + 0.4 * Math.max(0, speed);
  return base * (1 - 0.3 * Math.max(0, -fwd) - 0.45 * Math.abs(lat));
}

/** Gait phase rate (radians per second) so the planted foot doesn't slide. */
export function cycleRate(speed: number, fwd = 1, lat = 0): number {
  return (2 * Math.PI * Math.max(0, speed)) / cycleLength(speed, fwd, lat);
}

/** Two-bone leg IK in the leg's plane: hip and knee angles that put the ankle at (z, -drop). */
export function legIK(z: number, drop: number, out: { hip: number; knee: number }) {
  const d = Math.min(THIGH + SHIN - 1e-4, Math.max(0.05, Math.hypot(z, drop)));
  const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
  const knee = Math.PI - Math.acos(clamp(cosK, -1, 1));
  // Angle of the hip→ankle line from straight down (forwards negative, as on the rig).
  const line = -Math.atan2(z, drop);
  const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
  // The knee points forwards: the thigh sits in front of the hip→ankle line.
  out.hip = line - Math.acos(clamp(cosA, -1, 1));
  out.knee = knee;
  return out;
}

/** Height of the sole below the hip for given joint angles (abd = sideways swing). */
export function legDrop(hip: number, knee: number, abd = 0): number {
  return (THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee)) * Math.cos(abd) + ANKLE;
}

/** Forward reach of the ankle in front of the hip for given joint angles. */
export function legReach(hip: number, knee: number): number {
  return -(THIGH * Math.sin(hip) + SHIN * Math.sin(hip + knee));
}

/** Every joint the figure animates. Reused between frames, never reallocated. */
export interface Pose {
  hip: [number, number];
  hipSide: [number, number];
  knee: [number, number];
  shoulder: [number, number];
  shoulderSide: [number, number];
  elbow: [number, number];
  /** Torso tilt forwards, twist (counter-rotation) and roll. */
  lean: number;
  twist: number;
  roll: number;
  /** Hip height and sideways sway of the hips (local units). */
  pelvis: number;
  sway: number;
  /** Breathing (0..1). */
  breath: number;
  /** How far ahead of the feet a dribbled ball is (metres, world). */
  ballAhead: number;
}

export function newPose(): Pose {
  return {
    hip: [0, 0], hipSide: [0, 0], knee: [0, 0], shoulder: [0, 0], shoulderSide: [0, 0], elbow: [0, 0],
    lean: 0, twist: 0, roll: 0, pelvis: HIP_HEIGHT, sway: 0, breath: 0, ballAhead: 0,
  };
}

export interface GaitInput {
  /** m/s over the ground. */
  speed: number;
  /** Gait phase (radians, ever increasing). */
  phase: number;
  /** Direction of travel relative to facing: fwd = cos, lat = sin of the angle. */
  fwd: number;
  lat: number;
  /** m/s², positive when speeding up. */
  accel: number;
  /** Figure scale (world metres per local unit). */
  scale: number;
  /** Seconds, for idle movement. */
  time: number;
  /** Dribbling: a small touch on the ball every other stride. */
  dribble: boolean;
}

const ik = { hip: 0, knee: 0 };
const fwdness: [number, number] = [0, 0];
const footZ: [number, number] = [0, 0];
const footX: [number, number] = [0, 0];
const footUp: [number, number] = [0, 0];
/** Furthest a planted foot sits from the hip (a touch short of a straight leg). */
const REACH = (THIGH + SHIN) * 0.985;
/** Longest a planted foot sweeps either side of the hip (local units). */
const MAX_HALF_STEP = 0.34;

/**
 * The running / walking / standing pose. Feet follow a proper step cycle: planted and
 * sweeping back at ground speed, then lifted (heel up behind at pace) and brought
 * through; joint angles come from leg IK so knees bend naturally.
 */
export function gaitPose(out: Pose, g: GaitInput): Pose {
  const b = gaitBlend(g.speed);
  const move = 1 - b.still;
  const w = b.walk;
  const j = b.jog;
  const s = b.sprint;
  const norm = move > 1e-6 ? 1 / move : 0;
  const wn = w * norm;
  const jn = j * norm;
  const sn = s * norm;
  const fwd = g.fwd;
  const lat = g.lat;
  const backwards = Math.max(0, -fwd);
  const L = cycleLength(g.speed, fwd, lat) / g.scale;
  // Time on the ground: most of the cycle walking, less and less running. Long strides
  // the legs can't reach are taken with more time in the air rather than sliding feet.
  const duty = Math.min(0.62 * wn + 0.38 * jn + 0.28 * sn, (2 * MAX_HALF_STEP) / Math.max(1e-6, L));
  const half = (duty * L) / 2;
  const lift = (0.09 * wn + 0.22 * jn + 0.34 * sn) * (1 - 0.45 * Math.abs(lat) - 0.4 * backwards);
  const u0 = (((g.phase / (2 * Math.PI)) % 1) + 1) % 1;
  const idle = b.still;
  // Standing: weight shifts slowly from foot to foot.
  out.sway = idle * 0.025 * Math.sin(g.time * 0.9);
  // Hips: lower when running (knees soft through the stance), bobbing once per step.
  const base = HIP_HEIGHT - (0.02 * wn + 0.07 * jn + 0.09 * sn) * move - idle * 0.025;
  const bobAmp = (0.02 * jn + 0.018 * sn) * move;
  out.pelvis = base - bobAmp * Math.cos(4 * Math.PI * (u0 - duty / 2));
  out.ballAhead = 0;
  for (let i = 0; i < 2; i++) {
    const u = (u0 + i * 0.5) % 1;
    let along: number; // displacement along the direction of travel
    let up: number;
    if (u < duty) {
      along = half * (1 - (2 * u) / duty);
      up = 0;
    } else {
      const k = (u - duty) / (1 - duty);
      along = half * (-1 + 2 * smoothstep(0, 1, k));
      // Up quickly behind (the heel recovering), then down early, ready to land.
      const bump = Math.sin(Math.PI * Math.pow(Math.min(1, k / 0.92), 0.7));
      up = lift * bump * bump;
      // Dribble: reach a little further for the touch on alternate strides.
      if (g.dribble && i === 0) {
        const touch = Math.floor(g.phase / (2 * Math.PI)) % 2 === 0 ? 1 : 0;
        along += touch * half * 0.3 * Math.sin(Math.PI * smoothstep(0.4, 1, k));
      }
    }
    along *= move;
    up *= move;
    fwdness[i] = half > 1e-6 ? along / half : 0;
    const side = i === 0 ? -1 : 1;
    // Feet a touch wider apart when shuffling sideways, so they don't cross.
    footZ[i] = along * fwd;
    footX[i] = along * lat + side * 0.11 * Math.abs(lat) * move - out.sway;
    footUp[i] = up;
    // A planted foot must be in reach: the hips drop to meet it (the walking bob).
    if (up === 0) out.pelvis = Math.min(out.pelvis, Math.sqrt(REACH * REACH - footZ[i] * footZ[i]) + ANKLE);
  }
  for (let i = 0; i < 2; i++) {
    const drop = Math.max(0.2, out.pelvis - footUp[i] - ANKLE);
    out.hipSide[i] = Math.atan2(footX[i], drop);
    legIK(footZ[i], Math.hypot(drop, footX[i]), ik);
    out.hip[i] = ik.hip;
    out.knee[i] = ik.knee;
  }
  out.breath = idle * (0.5 + 0.5 * Math.sin(g.time * 1.7));
  // Arms swing against the legs, elbows bent more the faster the run.
  const armAmp = (0.3 * wn + 0.6 * jn + 0.95 * sn) * move;
  const elbowBase = 0.25 * wn + 1.35 * jn + 1.55 * sn;
  for (let i = 0; i < 2; i++) {
    const opp = fwdness[1 - i];
    out.shoulder[i] = -armAmp * opp * fwd + 0.05 * idle;
    out.shoulderSide[i] = (i === 0 ? -1 : 1) * (0.1 + 0.08 * move + 0.05 * idle);
    out.elbow[i] = mix(0.22, elbowBase, move) + 0.18 * move * opp * fwd;
  }
  // Chest counter-rotates against the hips; leans into the run and into acceleration.
  out.twist = 0.14 * (jn + sn * 1.4 + wn * 0.5) * move * (fwdness[1] - fwdness[0]) * 0.5 * fwd;
  const leanRun = 0.03 * wn + 0.1 * jn + 0.19 * sn;
  out.lean = clamp(leanRun * move * (fwd >= 0 ? fwd : 0.3) + 0.025 * g.accel * move + 0.03 * idle, -0.12, 0.38);
  out.roll = -0.08 * lat * move;
  if (g.dribble) out.ballAhead = dribbleAhead(g.phase, g.speed);
  return out;
}

/**
 * Dribbling: after each touch the ball runs ahead and the player catches it up; it's
 * back at the foot as the next touch comes (every other stride).
 */
export function dribbleAhead(phase: number, speed: number): number {
  const cycles = phase / (2 * Math.PI);
  const tau = ((((cycles - 0.95) % 2) + 2) % 2) / 2;
  const amp = Math.min(1.1, 0.13 * Math.max(0, speed));
  return amp * Math.sin(Math.PI * tau);
}

// ---------------------------------------------------------------------------------------
// Striking the ball

/** Seconds of the kicking action before and after foot contact. */
export function kickWindow(kind: ActionKind): { pre: number; post: number } {
  switch (kind) {
    case 'pass':
      return { pre: 0.36, post: 0.34 };
    case 'cross':
      return { pre: 0.48, post: 0.44 };
    case 'shot':
      return { pre: 0.58, post: 0.55 };
    case 'clearance':
      return { pre: 0.56, post: 0.52 };
    case 'receive':
      return { pre: 0.4, post: 0.38 };
    case 'dribble':
      return { pre: 0, post: 0 };
  }
}

/** Phase (0..1, contact at 0.5) for `dt` seconds after contact, or null outside the action. */
export function actionPhase(kind: ActionKind, dt: number): number | null {
  const { pre, post } = kickWindow(kind);
  if (dt < -pre || dt > post) return null;
  return dt < 0 ? 0.5 + dt / (2 * pre) : 0.5 + dt / (2 * post);
}

/** How strongly a kick swings: 0.35 for a side-foot pass up to 1 for a shot. */
export function kickPower(kind: ActionKind): number {
  return kind === 'pass' ? 0.35 : kind === 'cross' ? 0.68 : kind === 'shot' ? 1 : kind === 'clearance' ? 0.95 : 0;
}

/** How much an action takes over the body at phase p (0 at either end). */
export function actionWeight(p: number): number {
  return smoothstep(0, 0.16, p) * (1 - smoothstep(0.84, 1, p));
}

/** Half-width (in phase) of the strike, centred on contact. */
const STRIKE = 0.13;
/** Hip angle of the kicking leg at contact (the foot a little in front of the body). */
export const CONTACT_HIP = -0.45;

/** Kicking leg's hip and knee angles at phase p. */
export function kickLeg(kind: KickKind, p: number): { hip: number; knee: number } {
  const k = kickPower(kind);
  const back = CONTACT_HIP + 0.75 + 0.75 * k; // top of the back-swing
  const follow = CONTACT_HIP - (0.3 + 1.0 * k); // a short follow-through for a pass, high for a shot
  const kneeMax = 0.9 + 1.0 * k;
  // The leg speeds up into contact and slows after it; the follow-through phase is
  // sized so the swing speed is the same either side of contact (fastest at contact).
  const pb = 0.5 - STRIKE;
  const pf = 0.5 + (STRIKE * (CONTACT_HIP - follow)) / (back - CONTACT_HIP);
  let hip: number;
  let knee: number;
  if (p < pb) {
    // Plant and draw the leg back, knee folding.
    const t = clamp((p - 0.04) / (pb - 0.04), 0, 1);
    hip = ease(0, back, t);
    knee = ease(0.15, kneeMax, t);
  } else if (p <= 0.5) {
    const t = (p - pb) / (0.5 - pb);
    hip = back + (CONTACT_HIP - back) * (1 - Math.cos((Math.PI / 2) * t));
    knee = ease(kneeMax, 0.25, t);
  } else if (p <= pf) {
    const t = (p - 0.5) / (pf - 0.5);
    hip = CONTACT_HIP + (follow - CONTACT_HIP) * Math.sin((Math.PI / 2) * t);
    knee = ease(0.25, 0.08, t);
  } else {
    // Follow-through, then back down.
    const t = clamp((p - pf) / (1 - pf), 0, 1);
    hip = ease(follow, 0, t);
    knee = ease(0.08, 0.15, t) + 0.5 * Math.sin(Math.PI * t) * k;
  }
  return { hip, knee };
}

/**
 * Lay a ball action over the running pose. Kicks use the right foot (leg 0); the left
 * is planted beside the ball with a soft knee, the other arm goes out for balance and
 * the chest winds up and unwinds through the strike.
 */
export function applyAction(out: Pose, a: PlayerAction | undefined): number {
  if (!a || a.kind === 'dribble') return 0;
  const p = clamp(a.phase, 0, 1);
  const w = actionWeight(p);
  if (w <= 0) return 0;
  let kHip: number;
  let kKnee: number;
  let lean: number;
  let twist: number;
  let armOut: number;
  let plantKnee: number;
  if (a.kind === 'receive') {
    // Foot up to meet the ball, then give with it to cushion the touch.
    const reach = smoothstep(0.1, 0.46, p);
    const give = smoothstep(0.5, 0.75, p);
    kHip = -0.55 * reach + 0.3 * give;
    kKnee = 0.25 + 0.35 * reach - 0.1 * give;
    lean = 0.1;
    twist = 0.12 * reach;
    armOut = 0.35;
    plantKnee = 0.3;
  } else {
    const kl = kickLeg(a.kind, p);
    const k = kickPower(a.kind);
    kHip = kl.hip;
    kKnee = kl.knee;
    // Over the ball for a pass or a low shot; leaning back to loft a cross or clearance.
    const lofted = a.kind === 'cross' || a.kind === 'clearance';
    lean = (lofted ? -0.16 : 0.14) * smoothstep(0.25, 0.5, p) + 0.05;
    const swing = clamp((p - 0.34) / 0.32, 0, 1);
    twist = -0.32 * k * Math.cos(Math.PI * swing) * smoothstep(0.08, 0.34, p);
    armOut = 0.35 + 0.75 * k;
    plantKnee = 0.25 + 0.2 * k;
  }
  out.hip[0] = mix(out.hip[0], kHip, w);
  out.knee[0] = mix(out.knee[0], kKnee, w);
  out.hipSide[0] = mix(out.hipSide[0], -0.03, w);
  out.hip[1] = mix(out.hip[1], -0.12 - plantKnee * 0.45, w);
  out.knee[1] = mix(out.knee[1], plantKnee, w);
  out.hipSide[1] = mix(out.hipSide[1], 0.06, w);
  out.lean = mix(out.lean, lean, w);
  out.twist = mix(out.twist, twist, w);
  out.roll = mix(out.roll, -0.06, w);
  // Left arm out and forward for balance, right arm swings back against the kick.
  out.shoulder[1] = mix(out.shoulder[1], -0.35, w);
  out.shoulderSide[1] = mix(out.shoulderSide[1], armOut, w);
  out.elbow[1] = mix(out.elbow[1], 0.45, w);
  out.shoulder[0] = mix(out.shoulder[0], 0.25 + 0.3 * Math.max(0, -kHip), w);
  out.shoulderSide[0] = mix(out.shoulderSide[0], -0.3 * armOut, w);
  out.elbow[0] = mix(out.elbow[0], 0.5, w);
  // Stand on the planted foot.
  const plant = legDrop(out.hip[1], out.knee[1], out.hipSide[1]);
  out.pelvis = mix(out.pelvis, plant, w);
  out.sway = mix(out.sway, 0.03, w);
  return w;
}
