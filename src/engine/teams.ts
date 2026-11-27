import { boardStates, playerById } from '../model/tactic';
import type { Step, Tactic, TeamSide } from '../model/types';
import { deconflictStep } from './deconflict';
import { reactInPlace } from './defence';
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
 */
export function autoTeams(t: Tactic, opts: AutoTeamOptions = {}): Step[] {
  const support = opts.support ?? [];
  const defend = opts.defend ?? [];
  const steps: Step[] = JSON.parse(JSON.stringify(t.steps));
  for (let i = 0; i < steps.length; i++) {
    if (opts.only !== undefined && opts.only !== i) continue;
    const before = boardStates({ ...t, steps: steps.slice(0, i) }).slice(-1)[0];
    const step = steps[i];
    const team = playerById(t, step.ball?.from ?? before.ballOwner)?.team;
    if (!team) continue;
    // Players whose movement the engines decide in this step (never scripted runs).
    const engine = new Set<string>();
    if (support.includes(team)) {
      const scripted = new Set(Object.keys(step.moves));
      const runs = supportStep(t, before, step, team);
      for (const [id, path] of Object.entries(runs)) if (!step.moves[id]) step.moves[id] = path;
      for (const pl of t.players) if (pl.team === team && before.positions[pl.id] && !scripted.has(pl.id)) engine.add(pl.id);
    }
    if (defend.length) for (const id of reactInPlace(t, before, step, defend, !!opts.keep)) engine.add(id);
    // Finally, nobody runs through anybody.
    if (engine.size) deconflictStep(t, before, step, engine);
  }
  return steps;
}
