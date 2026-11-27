import { attackingGoal, pitchFor, progress, type PitchSpec } from '../model/pitch';
import { activePlayers, playerById } from '../model/tactic';
import type { Player, Tactic, TeamSide, Vec } from '../model/types';
import { dist, distToSegment, goalAngle } from './geometry';

/** Distance thresholds are tuned for 11v11; this scales them to the pitch in use. */
export const scaleFor = (p: PitchSpec): number => Math.max(0.45, p.length / 105);

export function opponentsOf(t: Tactic, side: TeamSide): Player[] {
  if (!t.showOpponents) return [];
  return t.players.filter((p) => p.team !== side);
}

export function teammatesOf(t: Tactic, side: TeamSide): Player[] {
  return activePlayers(t).filter((p) => p.team === side);
}

/** Smallest gap (m) between any opponent and the straight line of a pass. */
export function laneClearance(from: Vec, to: Vec, opponents: Vec[]): number {
  let min = Infinity;
  for (const o of opponents) {
    const { d, t } = distToSegment(o, from, to);
    // Ignore defenders level with or behind the passer: they cannot cut the lane.
    if (t <= 0.02 && dist(o, from) > 1.5) continue;
    min = Math.min(min, d);
  }
  return min;
}

/**
 * Is `receiverPos` offside when the ball is played from `ballPos`?
 * Uses the second-last opponent (usually the last outfield defender) as the line.
 */
export function isOffside(
  t: Tactic,
  side: TeamSide,
  positions: Record<string, Vec>,
  ballPos: Vec,
  receiverPos: Vec,
): boolean {
  if (!t.rules.offside || !t.showOpponents) return false;
  const p = pitchFor(t.format);
  const opp = opponentsOf(t, side)
    .map((o) => positions[o.id])
    .filter(Boolean)
    .map((pos) => progress(side, pos, p))
    .sort((a, b) => b - a);
  if (opp.length < 2) return false;
  const line = opp[1];
  const r = progress(side, receiverPos, p);
  const tolerance = 0.4 / p.length; // level is onside
  return r > 0.5 && r > line + tolerance && r > progress(side, ballPos, p) + tolerance;
}

export interface PassOption {
  to: string;
  distance: number;
  /** Gap between the pass line and the nearest opponent (m). */
  clearance: number;
  /** Change in up-pitch progress (fraction of pitch length). */
  gain: number;
  offside: boolean;
  /** Nearest opponent to the receiver (m). */
  pressure: number;
  score: number;
}

/** Rank the passing options available to the ball carrier on a static board. */
export function passOptions(t: Tactic, positions: Record<string, Vec>, carrierId: string): PassOption[] {
  const carrier = playerById(t, carrierId);
  const from = positions[carrierId];
  if (!carrier || !from) return [];
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const oppPos = opponentsOf(t, carrier.team).map((o) => positions[o.id]).filter(Boolean);
  const options: PassOption[] = [];
  for (const mate of teammatesOf(t, carrier.team)) {
    if (mate.id === carrierId) continue;
    const to = positions[mate.id];
    if (!to) continue;
    const d = dist(from, to);
    if (d < 2.5 * s) continue;
    const clearance = oppPos.length ? laneClearance(from, to, oppPos) : 99;
    const pressure = oppPos.length ? Math.min(...oppPos.map((o) => dist(o, to))) : 99;
    const gain = progress(carrier.team, to, p) - progress(carrier.team, from, p);
    const offside = isOffside(t, carrier.team, positions, from, to);
    const safety = Math.min(clearance, 6 * s) / (6 * s);
    const freedom = Math.min(pressure, 8 * s) / (8 * s);
    const lengthPenalty = d > 35 * s ? 0.25 : 0;
    const gkPenalty = mate.line === 'GK' ? 0.3 : 0;
    const score = offside ? -1 : safety * 1.2 + freedom * 0.8 + gain * 2.2 - lengthPenalty - gkPenalty;
    options.push({ to: mate.id, distance: d, clearance, gain, offside, pressure, score });
  }
  return options.sort((a, b) => b.score - a.score);
}

/** Simple expected-goals estimate from shot location, goal angle and blockers. */
export function shotXg(t: Tactic, side: TeamSide, from: Vec, positions: Record<string, Vec>, aim?: Vec): number {
  const p = pitchFor(t.format);
  const goal = attackingGoal(side, p);
  const norm = 105 / p.length; // compare distances as if on a full-size pitch
  const d = dist(from, goal) * norm;
  // Angle is scale-invariant, so small goals on small pitches compare fairly with 11v11.
  const angle = goalAngle(from, goal, p.goalWidth);
  let xg = 1 / (1 + Math.exp(-(-1.1 - 0.12 * d + 2.2 * angle)));
  // Blockers are judged along the line the shot actually takes (default: centre of goal).
  const line = aim && Math.abs(aim.x - goal.x) < 1 ? aim : goal;
  for (const o of opponentsOf(t, side)) {
    const op = positions[o.id];
    if (!op || o.line === 'GK') continue;
    const { d: gap, t: along } = distToSegment(op, from, line);
    if (along > 0.02 && along < 0.98 && gap < 1.2) xg *= 0.55;
  }
  return Math.max(0.005, Math.min(0.95, xg));
}
