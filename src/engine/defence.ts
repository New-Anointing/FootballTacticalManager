import { attackingGoal, discRadius, pitchFor, progress } from '../model/pitch';
import { playerById, type BoardState } from '../model/tactic';
import type { Step, Tactic, TeamSide, Vec } from '../model/types';
import { playerAt } from './animation';
import { clamp, dist, easeInOut, lerp } from './geometry';
import { opponentsOf, scaleFor } from './options';

/**
 * Realistic team defending.
 *
 * When one team has the ball, the other reacts the way a well-coached side would:
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

/**
 * Defending runs reacting to one step in which `attacking` has the ball. Returns {} if
 * they don't. `fixed` are defenders whose moves are scripted by the tactic designer:
 * they keep them, count as already pressing or holding, and others space around them.
 */
export function reactStep(
  t: Tactic, before: BoardState, step: Step, attacking: TeamSide = 'home', fixed: Set<string> = new Set(),
): Record<string, Vec[]> {
  if (!t.showOpponents) return {};
  const a = step.ball;
  const carrierId = a?.from ?? before.ballOwner;
  const carrier = playerById(t, carrierId);
  if (!carrier || carrier.team !== attacking || !before.positions[carrier.id]) return {};
  const defending: TeamSide = attacking === 'home' ? 'away' : 'home';

  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const D = Math.max(0.5, step.duration);
  const goal = attackingGoal(attacking, p); // the goal the defending team protects
  const toPitchX = (prog: number) => (defending === 'away' ? (1 - prog) * p.length : prog * p.length);
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

  // Where the attacking players finish this step.
  const homeEnd: Record<string, Vec> = { ...before.positions };
  for (const [id, path] of Object.entries(step.moves)) {
    if (playerById(t, id)?.team === attacking && path.length) homeEnd[id] = path[path.length - 1];
  }
  const passing = !!a && a.type !== 'dribble';
  const ballIdsAtEnd = new Set<string>();
  const release = passing ? clamp(a!.releaseAt, 0, 0.95) : 1;
  const carrierAtRelease = playerAt(step, carrier.id, before.positions[carrier.id], release);

  let dest: Vec;
  let receiverId: string | undefined;
  if (a && (a.type === 'pass' || a.type === 'cross') && a.to && playerById(t, a.to)?.team === attacking) {
    receiverId = a.to;
    dest = homeEnd[a.to];
  } else if (a && a.type !== 'dribble' && a.type !== 'shot' && a.target) {
    dest = a.target;
  } else if (a?.type === 'shot') {
    dest = carrierAtRelease;
  } else {
    dest = homeEnd[carrier.id];
  }

  ballIdsAtEnd.add(receiverId ?? carrier.id);
  const opp = opponentsOf(t, attacking).filter((o) => before.positions[o.id]);
  const outfield = opp.filter((o) => o.line !== 'GK' && !fixed.has(o.id));
  const moves: Record<string, Vec[]> = {};
  const assigned = new Set<string>();
  // Scripted defenders: where they finish, and whether one of them is already on the ball.
  const fixedEnd: Vec[] = [];
  for (const id of fixed) {
    const path = step.moves[id];
    const pos = path?.length ? path[path.length - 1] : before.positions[id];
    if (pos) fixedEnd.push(pos);
  }
  // Players bend their runs around opponents instead of running through them.
  const clearance = discRadius(p) * 2;
  const markDist = Math.max(1.2 * Math.max(1, s) + 0.6, discRadius(p) * 2.1);
  const homeIds = t.players.filter((pl) => pl.team === attacking && before.positions[pl.id]).map((pl) => pl.id);
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
        // Already that close when the step starts (e.g. they were pressing this player)
        // and not getting any closer: they are moving off, not running into them.
        const startGap = dist(from, before.positions[id]);
        if (startGap < need && dist(hm, me) >= startGap - 0.2) continue;
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
      let out = len <= budget ? path : lastDetourAroundBall ? capPath(from, [tgt], budget) : capPath(from, path, budget);
      // Never finish on top of an attacker who doesn't have the ball: take the goal-side
      // marking spot instead (a straight, reachable run).
      if (!presser) {
        const last = out[out.length - 1];
        const onTop = homeIds.find((h) => !ballIdsAtEnd.has(h) && dist(homeEnd[h], last) < markDist - 0.3);
        if (onTop) {
          const spot = clampToPitch(goalSide(homeEnd[onTop], markDist), p.length, p.width);
          if (dist(from, spot) <= budget) out = [spot];
        }
      }
      moves[id] = out;
    }
    assigned.add(id);
  };
  const byDistance = (pt: Vec) =>
    outfield.filter((o) => !assigned.has(o.id)).sort((x, y) => dist(before.positions[x.id], pt) - dist(before.positions[y.id], pt));

  // A scripted defender already engaging the ball means the engine adds no second presser.
  const pressedByScript = (pt: Vec) => fixedEnd.some((q) => dist(q, pt) < ballRoom);

  // 1) Close down the receiver: only possible once the ball is played (+ a little anticipation).
  if (passing && a!.type !== 'shot' && (receiverId || a!.target) && !pressedByScript(dest)) {
    const presser = byDistance(dest)[0];
    if (presser) {
      const reach = Math.min(PRESS_SPEED * D, PRESS_SPEED * D * (1 - release) + 1);
      set(presser.id, limit(before.positions[presser.id], pressPoint(dest, pressGap(t.format)), reach), true);
    }
  }

  // 1b) A dribble (or a player holding the ball) is closed down directly.
  if (!passing && !pressedByScript(homeEnd[carrier.id])) {
    const presser = byDistance(homeEnd[carrier.id])[0];
    if (presser) {
      set(presser.id, limit(before.positions[presser.id], pressPoint(homeEnd[carrier.id], pressGap(t.format) - 0.3), PRESS_SPEED * D), true);
    }
  }

  // The goalkeeper follows the ball across the goal and comes off the line a little.
  // Worked out first so the outfield players space themselves around the keeper.
  const gk = opp.find((o) => o.line === 'GK' && !fixed.has(o.id));
  let gkEnd: Vec | undefined;
  if (gk) {
    const near = dist(dest, goal) < p.length * 0.35;
    const inward = goal.x > p.length / 2 ? -1 : 1;
    const target = {
      // Close to goal the keeper holds the line; further out they sweep behind the defence.
      x: goal.x + inward * (near ? Math.max(0.8, p.boxDepth * 0.1) : Math.max(1.5, p.boxDepth * 0.4)),
      // Close to goal the keeper covers the near post but never leaves the goal mouth.
      y: near
        ? clamp(p.width / 2 + (dest.y - p.width / 2) * 0.25, p.width / 2 - p.goalWidth / 2 + 0.3, p.width / 2 + p.goalWidth / 2 - 0.3)
        : p.width / 2 + (dest.y - p.width / 2) * 0.25,
    };
    gkEnd = limit(before.positions[gk.id], target, TRACK_SPEED * D);
  }

  // 2) Everyone else holds a zonal shape built from the team's setup formation:
  //    the block slides towards the ball, steps up together when the ball goes
  //    back (a high press), and drops and compacts when it goes forward. A player
  //    who has just pressed and been bypassed recovers to their slot.
  const rest = outfield.filter((o) => !assigned.has(o.id));
  if (rest.length) {
    const base = (id: string) => t.initial[id] ?? before.positions[id];
    const all = outfield.map((o) => progress(defending, base(o.id), p));
    const frontBase = Math.max(...all);
    const deepBase = Math.min(...all);
    const ballProg = progress(defending, dest, p);
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
    const holder = receiverId ?? carrier.id;
    const shadowed = new Set<string>();
    const shadowing = new Set<string>();
    const marking = new Set<string>();
    // A set piece near their own goal (corner, wide free kick, kick-in): the box defence
    // holds its zones, the markers stay with the attackers they picked up at the restart,
    // and only the presser goes to the ball. Nobody slides across and leaves the goal.
    const restart = t.ballOwner ? t.initial[t.ballOwner] : undefined;
    const setPiece = t.phase === 'set-piece' && !!restart && progress(defending, restart, p) < 0.3 && ballProg < 0.3;
    if (setPiece) {
      const zone = (id: string) => t.initial[id] ?? before.positions[id];
      const attackerIds = t.players.filter((pl) => pl.team === attacking && pl.line !== 'GK' && t.initial[pl.id]).map((pl) => pl.id);
      const pairs: [string, string, number][] = [];
      for (const o of outfield) {
        for (const h of attackerIds) {
          const d = dist(zone(o.id), t.initial[h]);
          if (d < markDist * 1.8) pairs.push([o.id, h, d]);
        }
      }
      pairs.sort((x, y) => x[2] - y[2]);
      const man = new Map<string, string>();
      const taken = new Set<string>();
      for (const [o, h] of pairs) {
        if (man.has(o) || taken.has(h)) continue;
        man.set(o, h);
        taken.add(h);
      }
      // Attackers in or around the box stay marked; one who drifts well away is let go.
      const danger = 1 - (p.boxDepth + 5 * s) / p.length;
      for (const o of rest) {
        const h = man.get(o.id);
        if (h && h !== holder && homeEnd[h] && progress(attacking, homeEnd[h], p) > danger) {
          slots[o.id] = goalSide(homeEnd[h], markDist);
          marking.add(o.id);
        } else {
          // Zonal players hold their spot, edging a little towards the ball.
          const z = zone(o.id);
          const nudge = { x: (dest.x - z.x) * 0.12, y: (dest.y - z.y) * 0.12 };
          const n = Math.hypot(nudge.x, nudge.y);
          const k = n > 2.5 * s ? (2.5 * s) / n : 1;
          slots[o.id] = { x: z.x + nudge.x * k, y: z.y + nudge.y * k };
        }
      }
    } else {
      for (const o of rest) {
        const b = base(o.id);
        const prog = back + (progress(defending, b, p) - deepBase) * compress;
        const y = p.width / 2 + (b.y - p.width / 2) * 0.8 + (dest.y - p.width / 2) * 0.35;
        slots[o.id] = { x: toPitchX(prog), y: clamp(y, 1, p.width - 1) };
      }

      // 3) Cover shadow: one more defender blocks the most dangerous forward pass from the
      //    new ball carrier by standing in the lane, not by marking the receiver.
      const holderEnd = homeEnd[holder];
      const options = t.players
        .filter((pl) => pl.team === attacking && pl.line !== 'GK' && pl.id !== holder)
        .map((pl) => ({ pl, pos: homeEnd[pl.id] }))
        .filter((o) => dist(o.pos, holderEnd) > 5 * s && dist(o.pos, holderEnd) < 28 * s + 4)
        .filter((o) => progress(attacking, o.pos, p) > progress(attacking, holderEnd, p) - 0.02)
        .sort((x, y) => progress(attacking, y.pos, p) - progress(attacking, x.pos, p));
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
        .filter((pl) => pl.team === attacking && pl.line !== 'GK' && pl.id !== carrier.id && pl.id !== receiverId && !shadowed.has(pl.id))
        .filter((pl) => progress(attacking, homeEnd[pl.id], p) > 0.55)
        .sort((x, y) => progress(attacking, homeEnd[y.id], p) - progress(attacking, homeEnd[x.id], p));
      for (const r of runners) {
        const end = homeEnd[r.id];
        const marker = rest
          .filter((o) => !marking.has(o.id) && !shadowing.has(o.id))
          .sort((x, y) => dist(slots[x.id], end) - dist(slots[y.id], end))[0];
        if (!marker || dist(slots[marker.id], end) > 14 * s + 4) continue;
        marking.add(marker.id);
        slots[marker.id] = lerp(slots[marker.id], goalSide(end, Math.max(2 * s + 0.8, discRadius(p) * 2.3)), 0.6);
      }
    }

    // 5) Keep the shape: no two defenders on top of each other, and nobody but the
    //    presser right next to the ball. Overlapping players fall back to their zone.
    const minGap = 3 * s + 1;
    // Marking distance: a realistic metre or two, but never so tight that the
    // players' discs overlap on the board.
    const markGap = Math.max(1.2 * Math.max(1, s) + 0.6, discRadius(p) * 2.1);
    const attackers = t.players.filter((pl) => pl.team === attacking && homeEnd[pl.id]).map((pl) => homeEnd[pl.id]);
    const ballZone = pressGap(t.format) + 1.5;
    const placed: Vec[] = [...fixedEnd, ...Object.entries(moves).map(([, path]) => path[path.length - 1]), ...(gkEnd ? [gkEnd] : [])];
    for (const o of rest.sort((x, y) => (marking.has(x.id) || shadowing.has(x.id) ? -1 : 0) - (marking.has(y.id) || shadowing.has(y.id) ? -1 : 0))) {
      let target = slots[o.id];
      // Never stand on top of an attacker: keep a marking distance, goal-side.
      const tooClose = attackers.find((h) => dist(h, target) < markGap - 0.2);
      if (tooClose) target = goalSide(tooClose, markGap);
      if (setPiece) {
        // In a packed box, shuffle to the nearest free spot rather than stepping right away.
        const free = (q: Vec) =>
          !placed.some((v) => dist(v, q) < minGap) && dist(q, dest) >= ballZone && !attackers.some((h) => dist(h, q) < markGap - 0.2);
        if (!free(target)) {
          let spot: Vec | undefined;
          for (const rad of [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]) {
            for (let k = 0; k < 16 && !spot; k++) {
              const ang = (k * Math.PI) / 8;
              const q = clampToPitch({ x: target.x + Math.cos(ang) * rad, y: target.y + Math.sin(ang) * rad }, p.length, p.width);
              if (free(q)) spot = q;
            }
            if (spot) break;
          }
          if (spot) target = spot;
        }
        placed.push(target);
        slots[o.id] = target;
        continue;
      }
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

  if (gk && gkEnd) set(gk.id, gkEnd);
  return moves;
}

/**
 * Replace the defending team's movement in one step with the engine's reaction.
 * Returns the players whose runs the engine now controls.
 */
export function reactInPlace(t: Tactic, before: BoardState, step: Step, sides: TeamSide[], keep: boolean): string[] {
  const attacking = playerById(t, step.ball?.from ?? before.ballOwner)?.team;
  if (!attacking) return [];
  const defending: TeamSide = attacking === 'home' ? 'away' : 'home';
  if (!sides.includes(defending)) return [];
  const manual: Record<string, Vec[]> = {};
  for (const [id, path] of Object.entries(step.moves)) {
    if (playerById(t, id)?.team === defending && keep) manual[id] = path;
  }
  const reaction = reactStep(t, before, step, attacking, new Set(Object.keys(manual)));
  if (!Object.keys(reaction).length) return [];
  for (const id of Object.keys(step.moves)) {
    if (playerById(t, id)?.team === defending) delete step.moves[id];
  }
  Object.assign(step.moves, reaction, manual);
  return t.players.filter((pl) => pl.team === defending && before.positions[pl.id] && !manual[pl.id]).map((pl) => pl.id);
}
