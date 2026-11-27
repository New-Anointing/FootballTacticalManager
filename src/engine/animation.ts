import { attackingGoal, pitchFor } from '../model/pitch';
import { activePlayers, boardStates, playerById, type BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { easeInOut, lerp, pointAlong } from './geometry';

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

/** Where a player is at fraction t of a step. */
export function playerAt(step: Step, id: string, start: Vec, t: number): Vec {
  return pointAlong(playerPath(step, id, start), easeInOut(t));
}

/** Ball position and height at fraction t of a step. */
export function ballAt(
  tactic: Tactic,
  step: Step,
  before: BoardState,
  after: BoardState,
  t: number,
): { pos: Vec; height: number } {
  const a = step.ball;
  const carrierAt = (id: string, tt: number) => playerAt(step, id, before.positions[id], tt);

  if (!a || !before.positions[a.from]) {
    if (before.ballOwner && before.positions[before.ballOwner]) {
      return { pos: carrierAt(before.ballOwner, t), height: 0 };
    }
    return { pos: lerp(before.ball, after.ball, t), height: 0 };
  }

  if (a.type === 'dribble') return { pos: carrierAt(a.from, t), height: 0 };

  const release = Math.min(Math.max(a.releaseAt, 0), 0.95);
  if (t <= release) return { pos: carrierAt(a.from, t), height: 0 };

  const origin = carrierAt(a.from, release);
  let dest: Vec;
  if ((a.type === 'pass' || a.type === 'cross') && a.to && before.positions[a.to]) {
    dest = after.positions[a.to];
  } else if (a.type === 'shot') {
    const team = playerById(tactic, a.from)?.team ?? 'home';
    dest = a.target ?? attackingGoal(team, pitchFor(tactic.format));
  } else {
    dest = a.target ?? after.ball;
  }
  const u = (t - release) / (1 - release);
  const lofted = a.type === 'cross' || a.type === 'clearance';
  const peak = lofted ? Math.min(8, Math.hypot(dest.x - origin.x, dest.y - origin.y) * 0.18) : 0;
  return { pos: lerp(origin, dest, u), height: peak * 4 * u * (1 - u) };
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
  const positions: Record<string, Vec> = {};
  for (const pl of activePlayers(tactic)) {
    const start = before.positions[pl.id];
    if (start) positions[pl.id] = playerAt(step, pl.id, start, t);
  }
  const ball = ballAt(tactic, step, before, after, t);
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
