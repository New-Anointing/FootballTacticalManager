import type { BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { clamp, cutPath, dist, pathLength } from './geometry';

/**
 * How players move along their runs over time.
 *
 * Real players don't stop dead at the end of every step and surge to twice their
 * average speed in the middle of the next. They accelerate hard from a standstill,
 * hold their speed while a run carries on (into the next step too), arrive at a spot
 * at pace and pull up, or wait and time a run so they're already moving when it
 * matters. Each run gets a speed profile built from the speed the player brings in
 * from the previous step and the speed they take into the next one.
 *
 * Figures are for a fit footballer: about 10 m in 1.8 s and 20 m in 3 s from a
 * standing start, top speed around 9.5 m/s, braking from a sprint in a second or so.
 */

/** Average acceleration from a standstill to running speed (m/s²). */
export const ACCEL = 6;
/** Braking (m/s²). */
export const BRAKE = 6;
/** Fastest a footballer runs (m/s). */
export const TOP_SPEED = 9.5;

/** Hardest sprint the engines ask of a player they move (m/s). */
export const SPRINT = 8;

/**
 * Speeds (m/s) a player carries into and out of one step. FREE means "whatever the run
 * needs": already moving at the run's pace when the clip starts, or still running at it
 * when the clip ends.
 */
export interface Carry {
  v0: number;
  v1: number;
}
export type StepCarry = Record<string, Carry>;
export const FREE = -1;
export const AT_REST: Carry = { v0: 0, v1: 0 };

/**
 * A speed profile: from v0, change to the cruising speed vc (speeding up at ACCEL or
 * slowing at BRAKE), hold it, then change to v1. vc can be 0: the player gets there,
 * stops and waits, or waits and then sets off.
 */
interface Profile {
  D: number;
  v0: number;
  v1: number;
  vc: number;
  ta: number;
  tb: number;
}

const rampTime = (from: number, to: number) => (to >= from ? (to - from) / ACCEL : (from - to) / BRAKE);

function shape(D: number, v0In: number, v1In: number, vc: number): Profile {
  const v0 = v0In < 0 ? vc : v0In;
  const v1 = v1In < 0 ? vc : v1In;
  let ta = rampTime(v0, vc);
  let tb = rampTime(vc, v1);
  // Not enough time for both ramps at these rates: squeeze them into the step.
  if (ta + tb > D) {
    const k = D / (ta + tb);
    ta *= k;
    tb *= k;
  }
  return { D, v0, v1, vc, ta, tb };
}

function covered(pr: Profile): number {
  const { D, v0, v1, vc, ta, tb } = pr;
  return ((v0 + vc) / 2) * ta + vc * (D - ta - tb) + ((vc + v1) / 2) * tb;
}

function solve(L: number, D: number, carry: Carry): Profile {
  let v0 = carry.v0 < 0 ? FREE : carry.v0;
  let v1 = carry.v1 < 0 ? FREE : carry.v1;
  // Coming in too fast to stop within the run (or leaving too fast to reach): ease off.
  const atRest = covered(shape(D, v0, v1, 0));
  if (atRest > L) {
    const k = Math.sqrt(L / atRest);
    if (v0 > 0) v0 *= k;
    if (v1 > 0) v1 *= k;
  }
  // Distance covered grows with the cruising speed: find the one that covers the run.
  let lo = 0;
  let hi = Math.max(TOP_SPEED * 2, (L / D) * 3, v0, v1);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (covered(shape(D, v0, v1, mid)) < L) lo = mid;
    else hi = mid;
  }
  return shape(D, v0, v1, (lo + hi) / 2);
}

function distanceAt(pr: Profile, time: number): number {
  const { D, v0, v1, vc, ta, tb } = pr;
  const t = clamp(time, 0, D);
  const upTo = (x: number) => v0 * x + (ta > 0 ? ((vc - v0) * x * x) / (2 * ta) : 0);
  if (t <= ta) return upTo(t);
  const cruiseEnd = D - tb;
  if (t <= cruiseEnd) return upTo(ta) + vc * (t - ta);
  const x = t - cruiseEnd;
  return upTo(ta) + vc * (cruiseEnd - ta) + vc * x + (tb > 0 ? ((v1 - vc) * x * x) / (2 * tb) : 0);
}

/** Fraction of a run's length covered after fraction `u` of the step. */
export function runFraction(length: number, duration: number, u: number, carry: Carry = AT_REST): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (length < 1e-6) return u;
  const D = Math.max(0.1, duration);
  return clamp(distanceAt(solve(length, D, carry), u * D) / length, 0, 1);
}

/** Top speed (m/s) a run reaches with this profile. */
export function runPeakSpeed(length: number, duration: number, carry: Carry = AT_REST): number {
  if (length < 1e-6) return 0;
  const pr = solve(length, Math.max(0.1, duration), carry);
  return Math.max(pr.v0, pr.v1, pr.vc);
}

/** The furthest a player can run in `duration` without going above `top` m/s. */
export function reachWithin(duration: number, carry: Carry, top: number, upTo: number): number {
  if (runPeakSpeed(upTo, duration, carry) <= top) return upTo;
  let lo = 0;
  let hi = upTo;
  for (let k = 0; k < 30; k++) {
    const mid = (lo + hi) / 2;
    if (runPeakSpeed(mid, duration, carry) <= top) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * A run (starting point first) shortened, if need be, to what a player can cover in
 * `duration` without going above `top` m/s. Returns the run's points after the start.
 */
export function capRun(path: Vec[], duration: number, carry: Carry = AT_REST, top = SPRINT): Vec[] {
  const L = pathLength(path);
  if (L < 1e-6 || runPeakSpeed(L, duration, carry) <= top + 0.05) return path.slice(1);
  return cutPath(path, reachWithin(duration, carry, top, L) / L).slice(1);
}

function direction(a: Vec, b: Vec): Vec | undefined {
  const d = dist(a, b);
  return d > 0.05 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : undefined;
}

/**
 * Speed a player takes from one run into the next. Running on in the same direction
 * they keep it; through a turn they keep less, and none for a sharp change of
 * direction. A short run after a fast one means arriving at pace and pulling up; a
 * short run before a fast one means setting off early so the run is already going.
 */
export function boundarySpeed(prev: Vec[], prevDuration: number, next: Vec[], nextDuration: number): number {
  const l1 = pathLength(prev);
  const l2 = pathLength(next);
  if (l1 < 0.3 || l2 < 0.3) return 0;
  let out: Vec | undefined;
  for (let k = prev.length - 1; k > 0 && !out; k--) out = direction(prev[k - 1], prev[k]);
  let into: Vec | undefined;
  for (let k = 1; k < next.length && !into; k++) into = direction(next[k - 1], next[k]);
  if (!out || !into) return 0;
  const cos = out.x * into.x + out.y * into.y;
  const keep = clamp((cos + 0.3) / 1.3, 0, 1);
  const u1 = l1 / Math.max(0.1, prevDuration);
  const u2 = l2 / Math.max(0.1, nextDuration);
  // What each run allows: its own pace, or (if it's the slower one) as much speed as
  // can be built up within it, or braked off within it.
  const fromPrev = Math.max(u1, Math.min(u2, Math.sqrt(2 * ACCEL * l1)));
  const intoNext = Math.max(u2, Math.min(u1, Math.sqrt(2 * BRAKE * l2)));
  return keep * Math.min(fromPrev, intoNext, TOP_SPEED);
}

function pathIn(step: Step | undefined, id: string, start: Vec | undefined): Vec[] | undefined {
  if (!step || !start) return undefined;
  const m = step.moves[id];
  return m && m.length ? [start, ...m] : [start];
}

/**
 * The speeds every player carries into and out of step `i`, from their runs in the
 * steps either side. `steps` defaults to the tactic's own; `states[k]` is the board
 * before step k.
 *
 * A scenario is a moment from a match, so in open play players are already moving
 * when it starts (they arrive at the speed of their first run); at a set piece they
 * start from a standstill. The clip ends with the play still going, so nobody brakes
 * to a halt in the final step just because the animation is about to stop.
 */
export function carryFor(t: Tactic, states: BoardState[], i: number, steps: Step[] = t.steps): StepCarry {
  const out: StepCarry = {};
  const step = steps[i];
  if (!step) return out;
  const D = Math.max(0.1, step.duration);
  for (const pl of t.players) {
    const here = pathIn(step, pl.id, states[i]?.positions[pl.id]);
    if (!here) continue;
    const own = pathLength(here) >= 0.3 ? pathLength(here) / D : 0;
    const prev = i > 0 ? pathIn(steps[i - 1], pl.id, states[i - 1]?.positions[pl.id]) : undefined;
    const next = i + 1 < steps.length ? pathIn(steps[i + 1], pl.id, states[i + 1]?.positions[pl.id]) : undefined;
    out[pl.id] = {
      v0: prev ? boundarySpeed(prev, steps[i - 1].duration, here, step.duration) : t.phase === 'set-piece' || !own ? 0 : FREE,
      v1: next ? boundarySpeed(here, step.duration, next, steps[i + 1].duration) : own ? FREE : 0,
    };
  }
  return out;
}
