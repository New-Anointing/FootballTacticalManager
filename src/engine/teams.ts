import { boardStates, playerById } from '../model/tactic';
import type { Step, Tactic, TeamSide } from '../model/types';
import { deconflictStep } from './deconflict';
import { reactInPlace } from './defence';
import { pathLength } from './geometry';
import { AT_REST, capRun, carryFor, runPeakSpeed, SPRINT } from './motion';
import { supportStep } from './support';

export interface AutoTeamOptions {
  /** Teams whose free players support the play when they have the ball. */
  support?: TeamSide[];
  /** Teams that defend realistically when the other side has the ball. */
  defend?: TeamSide[];
  /** Keep movement already written for defending players (scripted overrides). */
  keep?: boolean;
  /** Only this step. */
  only?: number;
}

/**
 * Bring a whole scenario to life, step by step: the team in possession moves with
 * the play (support), then the other team reacts to it (defence). Scripted runs are
 * never changed. Each step builds on the positions the previous one produced.
 *
 * Players carry their speed from one step into the next (see motion.ts), so how a run
 * unfolds within a step depends on the runs either side of it. The first pass builds
 * every step with the speeds known at the time; a second pass checks each step again
 * with the final speeds, so nobody runs through anybody in the finished animation.
 */
export function autoTeams(t: Tactic, opts: AutoTeamOptions = {}): Step[] {
  const support = opts.support ?? [];
  const defend = opts.defend ?? [];
  const steps: Step[] = JSON.parse(JSON.stringify(t.steps));
  const work = () => ({ ...t, steps });
  const engineByStep: Set<string>[] = steps.map(() => new Set<string>());
  for (let i = 0; i < steps.length; i++) {
    if (opts.only !== undefined && opts.only !== i) continue;
    const states = boardStates(work());
    const before = states[i];
    const step = steps[i];
    const team = playerById(t, step.ball?.from ?? before.ballOwner)?.team;
    if (!team) continue;
    // Players whose movement the engines decide in this step (never scripted runs).
    const engine = engineByStep[i];
    if (support.includes(team)) {
      const scripted = new Set(Object.keys(step.moves));
      const runs = supportStep(t, before, step, team);
      for (const [id, path] of Object.entries(runs)) if (!step.moves[id]) step.moves[id] = path;
      for (const pl of t.players) if (pl.team === team && before.positions[pl.id] && !scripted.has(pl.id)) engine.add(pl.id);
    }
    if (defend.length) {
      const carry = carryFor(t, boardStates(work()), i, steps);
      for (const id of reactInPlace(t, before, step, defend, !!opts.keep, carry)) engine.add(id);
    }
    // Finally, nobody runs through anybody.
    if (engine.size) deconflictStep(t, before, step, engine, carryFor(t, boardStates(work()), i, steps));
  }
  // Nobody the engines move runs faster than a hard sprint, given the speed they carry
  // in and out: from a standstill a player simply can't get as far. Runs that ask too
  // much finish where the player could realistically get to.
  const capSpeeds = () => {
    for (let round = 0; round < 4; round++) {
      let changed = false;
      for (let i = 0; i < steps.length; i++) {
        const states = boardStates(work());
        const carry = carryFor(t, states, i, steps);
        const D = steps[i].duration;
        for (const id of engineByStep[i]) {
          const m = steps[i].moves[id];
          const start = states[i].positions[id];
          if (!m?.length || !start) continue;
          const path = [start, ...m];
          const c = carry[id] ?? AT_REST;
          if (runPeakSpeed(pathLength(path), D, c) <= SPRINT + 0.05) continue;
          const cut = capRun(path, D, c);
          if (cut.length) steps[i].moves[id] = cut;
          else delete steps[i].moves[id];
          changed = true;
        }
      }
      if (!changed) break;
    }
  };
  // Check every step again with the speeds of the finished scenario.
  const recheck = (sameEnd: boolean) => {
    for (let i = 0; i < steps.length; i++) {
      if (!engineByStep[i].size) continue;
      const states = boardStates(work());
      deconflictStep(t, states[i], steps[i], engineByStep[i], carryFor(t, states, i, steps), sameEnd);
    }
  };
  capSpeeds();
  recheck(false);
  capSpeeds();
  // Last, only bend runs, so everyone still finishes where the passes above put them.
  recheck(true);
  return steps;
}
