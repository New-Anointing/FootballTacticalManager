import { attackingGoal, pitchFor } from '../model/pitch';
import { activePlayers, boardStates, playerById, type BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { lerp, pathLength, pointAlong } from './geometry';
import { AT_REST, carryFor, runFraction, type Carry, type StepCarry } from './motion';

export interface Frame {
  positions: Record<string, Vec>;
  ball: Vec;
  /** Height of the ball in metres (for lofted passes / crosses); drawn as a shadow offset. */
  ballHeight: number;
  /** -1 while showing the setup; otherwise the index of the step being played. */
  stepIndex: number;
  /** Progress through the current step (0..1). */
  stepT: number;
}

/** Path a player follows during a step, including their starting point. */
export function playerPath(step: Step, id: string, start: Vec): Vec[] {
  const moves = step.moves[id];
  return moves && moves.length ? [start, ...moves] : [start];
}

/**
 * Where a player is at fraction t of a step. `carry` is the speed they bring into the
 * step and keep at the end of it (see motion.ts); without it they start and finish at rest.
 */
export function playerAt(step: Step, id: string, start: Vec, t: number, carry: Carry = AT_REST): Vec {
  const path = playerPath(step, id, start);
  return pointAlong(path, runFraction(pathLength(path), step.duration, t, carry));
}

/** Typical ball speeds (m/s). Passes travel at these speeds unless the step is too short. */
export const BALL_SPEED = { pass: 14, cross: 17, shot: 26, clearance: 22 } as const;

export interface BallFlight {
  origin: Vec;
  dest: Vec;
  /** Fraction of the step when the ball leaves the passer. */
  release: number;
  /** Fraction of the step when the ball arrives (at the receiver's feet / target). */
  arrive: number;
  lofted: boolean;
  /** Receiving player, who carries the ball after it arrives. */
  receiver?: string;
}

/**
 * Where and when a pass, cross, shot or clearance travels. A pass to a player is
 * played to where the receiver will be when the ball arrives; the ball moves at a
 * realistic speed and the receiver carries it for the rest of the step.
 */
export function ballFlight(
  tactic: Tactic, step: Step, before: BoardState, after: BoardState, carry: StepCarry = {},
): BallFlight | null {
  const a = step.ball;
  if (!a || a.type === 'dribble' || !before.positions[a.from]) return null;
  const D = Math.max(0.1, step.duration);
  const release = Math.min(Math.max(a.releaseAt, 0), 0.95);
  const origin = playerAt(step, a.from, before.positions[a.from], release, carry[a.from]);
  const speed = BALL_SPEED[a.type];
  const lofted = a.type === 'cross' || a.type === 'clearance';
  const arriveFor = (dest: Vec) => Math.min(1, release + Math.hypot(dest.x - origin.x, dest.y - origin.y) / (speed * D));
  if ((a.type === 'pass' || a.type === 'cross') && a.to && before.positions[a.to]) {
    const recvAt = (tt: number) => playerAt(step, a.to!, before.positions[a.to!], tt, carry[a.to!]);
    let arrive = 1;
    for (let k = 0; k < 6; k++) arrive = arriveFor(recvAt(arrive));
    return { origin, dest: recvAt(arrive), release, arrive: Math.max(arrive, release + 0.02), lofted, receiver: a.to };
  }
  let dest: Vec;
  if (a.type === 'shot') {
    const team = playerById(tactic, a.from)?.team ?? 'home';
    dest = a.target ?? attackingGoal(team, pitchFor(tactic.format));
  } else {
    dest = a.target ?? after.ball;
  }
  return { origin, dest, release, arrive: Math.max(arriveFor(dest), release + 0.02), lofted };
}

/** Ball position and height at fraction t of a step. */
export function ballAt(
  tactic: Tactic,
  step: Step,
  before: BoardState,
  after: BoardState,
  t: number,
  carry: StepCarry = {},
): { pos: Vec; height: number } {
  const a = step.ball;
  const carrierAt = (id: string, tt: number) => playerAt(step, id, before.positions[id], tt, carry[id]);

  if (!a || !before.positions[a.from]) {
    if (before.ballOwner && before.positions[before.ballOwner]) {
      return { pos: carrierAt(before.ballOwner, t), height: 0 };
    }
    return { pos: lerp(before.ball, after.ball, t), height: 0 };
  }

  if (a.type === 'dribble') return { pos: carrierAt(a.from, t), height: 0 };

  const f = ballFlight(tactic, step, before, after, carry)!;
  if (t <= f.release) return { pos: carrierAt(a.from, t), height: 0 };
  if (t >= f.arrive) {
    if (f.receiver) return { pos: carrierAt(f.receiver, t), height: 0 };
    return { pos: f.dest, height: 0 };
  }
  const u = (t - f.release) / (f.arrive - f.release);
  const peak = f.lofted ? Math.min(8, Math.hypot(f.dest.x - f.origin.x, f.dest.y - f.origin.y) * 0.18) : 0;
  return { pos: lerp(f.origin, f.dest, u), height: peak * 4 * u * (1 - u) };
}

/** Frame for a specific step index and progress through it. */
export function frameAtStep(tactic: Tactic, states: BoardState[], stepIndex: number, t: number): Frame {
  if (stepIndex < 0 || stepIndex >= tactic.steps.length) {
    const s = states[Math.max(0, Math.min(states.length - 1, stepIndex + 1))];
    return { positions: s.positions, ball: s.ball, ballHeight: 0, stepIndex, stepT: 1 };
  }
  const step = tactic.steps[stepIndex];
  const before = states[stepIndex];
  const after = states[stepIndex + 1];
  const carry = carryFor(tactic, states, stepIndex);
  const positions: Record<string, Vec> = {};
  for (const pl of activePlayers(tactic)) {
    const start = before.positions[pl.id];
    if (start) positions[pl.id] = playerAt(step, pl.id, start, t, carry[pl.id]);
  }
  const ball = ballAt(tactic, step, before, after, t, carry);
  return { positions, ball: ball.pos, ballHeight: ball.height, stepIndex, stepT: t };
}

/** Frame at an absolute playback time (seconds from the start of step 1). */
export function frameAtTime(tactic: Tactic, time: number, states = boardStates(tactic)): Frame {
  if (tactic.steps.length === 0 || time <= 0) {
    return { ...frameAtStep(tactic, states, -1, 0), stepIndex: tactic.steps.length ? 0 : -1, stepT: 0 };
  }
  let acc = 0;
  for (let i = 0; i < tactic.steps.length; i++) {
    const d = Math.max(0.1, tactic.steps[i].duration);
    if (time <= acc + d) return frameAtStep(tactic, states, i, (time - acc) / d);
    acc += d;
  }
  const last = tactic.steps.length - 1;
  return frameAtStep(tactic, states, last, 1);
}

/** Start time (seconds) of a step during playback. */
export function stepStartTime(tactic: Tactic, index: number): number {
  return tactic.steps.slice(0, index).reduce((s, st) => s + Math.max(0.1, st.duration), 0);
}
