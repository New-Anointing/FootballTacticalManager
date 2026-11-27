import { attackingGoal, discRadius, pitchFor, progress } from '../model/pitch';
import { boardStates, playerById, type BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { playerAt } from './animation';
import { clamp, dist, easeInOut, lerp } from './geometry';
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
 *  - one more player blocks the most dangerous forward pass with a cover shadow;
 *  - runners into dangerous areas are tracked, a couple of metres goal-side, by
 *    the defender in that zone;
 *  - defenders keep their spacing: no two crowd the same space or the ball;
 *  - the goalkeeper adjusts to the ball.
 * Every run is limited to what a footballer can cover in the time available.
 */

export const PRESS_SPEED = 6.8; // m/s, closing down
export const TRACK_SPEED = 6.2; // m/s, tracking a runner
export const SHIFT_SPEED = 4.5; // m/s, block shifting

/** Gap a presser leaves to a receiver so they arrive as the ball does, without fouling. */
export function pressGap(format: number): number {
  const p = pitchFor(format);
  return Math.max(1.8 * Math.max(1, scaleFor(p)) + 0.5, discRadius(p) * 2.1);
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
  // Players bend their runs around opponents instead of running through them.
  const clearance = discRadius(p) * 2;
  const homeIds = t.players.filter((pl) => pl.team === 'home' && before.positions[pl.id]).map((pl) => pl.id);
  // Only the designated presser may approach the ball; everyone else gives the carrier room.
  const ballRoom = pressGap(t.format) + 1.5;
  let lastDetourAroundBall = false;
  const routeAround = (from: Vec, to: Vec, presser = false): Vec[] => {
    lastDetourAroundBall = false;
    // Check the run against where each attacker actually is at that moment of the step.
    for (const u of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]) {
      const me = lerp(from, to, easeInOut(u));
      for (const id of homeIds) {
        const hm = playerAt(step, id, before.positions[id], u);
        // The passer only has the ball until release, the receiver only once it's played.
        const hasBall = (id === carrier.id && (!passing || u <= release)) || (id === receiverId && u >= release);
        const need = !presser && hasBall ? ballRoom : clearance;
        if (dist(hm, me) >= need) continue;
        // Already that close when the step starts (e.g. they were pressing this player):
        // they are moving off, not running into them.
        if (dist(from, before.positions[id]) < need) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const perp = { x: -dy / len, y: dx / len };
        const side = (me.x - hm.x) * perp.x + (me.y - hm.y) * perp.y >= 0 ? 1 : -1;
        const wp = clampToPitch({ x: hm.x + perp.x * side * need * 1.1, y: hm.y + perp.y * side * need * 1.1 }, p.length, p.width);
        lastDetourAroundBall = hasBall;
        return [wp, to];
      }
    }
    return [to];
  };
  /** Truncate a run along its waypoints to what the player can cover in the step. */
  const capPath = (from: Vec, pts: Vec[], max: number): Vec[] => {
    const out: Vec[] = [];
    let left = max;
    let cur = from;
    for (const pt of pts) {
      const d = dist(cur, pt);
      if (d <= left) {
        out.push(pt);
        left -= d;
        cur = pt;
      } else {
        out.push(lerp(cur, pt, left / Math.max(d, 1e-6)));
        break;
      }
    }
    return out;
  };
  const set = (id: string, target: Vec, presser = false) => {
    const from = before.positions[id];
    const tgt = clampToPitch(target, p.length, p.width);
    if (dist(from, tgt) > 0.4) {
      const budget = (presser ? PRESS_SPEED : TRACK_SPEED) * D;
      const path = routeAround(from, tgt, presser);
      let len = 0;
      let cur = from;
      for (const pt of path) {
        len += dist(cur, pt);
        cur = pt;
      }
      // A detour must still fit in the time available; if it doesn't, take the direct
      // (speed-limited) run rather than stopping half-way round the detour.
      // Around the ball carrier a short-stopped detour would leave them next to the ball,
      // so they take the direct run; around anyone else they go round and finish a bit short.
      moves[id] = len <= budget ? path : lastDetourAroundBall ? capPath(from, [tgt], budget) : capPath(from, path, budget);
    }
    assigned.add(id);
  };
  const byDistance = (pt: Vec) =>
    outfield.filter((o) => !assigned.has(o.id)).sort((x, y) => dist(before.positions[x.id], pt) - dist(before.positions[y.id], pt));

  // 1) Close down the receiver: only possible once the ball is played (+ a little anticipation).
  if (passing && a!.type !== 'shot' && (receiverId || a!.target)) {
    const presser = byDistance(dest)[0];
    if (presser) {
      const reach = Math.min(PRESS_SPEED * D, PRESS_SPEED * D * (1 - release) + 1);
      set(presser.id, limit(before.positions[presser.id], pressPoint(dest, pressGap(t.format)), reach), true);
    }
  }

  // 1b) A dribble (or a player holding the ball) is closed down directly.
  if (!passing) {
    const presser = byDistance(homeEnd[carrier.id])[0];
    if (presser) {
      set(presser.id, limit(before.positions[presser.id], pressPoint(homeEnd[carrier.id], pressGap(t.format) - 0.3), PRESS_SPEED * D), true);
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
    // Until the ball is in (or right at) the box, the line holds around the edge of the
    // box instead of collapsing onto the six-yard line.
    const boxEdge = p.boxDepth / p.length;
    const ballNearBox = ballProg < boxEdge + 0.04 && Math.abs(dest.y - p.width / 2) < p.boxWidth / 2 + 2;
    const floor = ballNearBox ? minDepth : Math.max(minDepth, Math.min(boxEdge, ballProg - 0.03));
    const back = clamp(Math.min(ballProg - 0.12, deepBase + 0.18), floor, 1);
    void frontBase;
    const slots: Record<string, Vec> = {};
    for (const o of rest) {
      const b = base(o.id);
      const prog = back + (progress('away', b, p) - deepBase) * compress;
      const y = p.width / 2 + (b.y - p.width / 2) * 0.8 + (dest.y - p.width / 2) * 0.35;
      slots[o.id] = { x: (1 - prog) * p.length, y: clamp(y, 1, p.width - 1) };
    }

    // 3) Cover shadow: one more defender blocks the most dangerous forward pass from the
    //    new ball carrier by standing in the lane, not by marking the receiver.
    const holder = receiverId ?? carrier.id;
    const holderEnd = homeEnd[holder];
    const options = t.players
      .filter((pl) => pl.team === 'home' && pl.line !== 'GK' && pl.id !== holder)
      .map((pl) => ({ pl, pos: homeEnd[pl.id] }))
      .filter((o) => dist(o.pos, holderEnd) > 5 * s && dist(o.pos, holderEnd) < 28 * s + 4)
      .filter((o) => progress('home', o.pos, p) > progress('home', holderEnd, p) - 0.02)
      .sort((x, y) => progress('home', y.pos, p) - progress('home', x.pos, p));
    const shadowed = new Set<string>();
    const shadowing = new Set<string>();
    const lane = options[0];
    if (lane) {
      // Stand in the lane, far enough from the carrier to block the pass rather than press.
      const laneLen = dist(holderEnd, lane.pos);
      const along = Math.min(laneLen - 1, Math.max(0.45 * laneLen, pressGap(t.format) + 2));
      const point = lerp(holderEnd, lane.pos, along / Math.max(laneLen, 1e-6));
      const coverer = rest.sort((x, y) => dist(slots[x.id], point) - dist(slots[y.id], point))[0];
      if (coverer && dist(before.positions[coverer.id], point) < TRACK_SPEED * D + 4) {
        slots[coverer.id] = point;
        shadowing.add(coverer.id);
        shadowed.add(lane.pl.id);
      }
    }

    // 4) Dangerous runners are picked up by the zonal defender responsible for that space,
    //    who stays a couple of metres goal-side rather than on their back.
    const runners = t.players
      .filter((pl) => pl.team === 'home' && pl.line !== 'GK' && pl.id !== carrier.id && pl.id !== receiverId && !shadowed.has(pl.id))
      .filter((pl) => progress('home', homeEnd[pl.id], p) > 0.55)
      .sort((x, y) => progress('home', homeEnd[y.id], p) - progress('home', homeEnd[x.id], p));
    const marking = new Set<string>();
    for (const r of runners) {
      const end = homeEnd[r.id];
      const marker = rest
        .filter((o) => !marking.has(o.id) && !shadowing.has(o.id))
        .sort((x, y) => dist(slots[x.id], end) - dist(slots[y.id], end))[0];
      if (!marker || dist(slots[marker.id], end) > 14 * s + 4) continue;
      marking.add(marker.id);
      slots[marker.id] = lerp(slots[marker.id], goalSide(end, Math.max(2 * s + 0.8, discRadius(p) * 2.3)), 0.6);
    }

    // 5) Keep the shape: no two defenders on top of each other, and nobody but the
    //    presser right next to the ball. Overlapping players fall back to their zone.
    const minGap = 3 * s + 1;
    // Marking distance: a realistic metre or two, but never so tight that the
    // players' discs overlap on the board.
    const markGap = Math.max(1.2 * Math.max(1, s) + 0.6, discRadius(p) * 2.1);
    const attackers = t.players.filter((pl) => pl.team === 'home' && homeEnd[pl.id]).map((pl) => homeEnd[pl.id]);
    const ballZone = pressGap(t.format) + 1.5;
    const placed: Vec[] = Object.entries(moves).map(([, path]) => path[path.length - 1]);
    for (const o of rest.sort((x, y) => (marking.has(x.id) || shadowing.has(x.id) ? -1 : 0) - (marking.has(y.id) || shadowing.has(y.id) ? -1 : 0))) {
      let target = slots[o.id];
      // Never stand on top of an attacker: keep a marking distance, goal-side.
      const tooClose = attackers.find((h) => dist(h, target) < markGap - 0.2);
      if (tooClose) target = goalSide(tooClose, markGap);
      for (let k = 0; k < 4; k++) {
        const clash = placed.find((q) => dist(q, target) < minGap);
        const nearBall = dist(target, dest) < ballZone;
        if (!clash && !nearBall) break;
        // Step away from the clash, towards their own goal (staying goal-side).
        const from = clash ?? dest;
        const away = { x: target.x - from.x, y: target.y - from.y };
        const len = Math.hypot(away.x, away.y) || 1;
        target = { x: target.x + (away.x / len) * minGap * 0.6 + (goal.x - target.x) * 0.05, y: target.y + (away.y / len) * minGap * 0.6 };
        target = clampToPitch(target, p.length, p.width);
      }
      placed.push(target);
      slots[o.id] = target;
    }

    for (const o of rest) {
      const from = before.positions[o.id];
      const target = slots[o.id];
      // Recovering, covering or tracking players sprint; settled players just shuffle across.
      const speed = marking.has(o.id) || shadowing.has(o.id) || dist(from, target) > 6 ? TRACK_SPEED : SHIFT_SPEED;
      let end = limit(from, target, speed * D);
      // Only the presser engages the ball: anyone else finishing inside pressing range
      // steps back to the edge of it, on the goal side.
      if (dist(end, dest) < ballRoom) {
        let dx = end.x - dest.x;
        let dy = end.y - dest.y;
        if (Math.hypot(dx, dy) < 0.3) {
          dx = goal.x - dest.x;
          dy = goal.y - dest.y;
        }
        // Pick the reachable point on the edge of pressing range closest to where they
        // wanted to be; if none is reachable, hold off on the approach line.
        const want = Math.atan2(dy, dx);
        let best: Vec | undefined;
        for (let k = 0; k < 16; k++) {
          const ang = want + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI) / 8;
          const ring = clampToPitch({ x: dest.x + Math.cos(ang) * ballRoom, y: dest.y + Math.sin(ang) * ballRoom }, p.length, p.width);
          if (dist(ring, dest) < ballRoom - 0.3 || dist(from, ring) > TRACK_SPEED * D) continue;
          if (!best || dist(ring, end) < dist(best, end)) best = ring;
        }
        if (!best) {
          const away = dist(from, dest) || 1;
          best = lerp(dest, from, Math.min(1, ballRoom / away));
        }
        end = best;
      }
      set(o.id, end);
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
