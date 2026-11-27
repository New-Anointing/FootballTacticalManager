import { discRadius, pitchFor } from '../model/pitch';
import { pressGap } from './defence';
import { scaleFor } from './options';
import type { BoardState } from '../model/tactic';
import type { Step, Tactic, Vec } from '../model/types';
import { clamp, cutPath, dist, pathLength, pointAlong } from './geometry';
import { AT_REST, runFraction, runPeakSpeed, SPRINT, type StepCarry } from './motion';

const SAMPLES = 16;

/**
 * Players run round each other, not through each other. After the engines have moved
 * everyone in a step, an engine-controlled run that passes through an opponent (or
 * finishes on top of one) is bent around them; only if there is no time for that does
 * it finish a little short or to one side. Runs in `adjustable` may change; scripted
 * runs, and the players on the ball, never do. With `sameEnd`, runs are only bent:
 * everyone still finishes where they were going.
 */
export function deconflictStep(
  t: Tactic, before: BoardState, step: Step, adjustable: Set<string>, carry: StepCarry = {}, sameEnd = false,
): void {
  const p = pitchFor(t.format);
  const r = discRadius(p);
  const D = Math.max(0.5, step.duration);
  const players = t.players.filter((pl) => before.positions[pl.id] && (pl.team === 'home' || t.showOpponents));
  const teamOf = new Map(players.map((pl) => [pl.id, pl.team]));
  const a = step.ball;
  // The ball carrier can be closed down tightly, but not run through; they never change.
  const onBall = new Set([before.ballOwner, a?.from, a?.to].filter((x): x is string => !!x));
  const pathOf = (id: string): Vec[] => {
    const m = step.moves[id];
    return m && m.length ? [before.positions[id], ...m] : [before.positions[id]];
  };
  // Where a player is part-way through the step, with the speed they carry in and out.
  const frac = (id: string, path: Vec[], u: number) => runFraction(pathLength(path), D, u, carry[id]);
  const at = (id: string, path: Vec[], u: number) => pointAlong(path, frac(id, path, u));
  const clampPitch = (v: Vec): Vec => ({ x: clamp(v.x, 0.5, p.length - 0.5), y: clamp(v.y, 0.5, p.width - 0.5) });
  // A little more room than the analysis demands (1.8r), so playback never shows discs merging.
  const need = (x: string, y: string) => (onBall.has(x) || onBall.has(y) ? 1.25 * r : 1.95 * r);
  // Team-mates may brush past each other, but their discs never sit on top of one another.
  const mateNeed = 1.75 * r;

  // Only the presser closes down the ball; nobody else is moved into that space.
  const ballRoom = pressGap(t.format) + 1.5;
  // Two defenders this close to the same attacker is a double-team (the analysis flags it).
  const crowd = Math.max(2.2 * Math.max(1, scaleFor(p)), r * 2.2);

  interface Clash {
    /** Sum over everyone of how far short of the room needed the run comes (m); team-mates count a little less. */
    total: number;
    /** The worst single clash, when it happens and with whom. */
    worst: number;
    u: number;
    other?: string;
    /** Worst shortfall against team-mates. */
    mate: number;
    /** Closest the run comes to an opponent on the ball. */
    ballMin: number;
  }
  /** How a run for `id` clashes with everyone else during the step. */
  const clashes = (id: string, path: Vec[]): Clash => {
    const res: Clash = { total: 0, worst: 0, u: 0, mate: 0, ballMin: Infinity };
    for (const pl of players) {
      if (pl.id === id) continue;
      const theirs = pathOf(pl.id);
      const same = teamOf.get(pl.id) === teamOf.get(id);
      const lim = same ? mateNeed : need(id, pl.id);
      const d0 = dist(path[0], theirs[0]);
      let mine = 0;
      for (let k = 1; k <= SAMPLES; k++) {
        const u = k / SAMPLES;
        const d = dist(at(id, path, u), at(pl.id, theirs, u));
        if (!same && onBall.has(pl.id)) res.ballMin = Math.min(res.ballMin, d);
        if (d >= lim) continue;
        // Already that close at the start and not closing in: moving off, not running into them.
        if (d0 < lim && d >= d0 - 0.2) continue;
        const short = (lim - d) * (same ? 0.8 : 1);
        if (same) res.mate = Math.max(res.mate, lim - d);
        mine = Math.max(mine, short);
        if (short > res.worst) {
          res.worst = short;
          res.u = u;
          res.other = pl.id;
        }
      }
      res.total += mine;
    }
    return res;
  };
  /** Would finishing at `end` make `id` the second defender on top of an attacker? */
  const doubles = (id: string, end: Vec): number => {
    let n = 0;
    for (const pl of players) {
      if (teamOf.get(pl.id) === teamOf.get(id) || pl.line === 'GK') continue;
      const theirEnd = pathOf(pl.id).slice(-1)[0];
      if (dist(theirEnd, end) >= crowd) continue;
      const others = players.filter(
        (m) => m.id !== id && m.line !== 'GK' && teamOf.get(m.id) === teamOf.get(id) && dist(pathOf(m.id).slice(-1)[0], theirEnd) < crowd,
      );
      if (others.length) n++;
    }
    return n;
  };

  /** Alternative runs for `id`: round the other player on either side, shorter, or to one side. */
  const alternatives = (id: string, path: Vec[], u: number, other: string): Vec[][] => {
    const S = path[0];
    const E = path[path.length - 1];
    const m = at(id, path, u);
    const q = at(other, pathOf(other), u);
    let n = { x: m.x - q.x, y: m.y - q.y };
    const nl = Math.hypot(n.x, n.y);
    if (nl < 0.2) {
      // Nearly on the same spot: go round at right angles to the run.
      const dx = E.x - S.x;
      const dy = E.y - S.y;
      const dl = Math.hypot(dx, dy) || 1;
      n = { x: -dy / dl, y: dx / dl };
    } else n = { x: n.x / nl, y: n.y / nl };
    // Which leg of the run the clash is on, so the detour goes in the right place.
    let along = pathLength(path) * frac(id, path, u);
    let seg = 1;
    for (; seg < path.length - 1; seg++) {
      const l = dist(path[seg - 1], path[seg]);
      if (along <= l) break;
      along -= l;
    }
    const out: Vec[][] = [];
    if (path.length > 1) {
      for (const side of [1, -1]) {
        for (const w of [2.2, 2.7, 3.3]) {
          const wp = clampPitch({ x: q.x + n.x * side * w * r, y: q.y + n.y * side * w * r });
          out.push([...path.slice(0, seg), wp, ...path.slice(seg)]);
        }
      }
      if (sameEnd) return out;
      for (const f of [0.85, 0.7, 0.55, 0.4]) out.push(cutPath(path, f));
    }
    if (sameEnd) return out;
    for (const k of [1, 1.6, 2.3]) {
      for (const side of [1, -1]) out.push([S, clampPitch({ x: E.x + n.x * side * k * r, y: E.y + n.y * side * k * r })]);
    }
    if (path.length > 1) out.push([S]);
    return out;
  };

  const apply = (id: string, path: Vec[]) => {
    if (path.length <= 1 || (dist(path[0], path[path.length - 1]) < 0.3 && pathLength(path) < 0.6)) delete step.moves[id];
    else step.moves[id] = path.slice(1);
  };

  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const pl of players) {
      const current = clashes(pl.id, pathOf(pl.id));
      if (current.worst <= 0 || !current.other) continue;
      // Adjust whichever of the two the engine controls; if both, the cheaper change wins.
      const movers = [pl.id, current.other].filter((id) => adjustable.has(id) && !onBall.has(id));
      let best: { id: string; path: Vec[]; cost: number } | undefined;
      for (const id of movers) {
        const orig = pathOf(id);
        const base = id === pl.id ? current : clashes(id, orig);
        const other = id === pl.id ? current.other : pl.id;
        // A detour must still be runnable: no faster than a hard sprint (or than the original run).
        const maxPeak = Math.max(SPRINT, runPeakSpeed(pathLength(orig), D, carry[id] ?? AT_REST)) + 0.05;
        const baseDoubles = doubles(id, orig[orig.length - 1]);
        for (const cand of alternatives(id, orig, current.u, other)) {
          if (pathLength(cand) > pathLength(orig) + 0.01 && runPeakSpeed(pathLength(cand), D, carry[id] ?? AT_REST) > maxPeak) continue;
          const c = clashes(id, cand);
          if (c.total >= base.total - 0.05) continue; // must actually help
          // Never make team-mates overlap, crowd the ball or double up where they didn't before.
          if (c.mate > Math.max(base.mate, 0) + 0.05 && teamOf.get(other) !== teamOf.get(id)) continue;
          if (c.ballMin < Math.min(base.ballMin, ballRoom) - 0.1) continue;
          if (doubles(id, cand[cand.length - 1]) > baseDoubles) continue;
          const endMove = dist(cand[cand.length - 1], orig[orig.length - 1]);
          const cost = 4 * endMove + 0.5 * Math.max(0, pathLength(cand) - pathLength(orig)) + 40 * c.total;
          if (!best || cost < best.cost) best = { id, path: cand, cost };
        }
      }
      if (best) {
        apply(best.id, best.path);
        changed = true;
      }
    }
    if (!changed) break;
  }
}
