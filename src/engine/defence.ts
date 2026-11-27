import { attackingGoal, pitchFor, progress } from '../model/pitch';
import { boardStates, playerById, type BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { playerAt } from './animation';
import { clamp, dist, lerp } from './geometry';
import { opponentsOf, scaleFor } from './options';

/**
 * Realistic opposition behaviour.
 *
 * When the home team (the user's team) has the ball, opponents react the way a
 * well-coached side would:
 *  - one presser closes down wherever the ball is going: from the inside, to show
 *    the carrier down the line, and only once the pass is played (so a quick pass
 *    still beats the press);
 *  - everyone else holds a zonal shape built from their formation, sliding towards
 *    the ball, stepping up when it goes back and dropping when it goes forward;
 *  - runners into dangerous areas are tracked by the defender in that zone;
 *  - the goalkeeper adjusts to the ball.
 * Every run is limited to what a footballer can cover in the time available.
 */

export const PRESS_SPEED = 6.8; // m/s, closing down
export const TRACK_SPEED = 6.2; // m/s, tracking a runner
export const SHIFT_SPEED = 4.5; // m/s, block shifting

/** Gap a presser leaves to a receiver so they arrive as the ball does, without fouling. */
export function pressGap(format: number): number {
  return 1.8 * Math.max(1, scaleFor(pitchFor(format))) + 0.5;
}

function clampToPitch(v: Vec, length: number, width: number): Vec {
  return { x: clamp(v.x, 0.5, length - 0.5), y: clamp(v.y, 0.5, width - 0.5) };
}

function limit(from: Vec, to: Vec, max: number): Vec {
  const d = dist(from, to);
  return d > max && d > 0 ? lerp(from, to, max / d) : to;
}

/** Opponent runs reacting to one home-possession step. Returns {} if the home team doesn't have the ball. */
export function reactStep(t: Tactic, before: BoardState, step: Step): Record<string, Vec[]> {
  if (!t.showOpponents) return {};
  const a = step.ball;
  const carrierId = a?.from ?? before.ballOwner;
  const carrier = playerById(t, carrierId);
  if (!carrier || carrier.team !== 'home' || !before.positions[carrier.id]) return {};

  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const D = Math.max(0.5, step.duration);
  const goal = attackingGoal('home', p); // the goal the opponents defend
  const goalSide = (pt: Vec, gap: number): Vec => lerp(pt, goal, Math.min(0.6, gap / Math.max(1, dist(pt, goal))));
  /**
   * Pressing position: goal-side but from the inside, so the ball carrier is shown
   * down the line towards the touchline (the classic "force them wide" press).
   */
  const pressPoint = (pt: Vec, gap: number): Vec => {
    const aim = { x: pt.x + (goal.x - pt.x) * 0.35, y: p.width / 2 };
    const d = Math.max(1, dist(pt, aim));
    return lerp(pt, aim, Math.min(0.6, gap / d));
  };

  // Where the home players finish this step.
  const homeEnd: Record<string, Vec> = { ...before.positions };
  for (const [id, path] of Object.entries(step.moves)) {
    if (playerById(t, id)?.team === 'home' && path.length) homeEnd[id] = path[path.length - 1];
  }
  const passing = !!a && a.type !== 'dribble';
  const release = passing ? clamp(a!.releaseAt, 0, 0.95) : 1;
  const carrierAtRelease = playerAt(step, carrier.id, before.positions[carrier.id], release);

  let dest: Vec;
  let receiverId: string | undefined;
  if (a && (a.type === 'pass' || a.type === 'cross') && a.to && playerById(t, a.to)?.team === 'home') {
    receiverId = a.to;
    dest = homeEnd[a.to];
  } else if (a && a.type !== 'dribble' && a.type !== 'shot' && a.target) {
    dest = a.target;
  } else if (a?.type === 'shot') {
    dest = carrierAtRelease;
  } else {
    dest = homeEnd[carrier.id];
  }

  const opp = opponentsOf(t, 'home').filter((o) => before.positions[o.id]);
  const outfield = opp.filter((o) => o.line !== 'GK');
  const moves: Record<string, Vec[]> = {};
  const assigned = new Set<string>();
  const set = (id: string, target: Vec) => {
    const from = before.positions[id];
    const tgt = clampToPitch(target, p.length, p.width);
    if (dist(from, tgt) > 0.4) moves[id] = [tgt];
    assigned.add(id);
  };
  const byDistance = (pt: Vec) =>
    outfield.filter((o) => !assigned.has(o.id)).sort((x, y) => dist(before.positions[x.id], pt) - dist(before.positions[y.id], pt));

  // 1) Close down the receiver: only possible once the ball is played (+ a little anticipation).
  if (passing && a!.type !== 'shot' && (receiverId || a!.target)) {
    const presser = byDistance(dest)[0];
    if (presser) {
      const reach = Math.min(PRESS_SPEED * D, PRESS_SPEED * D * (1 - release) + 1);
      set(presser.id, limit(before.positions[presser.id], pressPoint(dest, pressGap(t.format)), reach));
    }
  }

  // 1b) A dribble (or a player holding the ball) is closed down directly.
  if (!passing) {
    const presser = byDistance(homeEnd[carrier.id])[0];
    if (presser) {
      set(presser.id, limit(before.positions[presser.id], pressPoint(homeEnd[carrier.id], pressGap(t.format) - 0.3), PRESS_SPEED * D));
    }
  }

  // 2) Everyone else holds a zonal shape built from the team's setup formation:
  //    the block slides towards the ball, steps up together when the ball goes
  //    back (a high press), and drops and compacts when it goes forward. A player
  //    who has just pressed and been bypassed recovers to their slot.
  const rest = outfield.filter((o) => !assigned.has(o.id));
  if (rest.length) {
    const base = (id: string) => t.initial[id] ?? before.positions[id];
    const all = outfield.map((o) => progress('away', base(o.id), p));
    const frontBase = Math.max(...all);
    const deepBase = Math.min(...all);
    const ballProg = progress('away', dest, p);
    const compress = clamp(0.55 + 0.45 * ballProg, 0.55, 1);
    // The back line holds about 12% of the pitch behind the ball, never deeper than
    // the six-yard line and never more than a little higher than its starting line.
    const minDepth = Math.max(0.05, (p.sixDepth || p.boxDepth * 0.4) / p.length);
    const back = clamp(Math.min(ballProg - 0.12, deepBase + 0.18), minDepth, 1);
    void frontBase;
    const slots: Record<string, Vec> = {};
    for (const o of rest) {
      const b = base(o.id);
      const prog = back + (progress('away', b, p) - deepBase) * compress;
      const y = p.width / 2 + (b.y - p.width / 2) * 0.8 + (dest.y - p.width / 2) * 0.35;
      slots[o.id] = { x: (1 - prog) * p.length, y: clamp(y, 1, p.width - 1) };
    }

    // 3) Dangerous runners are picked up by the zonal defender responsible for that space.
    const runners = t.players
      .filter((pl) => pl.team === 'home' && pl.line !== 'GK' && pl.id !== carrier.id && pl.id !== receiverId)
      .filter((pl) => progress('home', homeEnd[pl.id], p) > 0.55)
      .sort((x, y) => progress('home', homeEnd[y.id], p) - progress('home', homeEnd[x.id], p));
    const marking = new Set<string>();
    for (const r of runners) {
      const end = homeEnd[r.id];
      const marker = rest
        .filter((o) => !marking.has(o.id))
        .sort((x, y) => dist(slots[x.id], end) - dist(slots[y.id], end))[0];
      if (!marker || dist(slots[marker.id], end) > 14 * s + 4) continue;
      marking.add(marker.id);
      slots[marker.id] = lerp(slots[marker.id], goalSide(end, 1.2 * s + 0.6), 0.75);
    }

    for (const o of rest) {
      const from = before.positions[o.id];
      const target = slots[o.id];
      // Recovering or tracking players sprint; settled players just shuffle across.
      const speed = marking.has(o.id) || dist(from, target) > 6 ? TRACK_SPEED : SHIFT_SPEED;
      set(o.id, limit(from, target, speed * D));
    }
  }

  // 5) Goalkeeper follows the ball across the goal and comes off the line a little.
  const gk = opp.find((o) => o.line === 'GK');
  if (gk) {
    const near = dist(dest, goal) < p.length * 0.35;
    const target = {
      // Close to goal the keeper holds the line; further out they sweep behind the defence.
      x: goal.x - (near ? Math.max(0.8, p.boxDepth * 0.1) : Math.max(1.5, p.boxDepth * 0.4)),
      y: p.width / 2 + (dest.y - p.width / 2) * 0.25,
    };
    set(gk.id, limit(before.positions[gk.id], target, TRACK_SPEED * D));
  }
  return moves;
}

/**
 * Apply realistic opponent reactions to every step where the home team has the ball.
 * With `keep`, opponent moves already present on a step are kept (manual overrides)
 * and only the other opponents are filled in.
 */
export function reactAll(t: Tactic, opts: { keep?: boolean; only?: number } = {}): Step[] {
  const steps: Step[] = JSON.parse(JSON.stringify(t.steps));
  for (let i = 0; i < steps.length; i++) {
    if (opts.only !== undefined && opts.only !== i) continue;
    const before = boardStates({ ...t, steps: steps.slice(0, i) }).slice(-1)[0];
    const reaction = reactStep(t, before, steps[i]);
    if (!Object.keys(reaction).length) continue;
    const manual: Record<string, Vec[]> = {};
    for (const [id, path] of Object.entries(steps[i].moves)) {
      if (playerById(t, id)?.team === 'away') {
        if (opts.keep) manual[id] = path;
        delete steps[i].moves[id];
      }
    }
    Object.assign(steps[i].moves, reaction, manual);
  }
  return steps;
}
