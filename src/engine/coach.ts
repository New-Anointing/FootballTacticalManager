import { FORMATIONS, lineCounts } from '../model/formations';
import { attackingGoal, inPenaltyArea, pitchFor, progress } from '../model/pitch';
import { boardStates, playerById, playerLabel, uid } from '../model/tactic';
import type { Step, Tactic, TeamSide, Vec } from '../model/types';
import { analyseTactic, type AnalysisReport, type Finding } from './analysis';
import { clamp, dist, lerp } from './geometry';
import { isOffside, laneClearance, opponentsOf, passOptions, scaleFor, shotXg, teammatesOf } from './options';

// ---------------------------------------------------------------------------
// Formation advice
// ---------------------------------------------------------------------------

export interface FormationSuggestion {
  formation: string;
  score: number;
  reasons: string[];
}

/** Rank formations for a format against an opponent's formation. */
export function suggestFormations(format: number, opponent: string, goal: 'balanced' | 'attack' | 'defend' = 'balanced'): FormationSuggestion[] {
  const opp = lineCounts(opponent);
  return (FORMATIONS[format] ?? []).map((f) => {
    const me = lineCounts(f);
    const reasons: string[] = [];
    let score = 0;
    const midDiff = me.mid - opp.mid;
    if (midDiff > 0) {
      score += 2 * midDiff;
      reasons.push(`+${midDiff} in midfield: easier to keep the ball and press centrally`);
    } else if (midDiff < 0) {
      score += 1.5 * midDiff;
      reasons.push(`${midDiff} in midfield: you may be overrun centrally`);
    }
    const cover = me.def - opp.fwd;
    if (cover >= 1) {
      score += goal === 'defend' ? 2 : 1;
      reasons.push(`Spare defender against their ${opp.fwd} forward${opp.fwd === 1 ? '' : 's'}`);
    } else {
      score -= goal === 'defend' ? 3 : 2;
      reasons.push(`No spare defender against their ${opp.fwd} forward${opp.fwd === 1 ? '' : 's'}: 1v1s at the back`);
    }
    const threat = me.fwd - Math.max(0, opp.def - 1);
    if (threat >= 0) {
      score += goal === 'attack' ? 2 : 1;
      reasons.push('Enough forwards to occupy their back line');
    } else if (goal === 'attack') score -= 1;
    const width = me.def >= 4 || me.mid >= 4 || me.fwd >= 3;
    if (width && format >= 7) {
      score += 0.5;
      reasons.push('Natural width from wide players');
    }
    if (goal === 'attack') score += me.fwd * 0.5;
    if (goal === 'defend') score += me.def * 0.5;
    return { formation: f, score: Math.round(score * 10) / 10, reasons };
  }).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Coaching tips from an analysis report
// ---------------------------------------------------------------------------

export interface CoachTip {
  title: string;
  body: string;
  stepIndex: number;
  findingId?: string;
}

const TIP_LIBRARY: Partial<Record<Finding['category'], string>> = {
  movement: 'Runs should be realistic: around 6-7 m/s for a hard run, and recovery runs take time. Lengthen steps rather than teleporting players.',
  passing: 'A pass is only as good as its lane. Check the defender positions *while the ball travels*, not just at the start.',
  shape: 'In possession, make the pitch big: one player high and wide on each flank, staggered lines, and no two players in the same zone.',
  defending: 'Out of possession, stay compact and goal-side. When attacking, keep enough players behind the ball to stop a counter.',
  finishing: 'Shots from central positions inside the box are worth several times more than shots from distance or tight angles.',
  rules: 'Time the run so the receiver is level with the last defender when the ball is played, then accelerate.',
  outcome: 'Set an expected outcome for each step so the analysis can check whether the move actually achieves it.',
};

export function tipsFromReport(report: AnalysisReport): CoachTip[] {
  const tips: CoachTip[] = [];
  const seen = new Set<string>();
  for (const f of report.findings) {
    if (f.severity !== 'error' && f.severity !== 'warning') continue;
    tips.push({ title: f.title, body: f.detail, stepIndex: f.stepIndex, findingId: f.id });
    if (!seen.has(f.category) && TIP_LIBRARY[f.category]) {
      seen.add(f.category);
      tips.push({ title: `Principle: ${f.category}`, body: TIP_LIBRARY[f.category]!, stepIndex: -1 });
    }
    if (tips.length >= 10) break;
  }
  if (tips.length === 0) {
    tips.push({
      title: 'Looking good',
      body: report.findings.length
        ? 'No problems found. Try the move against a different opposition formation to stress-test it.'
        : 'Add some steps and the coach will review them.',
      stepIndex: -1,
    });
  }
  return tips;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

function clampToPitch(v: Vec, t: Tactic): Vec {
  const p = pitchFor(t.format);
  return { x: clamp(v.x, 1, p.length - 1), y: clamp(v.y, 1, p.width - 1) };
}

/** Second-last opponent's up-pitch progress (offside line) from `side`'s point of view. */
function offsideLine(t: Tactic, side: TeamSide, positions: Record<string, Vec>): number {
  const p = pitchFor(t.format);
  const prog = opponentsOf(t, side)
    .map((o) => positions[o.id])
    .filter(Boolean)
    .map((pos) => progress(side, pos, p))
    .sort((a, b) => b - a);
  return prog.length >= 2 ? prog[1] : 0.98;
}

function fromProgress(side: TeamSide, prog: number, y: number, t: Tactic): Vec {
  const p = pitchFor(t.format);
  return { x: side === 'home' ? prog * p.length : (1 - prog) * p.length, y };
}

function durationFor(moves: Record<string, Vec[]>, positions: Record<string, Vec>, minimum = 1.5): number {
  let longest = 0;
  for (const [id, path] of Object.entries(moves)) {
    const start = positions[id];
    if (start && path.length) longest = Math.max(longest, dist(start, path[path.length - 1]));
  }
  return Math.max(minimum, Math.ceil((longest / 6) * 2) / 2);
}

/**
 * Opponents react like a real defensive block: the whole unit slides across and
 * up/down as one (keeping its spacing), and the nearest defender steps out to
 * press the ball from the goal side. Every run is limited to what a player can
 * cover in the time available (`maxDist`).
 */
function shiftBlock(
  t: Tactic, attacking: TeamSide, positions: Record<string, Vec>, ball: Vec, maxDist: number,
  /** The block's reference shape; shifts are measured from it so they don't accumulate. */
  base: Record<string, Vec> = positions,
): Record<string, Vec[]> {
  const moves: Record<string, Vec[]> = {};
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const defending: TeamSide = attacking === 'home' ? 'away' : 'home';
  const outfield = opponentsOf(t, attacking).filter((d) => d.line !== 'GK' && positions[d.id]);
  if (!outfield.length) return moves;
  const pts = outfield.map((d) => base[d.id] ?? positions[d.id]);
  const cy = pts.reduce((a, v) => a + v.y, 0) / pts.length;
  const ballProg = progress(defending, ball, p);
  const front = Math.max(...pts.map((v) => progress(defending, v, p)));
  const deepest = Math.min(...pts.map((v) => progress(defending, v, p)));
  // Front of the block level with the ball; never drop the back line into the six-yard box.
  let dProg = (ballProg + 0.02 - front) * 0.6;
  dProg = Math.max(dProg, 0.06 - deepest);
  const dx = (defending === 'home' ? 1 : -1) * dProg * p.length;
  const dy = (ball.y - cy) * 0.45;
  const presser = outfield.reduce((best, d) => (dist(positions[d.id], ball) < dist(positions[best.id], ball) ? d : best), outfield[0]);
  const own = attackingGoal(attacking, p); // the goal the defenders protect
  for (const d of outfield) {
    const pos = positions[d.id];
    let target: Vec;
    if (d.id === presser.id) {
      const gap = 2 * s;
      target = lerp(ball, own, Math.min(0.5, gap / Math.max(1, dist(ball, own))));
    } else {
      const anchor = base[d.id] ?? pos;
      target = { x: anchor.x + dx, y: anchor.y + dy };
    }
    target = clampToPitch(target, t);
    const d0 = dist(target, pos);
    if (d0 > maxDist) target = lerp(pos, target, maxDist / d0);
    if (dist(target, pos) > 0.8) moves[d.id] = [target];
  }
  return moves;
}

/** If the receiver would be offside when the ball is played, hold their run on the line. */
function holdOnside(t: Tactic, step: Step, positions: Record<string, Vec>) {
  if (!step.ball?.to) return;
  const after = { ...positions };
  for (const [id, path] of Object.entries(step.moves)) after[id] = path[path.length - 1];
  if (isOffside(t, 'home', after, positions[step.ball.from], after[step.ball.to])) {
    const fixed = fromProgress('home', offsideLine(t, 'home', after) - 0.01, after[step.ball.to].y, t);
    step.moves[step.ball.to] = [fixed];
  }
}

/** Would this step, appended after `planned`, produce any error in the analysis? */
function stepBreaks(t: Tactic, planned: Step[], step: Step): boolean {
  const trial: Tactic = { ...t, steps: [...t.steps, ...planned, step] };
  const index = trial.steps.length - 1;
  return analyseTactic(trial).findings.some((f) => f.severity === 'error' && f.stepIndex === index);
}

export interface GeneratedMove {
  steps: Step[];
  summary: string;
}

/**
 * Assistant coach: generate an attacking move from the end of the current tactic.
 * Greedy: each step the opposition block shifts towards the ball, teammates search
 * for the best reachable pocket of space (clear lane, away from markers, onside,
 * true to their role), then the carrier plays the best safe pass, carries into
 * space or recycles possession. The move ends with a shot once xG is good enough.
 */
export function generateAttack(t: Tactic, maxSteps = 10): GeneratedMove {
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const states = boardStates(t);
  const last = states[states.length - 1];
  let positions = { ...last.positions };
  let start = last.ballOwner && playerById(t, last.ballOwner)?.team === 'home' ? last.ballOwner : undefined;
  if (!start) {
    // Give the ball to the nearest home player.
    const home = teammatesOf(t, 'home');
    start = home.sort((a, b) => dist(positions[a.id], last.ball) - dist(positions[b.id], last.ball))[0]?.id;
  }
  if (!start) return { steps: [], summary: 'No players available.' };
  if (last.ballOwner && playerById(t, last.ballOwner)?.team === 'away') {
    return { steps: [], summary: `${t.awayName} have the ball. Use "Generate press" to win it back first.` };
  }
  let carrier: string = start;
  let prevCarrier: string | undefined;
  let bestProg = progress('home', positions[start], p);
  const blockBase = { ...last.positions };
  let stall = 0;

  const steps: Step[] = [];
  const goal = attackingGoal('home', p);
  const lines: string[] = [];
  if (last.ballOwner !== carrier) {
    // Loose ball: the nearest player collects it first.
    steps.push({
      id: uid('step'), duration: durationFor({ [carrier]: [last.ball] }, positions), expectedOutcome: 'retain',
      moves: { [carrier]: [last.ball] }, note: `${playerLabel(playerById(t, carrier)!)} collects the loose ball.`,
    });
    positions = { ...positions, [carrier]: { ...last.ball } };
  }

  for (let n = 0; n < maxSteps; n++) {
    const carrierPos = positions[carrier];
    const carrierPl = playerById(t, carrier)!;
    const xg = shotXg(t, 'home', carrierPos, positions);
    const lastChance = n === maxSteps - 1 && progress('home', carrierPos, p) > 0.7 && xg >= 0.03;
    if (xg >= 0.1 || (inPenaltyArea('home', carrierPos, p) && xg >= 0.06) || lastChance) {
      steps.push({
        id: uid('step'), duration: 1.5, expectedOutcome: 'goal', moves: {},
        note: `${playerLabel(carrierPl)} shoots (xG ${xg.toFixed(2)}).`,
        ball: { type: 'shot', from: carrier, target: { x: goal.x, y: goal.y + (carrierPos.y < goal.y ? 1 : -1) * p.goalWidth * 0.3 }, releaseAt: 0.2 },
      });
      lines.push('finish');
      break;
    }

    // 1) The opposition block slides towards the ball.
    const STEP_T = 2.5;
    const defShift = t.showOpponents ? shiftBlock(t, 'home', positions, carrierPos, 5 * STEP_T, blockBase) : {};
    const defPos = { ...positions };
    for (const [id, path] of Object.entries(defShift)) defPos[id] = path[path.length - 1];
    const oppPts = opponentsOf(t, 'home').map((o) => defPos[o.id]).filter(Boolean);

    // 2) Support play: every teammate looks for the best reachable pocket of space.
    const line = t.rules.offside ? offsideLine(t, 'home', defPos) : 1;
    const ballProg = progress('home', carrierPos, p);
    const reach = Math.min(13, 0.22 * p.length);
    const order = { FWD: 0, MID: 1, DEF: 2, GK: 3 } as const;
    const mates = teammatesOf(t, 'home')
      .filter((m) => m.id !== carrier && m.line !== 'GK')
      .sort((a, b) => order[a.line] - order[b.line]);
    const moves: Record<string, Vec[]> = {};
    const claimed: Vec[] = [carrierPos];
    for (const mate of mates) {
      const pos = positions[mate.id];
      const laneY = t.initial[mate.id]?.y ?? pos.y;
      const wide = Math.abs(laneY - p.width / 2) > p.width * 0.25;
      let best = pos;
      let bestScore = -Infinity;
      const candidates: Vec[] = [pos];
      for (const rr of [reach * 0.5, reach]) {
        for (let k = 0; k < 10; k++) {
          const ang = (k / 10) * Math.PI * 2;
          candidates.push({ x: pos.x + Math.cos(ang) * rr, y: pos.y + Math.sin(ang) * rr });
        }
      }
      for (const raw of candidates) {
        const c = clampToPitch(raw, t);
        const prog = progress('home', c, p);
        if (prog > line - 0.006) continue; // stay onside
        if (mate.line === 'DEF' && prog > ballProg - 0.03) continue; // defenders stay behind the ball
        if (prog > 0.95) continue;
        const clr = oppPts.length ? Math.min(laneClearance(carrierPos, c, oppPts), 6 * s) / (6 * s) : 1;
        const press = oppPts.length ? Math.min(Math.min(...oppPts.map((o) => dist(o, c))), 8 * s) / (8 * s) : 1;
        const gain = clamp(prog - ballProg, -0.3, 0.4);
        const wGain = mate.line === 'DEF' ? 0.3 : mate.line === 'MID' ? 1.6 : 2.2;
        const d = dist(c, carrierPos);
        let score = 1.2 * clr + 0.9 * press + wGain * gain - 0.15 * (dist(c, pos) / reach);
        if (wide) score -= 2 * (Math.abs(c.y - laneY) / p.width);
        if (claimed.some((q) => dist(q, c) < 7 * s)) score -= 1;
        if (d > 35 * s) score -= 0.5;
        if (d < 5 * s) score -= 0.6;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      claimed.push(best);
      if (dist(best, pos) > 1) moves[mate.id] = [best];
    }
    const preview = { ...defPos };
    for (const [id, path] of Object.entries(moves)) preview[id] = path[path.length - 1];

    // 3) Ball action. Candidates are tried best-first and each one is checked with
    //    the real analysis engine, so the coach never proposes a pass that breaks.
    const all = passOptions(t, preview, carrier);
    const safe = (o: (typeof all)[number]) => !o.offside && o.clearance > 3 * s && o.pressure > 2.5 * s && o.distance < 40 * s;
    const forward = all.filter((o) => safe(o) && o.gain > 0.03);
    const bigForward = forward.filter((o) => o.gain >= 0.08).sort((a, b) => b.gain + b.score * 0.05 - (a.gain + a.score * 0.05));
    const smallForward = forward.filter((o) => o.gain < 0.08);
    const sideways = all.filter((o) => safe(o) && o.to !== prevCarrier && o.gain <= 0.03 && o.gain > -0.12 && o.distance < 30 * s);
    // Lofted balls only need a free landing zone, so they can go over a compact block.
    const lofted = all.filter((o) => !o.offside && o.gain > 0.12 && o.pressure > 4 * s && o.distance > 15 * s && o.distance < 45 * s);
    const carryLen = Math.max(8, 14 * s);
    const ahead = clampToPitch({ x: carrierPos.x + carryLen, y: carrierPos.y + (goal.y - carrierPos.y) * 0.25 }, t);
    const spaceAhead = oppPts.every((o) => dist(o, ahead) > 6 * s && laneClearance(carrierPos, ahead, [o]) > 2.5 * s);
    const stalled = stall >= 2;

    const passStep = (o: (typeof all)[number], loft: boolean): Step => {
      const rec = playerById(t, o.to)!;
      const allMoves = { ...moves, ...defShift };
      const release = loft ? 0.4 : 0.55;
      // Give the ball enough time to travel at a realistic speed (~18 m/s).
      const duration = Math.max(durationFor(allMoves, positions, 1.5), Math.ceil((o.distance / (18 * (1 - release))) * 2) / 2);
      return {
        id: uid('step'), duration, expectedOutcome: o.gain >= 0.08 ? 'progress' : 'retain', moves: allMoves,
        note: loft
          ? `${playerLabel(carrierPl)} lifts the ball over the block to ${playerLabel(rec)}.`
          : o.gain > 0.03
            ? `${playerLabel(carrierPl)} finds ${playerLabel(rec)} in space as teammates move to open passing lanes.`
            : `${playerLabel(carrierPl)} recycles to ${playerLabel(rec)} to find a new angle.`,
        ball: { type: loft || (o.distance > 25 * s && inPenaltyArea('home', preview[o.to], p)) ? 'cross' : 'pass', from: carrier, to: o.to, releaseAt: release },
      };
    };
    const carryStep = (): Step => {
      const target = spaceAhead
        ? ahead
        : clampToPitch(lerp(carrierPos, goal, Math.min(0.5, (6 * s) / Math.max(1, dist(carrierPos, goal)))), t);
      const allMoves = { ...moves, ...defShift, [carrier]: [target] };
      const gain = progress('home', target, p) - progress('home', carrierPos, p);
      return {
        id: uid('step'), duration: durationFor(allMoves, positions, 2), expectedOutcome: gain >= 0.08 ? 'progress' : 'none', moves: allMoves,
        note: spaceAhead ? `${playerLabel(carrierPl)} drives into the space in front.` : `No pass on: ${playerLabel(carrierPl)} carries the ball forward.`,
        ball: { type: 'dribble', from: carrier, releaseAt: 0 },
      };
    };

    const candidates: { make: () => Step; to?: string }[] = [];
    bigForward.slice(0, 3).forEach((o) => candidates.push({ make: () => passStep(o, false), to: o.to }));
    if (spaceAhead) candidates.push({ make: carryStep });
    if (stalled || !forward.length) lofted.slice(0, 2).forEach((o) => candidates.push({ make: () => passStep(o, true), to: o.to }));
    if (!stalled) {
      smallForward.slice(0, 2).forEach((o) => candidates.push({ make: () => passStep(o, false), to: o.to }));
      sideways.slice(0, 2).forEach((o) => candidates.push({ make: () => passStep(o, false), to: o.to }));
    }
    lofted.slice(0, 2).forEach((o) => candidates.push({ make: () => passStep(o, true), to: o.to }));

    let step: Step | undefined;
    let receiver: string | undefined;
    for (const c of candidates) {
      const candidate = c.make();
      holdOnside(t, candidate, positions);
      if (!stepBreaks(t, steps, candidate)) {
        step = candidate;
        receiver = c.to;
        break;
      }
    }
    if (!step) step = carryStep();
    if (receiver) {
      lines.push(`${carrierPl.number}→${playerById(t, receiver)!.number}`);
      prevCarrier = carrier;
      carrier = receiver;
    } else {
      lines.push(`${carrierPl.number} carries`);
      prevCarrier = undefined;
    }

    const after = { ...positions };
    for (const [id, path] of Object.entries(step.moves)) after[id] = path[path.length - 1];
    steps.push(step);
    positions = after;
    // Track whether the move is actually getting anywhere.
    const nowProg = progress('home', after[carrier] ?? carrierPos, p);
    if (nowProg > bestProg + 0.06) {
      bestProg = nowProg;
      stall = 0;
    } else stall++;
  }
  const summary = steps.length
    ? `Generated ${steps.length} step${steps.length > 1 ? 's' : ''}: ${lines.join(', ')}.`
    : 'Could not find a sensible move from this position.';
  return { steps, summary };
}

/**
 * Assistant coach: generate a pressing step when the opponent has the ball.
 * Nearest player presses the carrier, the next two screen the best passing lanes,
 * everybody else shifts across and stays compact.
 */
export function generatePress(t: Tactic): GeneratedMove {
  if (!t.showOpponents) return { steps: [], summary: 'Turn opponents on to design a press.' };
  const p = pitchFor(t.format);
  const s = scaleFor(p);
  const states = boardStates(t);
  const last = states[states.length - 1];
  const carrier = last.ballOwner;
  if (!carrier || playerById(t, carrier)?.team !== 'away') {
    return { steps: [], summary: 'Give the ball to an opponent first (set the ball owner in Setup or with a pass).' };
  }
  const positions = last.positions;
  const cPos = positions[carrier];
  const home = teammatesOf(t, 'home').filter((pl) => pl.line !== 'GK');
  const byDist = [...home].sort((a, b) => dist(positions[a.id], cPos) - dist(positions[b.id], cPos));
  const options = passOptions(t, positions, carrier).slice(0, 2);
  const moves: Record<string, Vec[]> = {};
  const used = new Set<string>();
  const ownGoal = attackingGoal('away', p);

  const presser = byDist[0];
  if (presser) {
    // Approach on the goal side, curving to cut off the best option.
    const goalSide = lerp(cPos, ownGoal, (1.5 * s) / Math.max(1, dist(cPos, ownGoal)));
    moves[presser.id] = [clampToPitch(goalSide, t)];
    used.add(presser.id);
  }
  options.forEach((o) => {
    const lanePoint = lerp(cPos, positions[o.to], 0.55);
    const cover = home
      .filter((pl) => !used.has(pl.id))
      .sort((a, b) => dist(positions[a.id], lanePoint) - dist(positions[b.id], lanePoint))[0];
    if (cover) {
      moves[cover.id] = [clampToPitch(lanePoint, t)];
      used.add(cover.id);
    }
  });
  for (const pl of home) {
    if (used.has(pl.id)) continue;
    const pos = positions[pl.id];
    const target = clampToPitch(lerp(pos, cPos, 0.2), t);
    if (dist(target, pos) > 1) moves[pl.id] = [target];
  }
  const step: Step = {
    id: uid('step'), duration: durationFor(moves, positions, 2), expectedOutcome: 'none', moves,
    note: `Press trigger: ${presser ? playerLabel(presser) : 'nearest player'} presses the ball carrier, the next players screen the passing lanes.`,
  };
  return { steps: [step], summary: 'Generated a pressing step. Add the regain (a tackle or interception) in the next step.' };
}
