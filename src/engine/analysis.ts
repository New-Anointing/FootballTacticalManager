import { attackingGoal, discRadius, inPenaltyArea, insidePitch, ownGoal, pitchFor, progress } from '../model/pitch';
import { activePlayers, boardStates, playerById, playerLabel, type BoardState } from '../model/tactic';
import type { Player, Step, Tactic, TeamSide, Vec } from '../model/types';
import { ballFlight, frameAtStep, playerPath } from './animation';
import { PRESS_SPEED, pressGap } from './defence';
import { maxBackLine } from './support';
import { dist, lerp, pathLength } from './geometry';
import { isOffside, opponentsOf, passOptions, scaleFor, shotXg, teammatesOf } from './options';

export type Severity = 'error' | 'warning' | 'info' | 'good';

export type Fix =
  | { kind: 'reroute-pass'; stepIndex: number; to: string }
  | { kind: 'extend-duration'; stepIndex: number; duration: number }
  | { kind: 'set-release'; stepIndex: number; releaseAt: number }
  | { kind: 'react-defence'; stepIndex: number }
  | { kind: 'support-shape'; stepIndex: number };

export interface Finding {
  id: string;
  severity: Severity;
  category: 'movement' | 'passing' | 'shape' | 'defending' | 'finishing' | 'outcome' | 'rules' | 'setup' | 'realism';
  title: string;
  detail: string;
  /** -1 = setup / whole tactic. */
  stepIndex: number;
  players: string[];
  fix?: Fix;
}

export interface StepMetrics {
  stepIndex: number;
  possession?: TeamSide;
  width: number;
  depth: number;
  xg?: number;
  passDistance?: number;
  passClearance?: number;
}

export interface AnalysisReport {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  verdict: string;
  findings: Finding[];
  metrics: StepMetrics[];
  counts: Record<Severity, number>;
}

const MAX_SPRINT = 9.5; // m/s, elite top speed
const HARD_SPRINT = 7.5;
const MAX_PASS_SPEED = 32; // m/s, a driven pass
const MAX_DRIBBLE = 7; // m/s, top speed with the ball
const REACT = 1.2; // m an opponent can stretch to reach the ball

let seq = 0;
const fid = () => `f${++seq}`;

function teamName(t: Tactic, side: TeamSide): string {
  return side === 'home' ? t.homeName : t.awayName;
}

function outfield(players: Player[]): Player[] {
  return players.filter((p) => p.line !== 'GK');
}

function shape(players: Player[], positions: Record<string, Vec>) {
  const pts = outfield(players).map((p) => positions[p.id]).filter(Boolean);
  if (pts.length < 2) return { width: 0, depth: 0 };
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { width: Math.max(...ys) - Math.min(...ys), depth: Math.max(...xs) - Math.min(...xs) };
}

/** Analyse a full tactic and produce a scored report with concrete findings. */
export function analyseTactic(t: Tactic): AnalysisReport {
  seq = 0;
  const p = pitchFor(t.format);
  const states = boardStates(t);
  const findings: Finding[] = [];
  const metrics: StepMetrics[] = [];
  const players = activePlayers(t);

  // --- Setup checks -------------------------------------------------------
  for (const pl of players) {
    const pos = t.initial[pl.id];
    if (pos && !insidePitch(pos, p, 0.5)) {
      findings.push({
        id: fid(), severity: 'error', category: 'setup', stepIndex: -1, players: [pl.id],
        title: `${playerLabel(pl)} starts off the pitch`,
        detail: 'Drag the player back inside the lines in the Setup frame.',
      });
    }
  }
  checkSetup(t, findings);
  if (t.steps.length === 0) {
    findings.push({
      id: fid(), severity: 'info', category: 'setup', stepIndex: -1, players: [],
      title: 'No movement yet',
      detail: 'Add a step and draw runs and passes to turn this shape into a tactic.',
    });
  }

  // --- Per step -----------------------------------------------------------
  t.steps.forEach((step, i) => {
    const before = states[i];
    const after = states[i + 1];
    const possession: TeamSide | undefined =
      playerById(t, step.ball?.from)?.team ?? playerById(t, before.ballOwner)?.team;
    const m: StepMetrics = { stepIndex: i, possession, width: 0, depth: 0 };

    checkMovement(t, step, i, before, findings, p);
    if (possession === 'home' && t.showOpponents) checkOpponentRealism(t, step, i, states, findings);
    if (possession === 'home') checkTeamSupport(t, step, i, states, findings);
    if (step.ball) checkBallAction(t, step, i, states, findings, m);

    if (possession) {
      const attackers = teammatesOf(t, possession);
      const sh = shape(attackers, after.positions);
      m.width = sh.width;
      m.depth = sh.depth;
      if (possession === 'home') checkAttackingShape(t, i, possession, attackers, after, findings);
      if (t.showOpponents) checkDefensiveShape(t, i, possession, after, findings);
    }
    checkOutcome(t, step, i, before, after, possession, findings, m);

    if (!step.note.trim()) {
      findings.push({
        id: fid(), severity: 'info', category: 'outcome', stepIndex: i, players: [],
        title: `Step ${i + 1} has no coaching note`,
        detail: 'A short note ("pivot drops to drag the marker") makes playback far clearer for players.',
      });
    }
    metrics.push(m);
  });

  // Out-of-bounds at any boundary.
  states.slice(1).forEach((st, idx) => {
    for (const pl of players) {
      const pos = st.positions[pl.id];
      if (pos && !insidePitch(pos, p, 0.5)) {
        findings.push({
          id: fid(), severity: 'error', category: 'movement', stepIndex: idx, players: [pl.id],
          title: `${playerLabel(pl)} runs off the pitch`,
          detail: `By the end of step ${idx + 1} the player is outside the field of play.`,
        });
      }
    }
  });

  // Repeated positives (e.g. "good width" every step) are reported once.
  const seenGood = new Set<string>();
  const deduped = findings.filter((f) => {
    if (f.severity !== 'good') return true;
    if (seenGood.has(f.title)) return false;
    seenGood.add(f.title);
    return true;
  });
  findings.length = 0;
  findings.push(...deduped);
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0, good: 0 };
  findings.forEach((f) => counts[f.severity]++);
  const raw = 100 - counts.error * 14 - counts.warning * 5 + Math.min(10, counts.good * 1.5);
  // Any serious error means the move breaks down, so it can't grade above C.
  const cap = counts.error > 0 ? 69 - 12 * (counts.error - 1) : 100;
  const score = Math.max(0, Math.min(cap, Math.round(raw)));
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'F';
  const verdict =
    t.steps.length === 0
      ? 'Draw some movement to get a verdict.'
      : counts.error > 0
        ? `Not ready: ${counts.error} serious problem${counts.error > 1 ? 's' : ''} would break this move in a real match.`
        : counts.warning > 3
          ? 'Workable, but opponents could exploit several weaknesses.'
          : counts.warning > 0
            ? 'Sound tactic with a few things to tighten.'
            : 'Strong tactic: realistic movement, safe passing and good structure.';

  const order: Record<Severity, number> = { error: 0, warning: 1, good: 2, info: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.stepIndex - b.stepIndex);
  return { score, grade, verdict, findings, metrics, counts };
}

/**
 * Is the opposition behaving like a real team? A move only proves something if it
 * works against opponents who press the ball and track runners. Flags passive
 * ("statue") defending so tactics aren't validated against an unrealistic defence.
 */
function checkOpponentRealism(t: Tactic, step: Step, i: number, states: BoardState[], findings: Finding[]) {
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const before = states[i];
  const after = states[i + 1];
  const D = Math.max(0.1, step.duration);
  const opp = outfield(opponentsOf(t, 'home')).filter((o) => before.positions[o.id] && after.positions[o.id]);
  if (!opp.length) return;
  const moved = (id: string) => pathLength(playerPath(step, id, before.positions[id]));
  const fix: Fix = { kind: 'react-defence', stepIndex: i };

  // Caught in possession: an opponent is on the carrier before the ball is released.
  const a = step.ball;
  if (a && a.type !== 'dribble' && before.ballOwner === a.from && before.positions[a.from]) {
    const release = Math.min(Math.max(a.releaseAt, 0), 0.95);
    const fr = frameAtStep(t, states, i, release);
    const carrierPos = fr.positions[a.from];
    const tackler = opp.find((o) => fr.positions[o.id] && dist(fr.positions[o.id], carrierPos) < 1.0);
    if (tackler && carrierPos) {
      findings.push({
        id: fid(), severity: 'error', category: 'realism', stepIndex: i, players: [a.from, tackler.id],
        title: `${playerLabel(playerById(t, a.from)!)} is caught in possession`,
        detail: `${playerLabel(tackler)} is on the ball before it is released. Release it earlier or move away from the press.`,
        fix: { kind: 'set-release', stepIndex: i, releaseAt: Math.max(0, release - 0.25) },
      });
    }
  }

  // An opponent on top of an attacker who doesn't have the ball, at the end of the step
  // or while the players are moving (what you see in playback).
  const overlap = discRadius(p) * 1.8;
  // The ball carrier can be pressed closely, but not run through.
  const contact = discRadius(p) * 1.15;
  onTop: for (const tt of [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
    const fr = tt === 1 ? { positions: after.positions } : frameAtStep(t, states, i, tt);
    for (const o of opp) {
      const op = fr.positions[o.id];
      if (!op) continue;
      const victim = teammatesOf(t, 'home').find((h) => {
        const hp = fr.positions[h.id];
        if (!hp) return false;
        const carrying = h.id === before.ballOwner || h.id === after.ballOwner || h.id === step.ball?.from || h.id === step.ball?.to;
        const d = dist(hp, op);
        if (d >= (carrying ? contact : overlap)) return false;
        // Already close at the start of the step (e.g. the presser on the player who
        // just passed) and moving apart: that's not running on top of someone.
        const d0 = before.positions[h.id] && before.positions[o.id] ? dist(before.positions[h.id], before.positions[o.id]) : Infinity;
        return !(d0 < overlap && d >= d0 - 0.2);
      });
      if (victim) {
        findings.push({
          id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: [victim.id, o.id],
          title: `${playerLabel(o)} runs on top of ${playerLabel(victim)}`,
          detail: 'Defenders mark from a metre or two goal-side so they can react, and players run around each other, not through each other.',
          fix,
        });
        break onTop;
      }
    }
  }

  // Two opponents converging on the ball carrier at once (during the step or at its end):
  // real teams press with one and cover the passing lanes with the rest.
  const carrierId = step.ball?.type === 'dribble' ? step.ball.from : after.ballOwner;
  if (carrierId && playerById(t, carrierId)?.team === 'home') {
    // A dribbler is judged all the way; a receiver only once the ball has arrived.
    const times = step.ball?.type === 'dribble' ? [0.25, 0.5, 0.75, 1] : [1];
    for (const tt of times) {
      const fr = tt === 1 ? { positions: after.positions } : frameAtStep(t, states, i, tt);
      const c = fr.positions[carrierId];
      if (!c) continue;
      // Pressing range: anyone this close is engaging the carrier, not covering a lane.
      const pressRange = pressGap(t.format) + 1.2;
      const close = opp.filter((o) => fr.positions[o.id] && dist(fr.positions[o.id], c) < pressRange);
      if (close.length >= 2) {
        findings.push({
          id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: [carrierId, ...close.map((o) => o.id)],
          title: `Two opponents close down ${playerLabel(playerById(t, carrierId)!)} at once`,
          detail: `${close.map((o) => playerLabel(o)).join(' and ')} both converge on the ball carrier. Real teams press with one and use the others to cover passing lanes.`,
          fix,
        });
        break;
      }
    }
  }

  // Two opponents crowding the same attacker: unrealistic (it leaves someone else free)
  // and it makes a move look impossible when a real team would never defend that way.
  const homeAfter = teammatesOf(t, 'home').filter((h) => h.line !== 'GK' && after.positions[h.id]);
  for (const h of homeAfter) {
    const close = opp.filter((o) => dist(after.positions[o.id], after.positions[h.id]) < Math.max(2.2 * Math.max(1, s), discRadius(p) * 2.2));
    if (close.length >= 2 && after.ballOwner !== h.id) {
      findings.push({
        id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: [h.id, ...close.map((o) => o.id)],
        title: `Two opponents crowd ${playerLabel(h)}`,
        detail: `${close.map((o) => playerLabel(o)).join(' and ')} are both on top of the same player, which leaves space elsewhere. Real defences press with one and cover lanes with the rest.`,
        fix,
      });
      break;
    }
  }
  if (a?.type === 'shot') return; // the ball ends in the net; pressure on the shooter is judged by xG / blockers
  // Nobody closes down the ball even though someone could have.
  const ball = after.ball;
  const gapNow = Math.min(...opp.map((o) => dist(after.positions[o.id], ball)));
  const couldPress = opp.filter((o) => dist(before.positions[o.id], ball) - PRESS_SPEED * D * 0.6 < 4 * s + 1.5);
  const pressed = couldPress.some((o) => dist(before.positions[o.id], ball) - dist(after.positions[o.id], ball) > Math.min(2, 0.3 * dist(before.positions[o.id], ball)));
  if (D >= 0.8 && gapNow > 4 * s + 1.5 && couldPress.length && !pressed) {
    const nearest = couldPress.sort((x, y) => dist(before.positions[x.id], ball) - dist(before.positions[y.id], ball))[0];
    findings.push({
      id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: [nearest.id],
      title: 'Nobody presses the ball',
      detail: `${playerLabel(nearest)} could close down the ball in ${D}s but doesn't. A real opponent would; make them react to see if the move still works.`,
      fix,
    });
  }

  // Opponents near the ball standing still while play moves around them.
  const ballMove = dist(before.ball, after.ball);
  if (D >= 1 && ballMove > 4 * s) {
    const homeEnd = teammatesOf(t, 'home').map((h) => after.positions[h.id]).filter(Boolean);
    const frozen = opp.filter(
      (o) =>
        moved(o.id) < 0.6 &&
        Math.min(dist(before.positions[o.id], before.ball), dist(before.positions[o.id], ball)) < 20 * s &&
        // Holding position tight to an attacker is marking, not standing still.
        !homeEnd.some((h) => dist(h, after.positions[o.id]) < 3 * s + 1),
    );
    if (frozen.length >= 2) {
      findings.push({
        id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: frozen.map((o) => o.id),
        title: `${frozen.length} opponents stand still`,
        detail: `${frozen.map((o) => playerLabel(o)).join(', ')} don't react while the ball moves ${Math.round(ballMove)} m near them. Opponents shift, press and track runners.`,
        fix,
      });
    }
  }
}

/** Distance opponents must keep at a restart (m). */
function restartDistance(format: number): number {
  if (format <= 5) return 5; // futsal kick-ins, corners and free kicks
  if (format >= 10) return 9.15;
  return 6.4; // common small-sided rule (7 yards)
}

/** Setup sanity: nobody starts on top of anyone, and set pieces respect the Laws. */
function checkSetup(t: Tactic, findings: Finding[]) {
  const p = pitchFor(t.format);
  const r = discRadius(p);
  const players = activePlayers(t).filter((pl) => t.initial[pl.id]);
  outer: for (let a = 0; a < players.length; a++) {
    for (let b = a + 1; b < players.length; b++) {
      const pa = t.initial[players[a].id];
      const pb = t.initial[players[b].id];
      if (dist(pa, pb) < r * 1.6) {
        findings.push({
          id: fid(), severity: 'warning', category: 'setup', stepIndex: -1, players: [players[a].id, players[b].id],
          title: `${playerLabel(players[a])} and ${playerLabel(players[b])} start on top of each other`,
          detail: 'Give every player their own space in the Setup frame; markers stand a metre or two goal-side.',
        });
        break outer;
      }
    }
  }
  if (t.phase !== 'set-piece' || !t.showOpponents) return;
  const owner = playerById(t, t.ballOwner);
  const ball = owner ? t.initial[owner.id] : t.ballStart;
  if (!owner || !ball) return;
  const centre = { x: p.length / 2, y: p.width / 2 };
  const kickOff = dist(ball, centre) < 1.5;
  for (const o of t.players.filter((pl) => pl.team !== owner.team && t.initial[pl.id])) {
    const pos = t.initial[o.id];
    if (kickOff) {
      const ownHalf = o.team === 'home' ? pos.x <= p.length / 2 + 0.3 : pos.x >= p.length / 2 - 0.3;
      if (!ownHalf || dist(pos, centre) < p.centreRadius) {
        findings.push({
          id: fid(), severity: 'error', category: 'rules', stepIndex: -1, players: [o.id],
          title: `${playerLabel(o)} is too close at the kick-off`,
          detail: 'At a kick-off opponents must be in their own half and outside the centre circle.',
        });
        return;
      }
    } else if (dist(pos, ball) < restartDistance(t.format) - 0.2) {
      findings.push({
        id: fid(), severity: 'error', category: 'rules', stepIndex: -1, players: [o.id],
        title: `${playerLabel(o)} is closer than ${restartDistance(t.format)} m to the restart`,
        detail: `Opponents must be at least ${restartDistance(t.format)} m from the ball when a set piece is taken.`,
      });
      return;
    }
  }
}

/**
 * Does the team in possession move with the play? Team-mates rooted to the spot
 * while the ball goes forward leave the attack short of support and the rest
 * defence miles behind it.
 */
function checkTeamSupport(t: Tactic, step: Step, i: number, states: BoardState[], findings: Finding[]) {
  const p = pitchFor(t.format);
  const before = states[i];
  const after = states[i + 1];
  const gain = progress('home', after.ball, p) - progress('home', before.ball, p);
  if (gain < 0.1 || step.duration < 1) return;
  const ballProg = progress('home', after.ball, p);
  const involved = new Set([step.ball?.from, step.ball?.to, before.ballOwner, after.ballOwner].filter(Boolean) as string[]);
  const stuck = teammatesOf(t, 'home').filter((pl) => {
    if (pl.line === 'GK' || involved.has(pl.id)) return false;
    const path = step.moves[pl.id];
    const moved = path?.length ? pathLength(playerPath(step, pl.id, before.positions[pl.id])) : 0;
    const prog = progress('home', before.positions[pl.id], p);
    // Already holding the rest-defence height: that's where they should be.
    if (prog >= maxBackLine(t.format) - 0.04) return false;
    return moved < 0.5 && ballProg - prog > 0.3;
  });
  if (stuck.length >= 3) {
    findings.push({
      id: fid(), severity: 'warning', category: 'realism', stepIndex: i, players: stuck.map((pl) => pl.id),
      title: 'Team-mates stand still while the ball goes forward',
      detail: `${stuck.slice(0, 4).map((pl) => playerLabel(pl)).join(', ')}${stuck.length > 4 ? ' and others' : ''} don't move as the ball advances ${Math.round(gain * p.length)} m. The team should push up behind the ball and support the attack.`,
      fix: { kind: 'support-shape', stepIndex: i },
    });
  }
}

function checkMovement(
  t: Tactic, step: Step, i: number, before: BoardState, findings: Finding[], p: ReturnType<typeof pitchFor>,
) {
  for (const [id, moves] of Object.entries(step.moves)) {
    const pl = playerById(t, id);
    const start = before.positions[id];
    if (!pl || !start || !moves.length) continue;
    if (pl.team === 'away' && !t.showOpponents) continue;
    const len = pathLength(playerPath(step, id, start));
    const speed = len / Math.max(0.1, step.duration);
    const needed = Math.ceil((len / HARD_SPRINT) * 10) / 10;
    // With the ball at their feet nobody runs at full sprint speed.
    if (step.ball?.type === 'dribble' && step.ball.from === id && speed > MAX_DRIBBLE && speed <= MAX_SPRINT) {
      findings.push({
        id: fid(), severity: 'warning', category: 'movement', stepIndex: i, players: [id],
        title: `${playerLabel(pl)} dribbles at ${speed.toFixed(1)} m/s`,
        detail: `That is faster than anyone can run with the ball (about ${MAX_DRIBBLE} m/s). Shorten the carry or give the step more time.`,
        fix: { kind: 'extend-duration', stepIndex: i, duration: Math.ceil((len / (MAX_DRIBBLE - 0.5)) * 10) / 10 },
      });
    }
    if (speed > MAX_SPRINT) {
      findings.push({
        id: fid(), severity: 'error', category: 'movement', stepIndex: i, players: [id],
        title: `${playerLabel(pl)} would need ${speed.toFixed(1)} m/s`,
        detail: `Covering ${len.toFixed(0)} m in ${step.duration}s is faster than any footballer can run. Shorten the run or give the step at least ${needed}s.`,
        fix: { kind: 'extend-duration', stepIndex: i, duration: needed },
      });
    } else if (speed > HARD_SPRINT) {
      findings.push({
        id: fid(), severity: 'warning', category: 'movement', stepIndex: i, players: [id],
        title: `${playerLabel(pl)} is flat-out sprinting`,
        detail: `${speed.toFixed(1)} m/s over ${len.toFixed(0)} m is possible but hard to repeat. Consider a longer step.`,
        fix: { kind: 'extend-duration', stepIndex: i, duration: needed },
      });
    }
    if (pl.line === 'GK') {
      const end = moves[moves.length - 1];
      const own = ownGoal(pl.team, p);
      if (Math.abs(end.x - own.x) > p.length * 0.3) {
        findings.push({
          id: fid(), severity: 'warning', category: 'shape', stepIndex: i, players: [id],
          title: 'Goalkeeper far from goal',
          detail: 'The keeper ends the step a long way from goal; a long-range shot or a turnover would leave the net empty.',
        });
      }
    }
  }
}

function checkBallAction(
  t: Tactic, step: Step, i: number, states: BoardState[], findings: Finding[], m: StepMetrics,
) {
  const a = step.ball!;
  const before = states[i];
  const after = states[i + 1];
  const from = playerById(t, a.from);
  if (!from) return;
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  if (before.ballOwner !== a.from) {
    const holder = playerById(t, before.ballOwner);
    findings.push({
      id: fid(), severity: 'error', category: 'passing', stepIndex: i, players: [a.from],
      title: `${playerLabel(from)} doesn't have the ball`,
      detail: holder
        ? `At the start of step ${i + 1} the ball is with ${playerLabel(holder)}.`
        : `At the start of step ${i + 1} the ball is loose. Move a player onto it first.`,
    });
    return;
  }
  const release = Math.min(Math.max(a.releaseAt, 0), 0.95);
  const atRelease = frameAtStep(t, states, i, release);
  const origin = atRelease.positions[a.from];
  const opponents = opponentsOf(t, from.team);

  // Findings are written from the home team's (the user's) point of view:
  // an opponent's pass being cut out is good news, not an error.
  const mine = from.team === 'home';
  const opp = mine ? t.awayName : t.homeName;

  if (a.type === 'shot') {
    const xg = shotXg(t, from.team, origin, atRelease.positions, a.target);
    m.xg = xg;
    const pct = Math.round(xg * 100);
    if (!mine) {
      findings.push({
        id: fid(), severity: xg >= 0.2 ? 'warning' : xg < 0.05 ? 'good' : 'info', category: 'defending', stepIndex: i, players: [a.from],
        title: xg >= 0.2 ? `${opp} get a big chance (xG ${xg.toFixed(2)})` : xg < 0.05 ? `${opp} forced into a poor shot` : `${opp} shot, xG ${xg.toFixed(2)}`,
        detail: `A shot from there scores roughly ${pct}% of the time.`,
      });
      return;
    }
    if (xg < 0.05) {
      findings.push({
        id: fid(), severity: 'warning', category: 'finishing', stepIndex: i, players: [a.from],
        title: `Low-quality shot (xG ${xg.toFixed(2)})`,
        detail: `From here a shot scores roughly ${pct}% of the time. Work the ball closer or more central before shooting.`,
      });
    } else if (xg >= 0.2) {
      findings.push({
        id: fid(), severity: 'good', category: 'finishing', stepIndex: i, players: [a.from],
        title: `High-quality chance (xG ${xg.toFixed(2)})`,
        detail: `A shot from this position scores roughly ${pct}% of the time.`,
      });
    } else {
      findings.push({
        id: fid(), severity: 'info', category: 'finishing', stepIndex: i, players: [a.from],
        title: `Shot quality xG ${xg.toFixed(2)}`,
        detail: `A reasonable chance: roughly ${pct}% of shots from here are scored.`,
      });
    }
    return;
  }
  if (a.type === 'dribble') {
    // Check the whole carry, not just where it ends: running through a defender is a lost duel.
    const press = [0.25, 0.5, 0.75, 1].some((tt) => {
      const fr = tt === 1 ? { positions: after.positions } : frameAtStep(t, states, i, tt);
      const c = fr.positions[a.from];
      return opponents.some((o) => fr.positions[o.id] && dist(fr.positions[o.id], c) < (tt === 1 ? 1.5 : 1.1));
    });
    if (press) {
      findings.push({
        id: fid(), severity: mine ? 'warning' : 'good', category: mine ? 'passing' : 'defending', stepIndex: i, players: [a.from],
        title: mine ? `${playerLabel(from)} dribbles into a defender` : `The carrier runs into a ${t.homeName} defender`,
        detail: mine ? 'The carry ends on top of an opponent: expect a duel the attacker may lose.' : 'Good: the dribble is met by a defender.',
      });
    }
    return;
  }

  const receiver = playerById(t, a.to);
  /** A pass aimed at an opposing player is an interception / turnover by design. */
  const turnover = !!receiver && receiver.team !== from.team;
  const fl = ballFlight(t, step, before, after)!;
  const dest: Vec = fl.dest;
  const length = dist(origin, dest);
  m.passDistance = length;
  const flight = (fl.arrive - fl.release) * Math.max(0.1, step.duration);
  const speed = length / flight;
  const arrival = frameAtStep(t, states, i, fl.arrive);
  if (speed > MAX_PASS_SPEED) {
    findings.push({
      id: fid(), severity: 'warning', category: 'passing', stepIndex: i, players: [a.from],
      title: `Pass travels at ${speed.toFixed(0)} m/s`,
      detail: 'That is faster than a driven pass. Release the ball earlier or give the step more time.',
      fix: { kind: 'set-release', stepIndex: i, releaseAt: Math.max(0, 1 - length / (24 * Math.max(0.1, step.duration))) },
    });
  }

  if (turnover) {
    findings.push({
      id: fid(), severity: mine ? 'error' : 'good', category: mine ? 'passing' : 'defending', stepIndex: i, players: [a.from, receiver!.id],
      title: mine ? `Pass goes straight to ${playerLabel(receiver!)}` : `${playerLabel(receiver!)} intercepts`,
      detail: mine ? 'This pass is aimed at an opponent.' : `${t.homeName} read the pass and win the ball.`,
    });
    return;
  }

  // Interception: sample the ball's flight against the animated opponents.
  const lofted = a.type === 'cross' || a.type === 'clearance';
  let closest = Infinity;
  let interceptor: Player | undefined;
  if (opponents.length && a.type !== 'clearance') {
    for (let k = 1; k <= 10; k++) {
      const u = k / 10;
      if (lofted && u < 0.85) continue;
      const tt = fl.release + u * (fl.arrive - fl.release);
      const fr = frameAtStep(t, states, i, tt);
      const ballPt = lerp(origin, dest, u);
      for (const o of opponents) {
        const op = fr.positions[o.id];
        if (!op) continue;
        const d = dist(op, ballPt);
        if (d < closest) {
          closest = d;
          interceptor = o;
        }
      }
    }
    m.passClearance = closest;
  }
  const alt = () => {
    const opts = passOptions(t, atRelease.positions, a.from).filter((o) => o.to !== a.to && !o.offside);
    return opts[0] && opts[0].clearance > 3 * s ? opts[0] : undefined;
  };
  const what = a.type === 'cross' ? 'Cross' : 'Pass';
  const toLabel = receiver ? playerLabel(receiver) : 'space';
  const gain = Math.round((progress(from.team, dest, p) - progress(from.team, origin, p)) * p.length);
  if (interceptor && closest < REACT) {
    if (mine) {
      const best = alt();
      findings.push({
        id: fid(), severity: 'error', category: 'passing', stepIndex: i, players: [a.from, interceptor.id],
        title: `${what} to ${toLabel} gets intercepted`,
        detail: `${playerLabel(interceptor)} (${teamName(t, interceptor.team)}) is within ${closest.toFixed(1)} m of the ball's path.` +
          (best ? ` ${playerLabel(playerById(t, best.to)!)} is a safer option.` : ' Move the receiver into a clearer lane.'),
        fix: best ? { kind: 'reroute-pass', stepIndex: i, to: best.to } : undefined,
      });
    } else {
      findings.push({
        id: fid(), severity: 'good', category: 'defending', stepIndex: i, players: [interceptor.id],
        title: `${playerLabel(interceptor)} can cut out the pass`,
        detail: `${playerLabel(interceptor)} gets within ${closest.toFixed(1)} m of the ball: the lane is covered. Make the interception the next action.`,
      });
    }
  } else if (interceptor && closest < 3 * s) {
    findings.push({
      id: fid(), severity: mine ? 'warning' : 'info', category: mine ? 'passing' : 'defending', stepIndex: i, players: [a.from, interceptor.id],
      title: mine ? `Risky ${what.toLowerCase()} lane to ${toLabel}` : `${opp}'s passing lane is well screened`,
      detail: `${playerLabel(interceptor)} gets within ${closest.toFixed(1)} m of the ball.` + (mine ? ' It needs perfect weight.' : ''),
    });
  } else if (opponents.length && receiver && a.type === 'pass' && length > 12 * s && gain > 0.15 * p.length) {
    findings.push({
      id: fid(), severity: mine ? 'good' : 'warning', category: mine ? 'passing' : 'defending', stepIndex: i, players: [a.from, receiver.id],
      title: mine ? `Line-breaking pass to ${playerLabel(receiver)}` : `${opp} play straight through your lines`,
      detail: mine ? `Gains ${gain} m through a clear lane.` : `A ${gain} m forward pass goes through unchallenged. Screen the central lane.`,
    });
  }

  if (receiver && opponents.length) {
    const pressure = Math.min(...opponents.map((o) => arrival.positions[o.id]).filter(Boolean).map((o) => dist(o, dest)));
    // A first-time lay-off is the right answer to pressure, not a risk.
    const next = t.steps[i + 1];
    const layOff = !!next?.ball && next.ball.from === receiver.id && next.ball.type !== 'dribble' && next.ball.releaseAt <= 0.15;
    if (pressure < 1.8 * Math.max(1, s) && layOff && mine) {
      findings.push({
        id: fid(), severity: 'info', category: 'passing', stepIndex: i, players: [receiver.id],
        title: `${playerLabel(receiver)} plays first time under pressure`,
        detail: `An opponent is ${pressure.toFixed(1)} m away on arrival, so the first-time pass in the next step is the right choice.`,
      });
    } else if (pressure < 1.8 * Math.max(1, s)) {
      findings.push({
        id: fid(), severity: mine ? 'warning' : 'good', category: mine ? 'passing' : 'defending', stepIndex: i, players: [receiver.id],
        title: mine ? `${playerLabel(receiver)} receives under pressure` : `${opp}'s receiver is pressed immediately`,
        detail: mine
          ? `An opponent is ${pressure.toFixed(1)} m away on arrival. They'll need a first touch away from pressure or a quick lay-off.`
          : `A ${t.homeName} player is ${pressure.toFixed(1)} m away as the ball arrives.`,
      });
    }
  }

  if (receiver && (a.type === 'pass' || a.type === 'cross')) {
    const receiverAtRelease = atRelease.positions[receiver.id];
    if (isOffside(t, from.team, atRelease.positions, origin, receiverAtRelease)) {
      const best = mine ? alt() : undefined;
      findings.push({
        id: fid(), severity: mine ? 'error' : 'good', category: 'rules', stepIndex: i, players: [receiver.id],
        title: mine ? `${playerLabel(receiver)} is offside` : `${opp}'s receiver is caught offside`,
        detail: mine
          ? 'When the ball is played the receiver is beyond the second-last defender. Delay the run or release the ball earlier.'
          : 'Your defensive line steps up in time.',
        fix: !mine ? undefined : best ? { kind: 'reroute-pass', stepIndex: i, to: best.to } : { kind: 'set-release', stepIndex: i, releaseAt: Math.max(0, release - 0.2) },
      });
    }
  }
  if (mine && !receiver && a.type === 'pass') {
    const runner = teammatesOf(t, from.team).find((pl) => pl.id !== a.from && dist(after.positions[pl.id], dest) < 1.6);
    if (!runner) {
      findings.push({
        id: fid(), severity: 'warning', category: 'passing', stepIndex: i, players: [a.from],
        title: 'Pass into space with no runner',
        detail: 'No teammate arrives where the ball is played. Add a run onto the ball.',
      });
    }
  }
}

function checkAttackingShape(
  t: Tactic, i: number, side: TeamSide, attackers: Player[], after: BoardState, findings: Finding[],
) {
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const sh = shape(attackers, after.positions);
  const n = outfield(attackers).length;
  const ballDeep = progress(side, after.ball, p) > 0.8;
  if (n >= 3 && !ballDeep && sh.width < p.width * 0.4) {
    findings.push({
      id: fid(), severity: 'warning', category: 'shape', stepIndex: i, players: [],
      title: `${teamName(t, side)} is too narrow`,
      detail: `Width is only ${sh.width.toFixed(0)} m of ${p.width} m. Keep someone high and wide on each side to stretch the defence.`,
    });
  } else if (n >= 3 && sh.width > p.width * 0.75) {
    findings.push({
      id: fid(), severity: 'good', category: 'shape', stepIndex: i, players: [],
      title: 'Good width in possession',
      detail: `The team spans ${sh.width.toFixed(0)} m, which stretches the opposition horizontally.`,
    });
  }
  if (n >= 3 && sh.depth < p.length * 0.18) {
    findings.push({
      id: fid(), severity: 'warning', category: 'shape', stepIndex: i, players: [],
      title: `${teamName(t, side)} is flat`,
      detail: 'Players are strung across one line. Stagger them to create passing angles and depth.',
    });
  }
  // Crowding.
  const out = outfield(attackers);
  const reported = new Set<string>();
  for (let a = 0; a < out.length; a++) {
    for (let b = a + 1; b < out.length; b++) {
      const pa = after.positions[out[a].id];
      const pb = after.positions[out[b].id];
      if (pa && pb && dist(pa, pb) < Math.max(2, 3.5 * s) && !reported.has(out[a].id) && !reported.has(out[b].id)) {
        reported.add(out[a].id);
        reported.add(out[b].id);
        findings.push({
          id: fid(), severity: 'warning', category: 'shape', stepIndex: i, players: [out[a].id, out[b].id],
          title: `${playerLabel(out[a])} and ${playerLabel(out[b])} are on top of each other`,
          detail: 'Two attackers in the same space let one defender mark both. Spread them out.',
        });
      }
    }
  }
  // Rest defence when attacking in the opponent's half.
  const ball = after.ball;
  if (t.format >= 7 && progress(side, ball, p) > 0.55) {
    const behind = out.filter((pl) => progress(side, after.positions[pl.id], p) < progress(side, ball, p) - 0.1).length;
    const need = t.format >= 9 ? 3 : 2;
    if (behind < need) {
      findings.push({
        id: fid(), severity: 'warning', category: 'defending', stepIndex: i, players: [],
        title: 'Weak rest defence',
        detail: `Only ${behind} outfield player${behind === 1 ? '' : 's'} stay behind the ball. A turnover now leaves you open to a counter-attack; keep at least ${need}.`,
      });
    }
  }
  // Passing options for whoever has the ball at the end.
  if (
    after.ballOwner && playerById(t, after.ballOwner)?.team === side && t.showOpponents &&
    !inPenaltyArea(side, after.ball, p)
  ) {
    const opts = passOptions(t, after.positions, after.ballOwner).filter((o) => o.clearance > 2.5 * s && !o.offside);
    if (opts.length === 0) {
      findings.push({
        id: fid(), severity: 'warning', category: 'passing', stepIndex: i, players: [after.ballOwner],
        title: 'Ball carrier has no safe pass',
        detail: 'Every passing lane is covered at the end of this step. Add a supporting run to give the carrier an outlet.',
      });
    }
  }
}

function checkDefensiveShape(t: Tactic, i: number, attacking: TeamSide, after: BoardState, findings: Finding[]) {
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const defending: TeamSide = attacking === 'home' ? 'away' : 'home';
  const defenders = outfield(teammatesOf(t, defending));
  const attackers = outfield(teammatesOf(t, attacking));
  const ball = after.ball;
  const ballProg = progress(defending, ball, p);
  const goalSide = defenders.filter((d) => progress(defending, after.positions[d.id], p) < ballProg).length;
  const need = Math.ceil(defenders.length / 2);
  if (defenders.length >= 2 && ballProg > 0.3 && goalSide < need) {
    findings.push({
      id: fid(), severity: attacking === 'home' ? 'good' : 'warning', category: 'defending', stepIndex: i, players: [],
      title: attacking === 'home'
        ? `${t.awayName} caught with only ${goalSide} behind the ball`
        : `Only ${goalSide} ${t.homeName} players behind the ball`,
      detail: attacking === 'home'
        ? 'The opposition is out of shape: this is the moment to attack quickly.'
        : `Get at least ${need} players goal-side to protect the goal.`,
    });
  }
  // Unmarked attackers in the danger zone.
  const goal = attackingGoal(attacking, p);
  for (const att of attackers) {
    const pos = after.positions[att.id];
    if (!pos) continue;
    const danger = inPenaltyArea(attacking, pos, p) || dist(pos, goal) < 20 * s;
    if (!danger) continue;
    const marker = Math.min(...defenders.map((d) => dist(after.positions[d.id], pos)));
    if (marker > Math.max(3, 4 * s)) {
      const homeAttacking = attacking === 'home';
      findings.push({
        id: fid(), severity: homeAttacking ? 'good' : 'warning', category: 'defending', stepIndex: i, players: [att.id],
        title: homeAttacking ? `${playerLabel(att)} is free in a dangerous area` : `${playerLabel(att)} unmarked near your goal`,
        detail: homeAttacking
          ? `Nearest defender is ${marker.toFixed(0)} m away: find them.`
          : `Nearest ${t.homeName} defender is ${marker.toFixed(0)} m away. Someone must pick them up.`,
      });
    }
  }
  const sh = shape(defenders, after.positions);
  if (defenders.length >= 4 && sh.depth > p.length * 0.45) {
    findings.push({
      id: fid(), severity: attacking === 'home' ? 'info' : 'warning', category: 'defending', stepIndex: i, players: [],
      title: `${teamName(t, defending)} block is stretched`,
      detail: `${sh.depth.toFixed(0)} m between the deepest and highest outfield defender leaves gaps between the lines.`,
    });
  }
}

function checkOutcome(
  t: Tactic, step: Step, i: number, before: BoardState, after: BoardState,
  possession: TeamSide | undefined, findings: Finding[], m: StepMetrics,
) {
  const p = pitchFor(t.format);
  const afterTeam = playerById(t, after.ballOwner)?.team;
  const goal = possession ? attackingGoal(possession, p) : undefined;
  const fail = (title: string, detail: string) =>
    findings.push({ id: fid(), severity: 'warning', category: 'outcome', stepIndex: i, players: [], title, detail });
  const ok = (title: string, detail: string) =>
    findings.push({ id: fid(), severity: 'good', category: 'outcome', stepIndex: i, players: [], title, detail });

  if (possession === 'home' && afterTeam === 'away') {
    findings.push({
      id: fid(), severity: 'error', category: 'outcome', stepIndex: i, players: [],
      title: 'Possession is lost',
      detail: `By the end of step ${i + 1} the ball has gone to ${t.awayName}.`,
    });
  } else if (possession === 'away' && afterTeam === 'home' && step.expectedOutcome !== 'regain') {
    findings.push({
      id: fid(), severity: 'good', category: 'outcome', stepIndex: i, players: [],
      title: `${t.homeName} win the ball`,
      detail: `By the end of step ${i + 1} ${t.homeName} have regained possession.`,
    });
  }

  switch (step.expectedOutcome) {
    case 'retain':
      if (possession && afterTeam === possession) ok('Possession kept', 'The intended outcome (keep the ball) is achieved.');
      else if (!afterTeam) fail('Possession not secured', 'The ball is loose at the end of the step.');
      break;
    case 'progress': {
      if (!possession) break;
      const gain = progress(possession, after.ball, p) - progress(possession, before.ball, p);
      if (gain >= 0.08) ok('Ball progressed', `The ball moves ${Math.round(gain * p.length)} m up the pitch.`);
      else fail('Little progression', `The ball only moves ${Math.round(gain * p.length)} m forward; the target was to progress.`);
      break;
    }
    case 'switch':
      if (Math.abs(after.ball.y - before.ball.y) >= p.width * 0.45) ok('Play switched', 'The ball changes flank, stretching the defence.');
      else fail('Play not switched', 'The ball stays on the same side; a switch should cross most of the width.');
      break;
    case 'chance':
    case 'goal': {
      if (!possession || !goal) break;
      const shot = step.ball?.type === 'shot';
      const xg = m.xg ?? 0;
      if (step.expectedOutcome === 'goal') {
        if (!shot) fail('No shot taken', 'The target is a goal but nobody shoots in this step.');
        else if (xg < 0.15) fail('Goal unlikely', `The finish has an xG of ${xg.toFixed(2)}; improve the shooting position.`);
        else ok('Good finishing position', `xG ${xg.toFixed(2)} for the final shot.`);
      } else {
        const inBox = after.ballOwner && afterTeam === possession && inPenaltyArea(possession, after.ball, p);
        if (shot ? xg >= 0.1 : inBox) ok('Chance created', shot ? `Shot with xG ${xg.toFixed(2)}.` : 'The ball reaches a teammate in the box.');
        else fail('No real chance created', 'Get the ball to a teammate in the box or take a good-quality shot.');
      }
      break;
    }
    case 'regain': {
      const defending = possession === 'home' ? 'away' : 'home';
      if (afterTeam === defending || (!possession && afterTeam)) ok('Ball won back', 'The pressing action regains possession.');
      else fail('Ball not regained', 'The opponent still has the ball at the end of the step.');
      break;
    }
    case 'clear': {
      if (!possession) break;
      const own = attackingGoal(possession === 'home' ? 'away' : 'home', p);
      if (dist(after.ball, own) - dist(before.ball, own) >= p.length * 0.25) ok('Danger cleared', 'The ball is moved well away from goal.');
      else fail('Not cleared far enough', 'The ball is still close to your goal.');
      break;
    }
    default:
      break;
  }
}
