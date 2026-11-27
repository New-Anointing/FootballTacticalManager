import { attackingGoal, inPenaltyArea, insidePitch, ownGoal, pitchFor, progress } from '../model/pitch';
import { activePlayers, boardStates, playerById, playerLabel, type BoardState } from '../model/tactic';
import type { Player, Step, Tactic, TeamSide, Vec } from '../model/types';
import { frameAtStep, playerPath } from './animation';
import { dist, lerp, pathLength } from './geometry';
import { isOffside, opponentsOf, passOptions, scaleFor, shotXg, teammatesOf } from './options';

export type Severity = 'error' | 'warning' | 'info' | 'good';

export type Fix =
  | { kind: 'reroute-pass'; stepIndex: number; to: string }
  | { kind: 'extend-duration'; stepIndex: number; duration: number }
  | { kind: 'set-release'; stepIndex: number; releaseAt: number };

export interface Finding {
  id: string;
  severity: Severity;
  category: 'movement' | 'passing' | 'shape' | 'defending' | 'finishing' | 'outcome' | 'rules' | 'setup';
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
    const xg = shotXg(t, from.team, origin, atRelease.positions);
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
    const end = after.positions[a.from];
    const press = opponents
      .map((o) => after.positions[o.id])
      .filter(Boolean)
      .some((o) => dist(o, end) < 1.5);
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
  const dest: Vec = receiver ? after.positions[receiver.id] : a.target ?? after.ball;
  const length = dist(origin, dest);
  m.passDistance = length;
  const flight = (1 - release) * Math.max(0.1, step.duration);
  const speed = length / flight;
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
      const tt = release + u * (1 - release);
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
    const pressure = Math.min(...opponents.map((o) => after.positions[o.id]).filter(Boolean).map((o) => dist(o, dest)));
    if (pressure < 1.8 * Math.max(1, s)) {
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
