import { attackingGoal, discRadius, pitchFor, progress } from '../model/pitch';
import { playerById, type BoardState } from '../model/tactic';
import type { Player, Step, Tactic, TeamSide, Vec } from '../model/types';
import { clamp, dist, lerp } from './geometry';
import { opponentsOf, scaleFor } from './options';

/**
 * Realistic support play for the team in possession.
 *
 * The players who are not part of the scripted move don't stand still: they move
 * with the play the way a coached team does.
 *  - The team keeps its shape but slides up behind the ball: the back line climbs
 *    towards halfway as rest defence, midfielders stay connected behind the ball.
 *  - The whole block shifts a little towards the ball side; the far-side full-back
 *    tucks in.
 *  - When the ball is wide in the final third, free attackers fill the box: near
 *    post, far post, penalty spot, and the edge of the box for the cutback.
 *  - The goalkeeper steps up behind a high line.
 *  - Everyone stays onside, keeps space from team-mates and opponents, and moves at
 *    realistic speeds (a jog for shape, a sprint for box runs).
 */

export const SUPPORT_SPEED = 5; // m/s, team shape moving up
export const BOX_RUN_SPEED = 6.6; // m/s, attacking the box

function clampToPitch(v: Vec, length: number, width: number): Vec {
  return { x: clamp(v.x, 0.8, length - 0.8), y: clamp(v.y, 0.8, width - 0.8) };
}

function limit(from: Vec, to: Vec, max: number): Vec {
  const d = dist(from, to);
  return d > max && d > 0 ? lerp(from, to, max / d) : to;
}

/** How far behind the ball the back line sits (fraction of the pitch). */
function restDepth(format: number): number {
  if (format <= 5) return 0.42; // futsal: the fixo stays around halfway as the last player
  if (format <= 7) return 0.38;
  return 0.34;
}

/** Highest the back line goes when attacking (fraction of the pitch). */
export function maxBackLine(format: number): number {
  return format <= 5 ? 0.5 : 0.56;
}

/**
 * Bend a run around opponents standing in its way (players run round each other, not
 * through each other). Keeps the run within the distance the player can cover.
 */
function routeAroundOpponents(from: Vec, to: Vec, obstacles: Vec[], need: number, budget: number, length: number, width: number): Vec[] {
  for (const u of [0.2, 0.4, 0.6, 0.8]) {
    const me = lerp(from, to, u);
    for (const o of obstacles) {
      if (dist(o, me) >= need || dist(o, from) < need * 0.9 || dist(o, to) < need * 0.9) continue;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const perp = { x: -dy / len, y: dx / len };
      const side = (me.x - o.x) * perp.x + (me.y - o.y) * perp.y >= 0 ? 1 : -1;
      const wp = clampToPitch({ x: o.x + perp.x * side * need * 1.15, y: o.y + perp.y * side * need * 1.15 }, length, width);
      const total = dist(from, wp) + dist(wp, to);
      return total <= budget ? [wp, to] : [lerp(from, wp, Math.min(1, budget / Math.max(dist(from, wp), 1e-6)))];
    }
  }
  return [to];
}

/** Support runs for the team that has the ball in this step (players without a scripted move). */
export function supportStep(t: Tactic, before: BoardState, step: Step, side?: TeamSide): Record<string, Vec[]> {
  const a = step.ball;
  const carrier = playerById(t, a?.from ?? before.ballOwner);
  if (!carrier || !before.positions[carrier.id]) return {};
  const team = carrier.team;
  if (side && team !== side) return {};
  if (team === 'away' && !t.showOpponents) return {};

  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const r = discRadius(p);
  const D = Math.max(0.5, step.duration);
  const goal = attackingGoal(team, p);
  const inward = goal.x > p.length / 2 ? -1 : 1; // from the goal line towards the pitch
  const xAt = (prog: number) => (team === 'home' ? prog * p.length : (1 - prog) * p.length);

  // End positions of everyone whose movement is already decided.
  const end: Record<string, Vec> = { ...before.positions };
  const scripted = new Set<string>();
  for (const [id, path] of Object.entries(step.moves)) {
    if (!path.length) continue;
    end[id] = path[path.length - 1];
    if (playerById(t, id)?.team === team) scripted.add(id);
  }
  const receiver = a && (a.type === 'pass' || a.type === 'cross') && a.to && playerById(t, a.to)?.team === team ? a.to : undefined;
  const dest: Vec = receiver ? end[receiver] : a && a.type !== 'dribble' && a.type !== 'shot' && a.target ? a.target : end[carrier.id];
  const involved = new Set([carrier.id, receiver].filter(Boolean) as string[]);

  const mates = t.players.filter((pl) => pl.team === team && before.positions[pl.id]);
  const free = mates.filter((pl) => !scripted.has(pl.id) && !involved.has(pl.id));
  if (!free.length) return {};

  const ballProg = progress(team, dest, p);
  // A cutback or recycled pass in the final third doesn't make the team retreat: the
  // shape follows the furthest point the ball has reached in this phase.
  const startProg = progress(team, before.ball, p);
  const shapeProg = ballProg > 0.6 && startProg > 0.6 ? Math.max(ballProg, startProg) : ballProg;
  const opponents = opponentsOf(t, team).filter((o) => before.positions[o.id]);
  // Offside line from where the defenders are when the step starts.
  const oppProg = opponents.map((o) => progress(team, before.positions[o.id], p)).sort((x, y) => y - x);
  const offsideLine = t.rules.offside && oppProg.length >= 2 ? oppProg[1] - 0.006 : 0.97;

  // The team's own shape from the setup.
  const outfieldMates = mates.filter((m) => m.line !== 'GK');
  const baseProg = (pl: Player) => progress(team, t.initial[pl.id] ?? before.positions[pl.id], p);
  const deepBase = Math.min(...outfieldMates.map(baseProg));
  const back = Math.min(maxBackLine(t.format), Math.max(deepBase, shapeProg - restDepth(t.format)));
  const lift = back - deepBase;
  const ballSide = Math.sign(dest.y - p.width / 2) || 1;

  const targets: Record<string, Vec> = {};
  const fast = new Set<string>();

  // Rest defence is chosen up front: the deepest players (by their place in the team
  // shape) who aren't already behind the ball through a scripted run stay back as
  // cover for a turnover, the whole way through the attack.
  const needBehind = t.format <= 6 ? 1 : t.format <= 8 ? 2 : 3;
  const restIds = new Set<string>();
  {
    let covered = 0;
    for (const m of [...outfieldMates].sort((x, y) => baseProg(x) - baseProg(y))) {
      if (covered >= needBehind) break;
      if (scripted.has(m.id) || involved.has(m.id)) {
        // A late runner arriving just behind the ball isn't cover; rest defenders are well back.
        if (progress(team, end[m.id], p) < ballProg - 0.2) covered++;
        continue;
      }
      restIds.add(m.id);
      covered++;
    }
  }

  // 1) Shape: slide up behind the ball and across towards it.
  for (const pl of free) {
    const b = t.initial[pl.id] ?? before.positions[pl.id];
    const bp = baseProg(pl);
    let prog: number;
    if (pl.line === 'GK') {
      // Sweeper-keeper: follows the back line up, but never far beyond their box.
      prog = clamp(bp + lift * 0.45, 0.02, (p.boxDepth / p.length) * 1.25);
    } else {
      // How far this player may advance: defenders stay behind the ball, midfielders
      // level with it at most, forwards onside. The limits only stop players advancing;
      // they never pull anyone back behind where they started (e.g. full-backs who are
      // already high during the build-up).
      const cap =
        pl.line === 'DEF' ? Math.min(shapeProg - 0.1, maxBackLine(t.format) + 0.04)
        : pl.line === 'MID' ? Math.min(shapeProg + 0.05, offsideLine)
        : offsideLine;
      prog = bp + Math.max(0, Math.min(lift, cap - bp));
      // Rest defenders hold a line well behind the ball (only once the team is attacking).
      if (restIds.has(pl.id) && shapeProg > 0.55) prog = Math.min(prog, Math.max(bp, Math.min(maxBackLine(t.format), ballProg - 0.18)));
    }
    let y = b.y + (dest.y - p.width / 2) * 0.2;
    // In the final third, far-side attackers narrow towards the box instead of holding the touchline.
    const farSide = Math.sign(b.y - p.width / 2) !== ballSide;
    if (shapeProg > 0.7 && farSide && (pl.line === 'FWD' || pl.line === 'MID')) y = p.width / 2 + (b.y - p.width / 2) * 0.4;
    // The far-side wide defender tucks in to protect the middle.
    const wide = Math.abs(b.y - p.width / 2) > p.width * 0.28;
    if (pl.line === 'DEF' && wide && Math.sign(b.y - p.width / 2) !== ballSide) y = p.width / 2 + (b.y - p.width / 2) * 0.6;
    if (pl.line === 'GK') y = p.width / 2 + (dest.y - p.width / 2) * 0.15;
    targets[pl.id] = { x: xAt(clamp(prog, 0.01, 0.97)), y };
  }

  // 2) Fill the box when the ball is wide in the final third or already in the box.
  const wideBall = Math.abs(dest.y - p.width / 2) > p.boxWidth / 2 - 1;
  const inBox = ballProg >= 1 - p.boxDepth / p.length - 0.01 && !wideBall;
  if (ballProg >= 0.74 && (wideBall || inBox)) {
    const six = p.sixDepth || p.boxDepth * 0.4;
    const zones: Vec[] = [];
    const farPost = { x: goal.x + inward * six * 0.9, y: p.width / 2 - ballSide * (p.goalWidth / 2 + 1) };
    const spot = { x: goal.x + inward * p.penaltySpot, y: p.width / 2 - ballSide * 1 };
    if (t.format >= 6) {
      zones.push({ x: goal.x + inward * six * 0.7, y: p.width / 2 + ballSide * (p.goalWidth / 2 + 0.8) }); // near post
      zones.push(farPost, spot);
      zones.push({ x: goal.x + inward * (p.boxDepth + 1.5), y: p.width / 2 - ballSide * p.boxWidth * 0.1 }); // cutback edge
    } else {
      zones.push(farPost, spot);
    }
    const occupied = (z: Vec) =>
      mates.some((m) => (scripted.has(m.id) || involved.has(m.id)) && dist(end[m.id], z) < 3.5 * s + 0.5);
    // Forwards and attacking midfielders fill the box; the holding midfielder stays as rest defence.
    const candidates = free.filter(
      (pl) => !restIds.has(pl.id) && (pl.line === 'FWD' || (pl.line === 'MID' && pl.role !== 'DM' && pl.role !== 'FIXO')),
    );
    const used = new Set<string>();
    for (const z of zones) {
      if (occupied(z)) continue;
      const zone = { x: xAt(Math.min(progress(team, z, p), offsideLine)), y: z.y };
      const runner = candidates
        .filter((c) => !used.has(c.id))
        .sort((x, y) => dist(before.positions[x.id], zone) - dist(before.positions[y.id], zone))[0];
      if (!runner || dist(before.positions[runner.id], zone) > BOX_RUN_SPEED * D + 12) continue;
      used.add(runner.id);
      targets[runner.id] = zone;
      fast.add(runner.id);
    }
  }

  // 2b) Rest defence: when attacking in their half, always keep enough players behind
  //     the ball to deal with a turnover (two in 7v7/8v8, three from 9v9, one in futsal).
  if (ballProg > 0.55) {
    const progOf = (id: string) => progress(team, targets[id] ?? end[id], p);
    const behind = () =>
      mates.filter((m) => m.line !== 'GK' && progOf(m.id) < ballProg - 0.1).length;
    const restProg = Math.min(ballProg - 0.18, maxBackLine(t.format));
    // Deepest free players drop in first (defenders, then holding midfielders).
    const droppers = free
      .filter((m) => m.line !== 'GK' && !fast.has(m.id) && progOf(m.id) >= ballProg - 0.1)
      .sort((x, y) => baseProg(x) - baseProg(y));
    let slot = 0;
    while (behind() < needBehind && droppers.length) {
      const m = droppers.shift()!;
      const lane = [0, -1, 1][slot % 3] * p.width * 0.16;
      targets[m.id] = { x: xAt(restProg), y: p.width / 2 + lane + (dest.y - p.width / 2) * 0.15 };
      slot++;
    }
  }

  // 3) Spacing: never finish on top of a team-mate or an opponent. Resolve overlaps with
  //    the smallest move that clears them, so the shape (and the runs) stay as intended.
  const placed: Vec[] = mates.filter((m) => scripted.has(m.id) || involved.has(m.id)).map((m) => end[m.id]);
  const oppStart = opponents.map((o) => before.positions[o.id]);
  const mateGap = 2 * r + 0.6;
  const oppGap = 2 * r + 0.3;
  const moves: Record<string, Vec[]> = {};
  for (const pl of free) {
    const from = before.positions[pl.id];
    const want = clampToPitch(targets[pl.id], p.length, p.width);
    const obstacles = [...placed.map((q) => ({ q, need: mateGap })), ...oppStart.map((q) => ({ q, need: oppGap }))];
    const clear = (v: Vec) => obstacles.every((o) => dist(o.q, v) >= o.need - 0.05);
    let target = want;
    if (!clear(want)) {
      // Nearest clear spot to where they wanted to be (searching rings around the target).
      let best: Vec | undefined;
      for (const rad of [0.5, 1, 1.5, 2, 3, 4, 5, 6.5, 8]) {
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2;
          const c = clampToPitch({ x: want.x + Math.cos(ang) * rad * r, y: want.y + Math.sin(ang) * rad * r }, p.length, p.width);
          if (clear(c) && (!best || dist(c, want) < dist(best, want))) best = c;
        }
        if (best) break;
      }
      target = best ?? want;
    }
    const budget = (fast.has(pl.id) ? BOX_RUN_SPEED : SUPPORT_SPEED) * D;
    const endPos = limit(from, target, budget);
    placed.push(endPos);
    if (dist(from, endPos) > 0.8) moves[pl.id] = routeAroundOpponents(from, endPos, oppStart, 2 * r + 0.3, budget, p.length, p.width);
  }
  return moves;
}
