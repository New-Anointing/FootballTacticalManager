import { buildTeam, defaultFormation } from './formations';
import { attackingGoal, pitchFor } from './pitch';
import type { Player, Step, Tactic, TacticPhase, TeamSide, Vec } from './types';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
}

export interface NewTacticOptions {
  name?: string;
  format: number;
  homeFormation?: string;
  awayFormation?: string;
  showOpponents?: boolean;
  phase?: TacticPhase;
}

export function createTactic(opts: NewTacticOptions): Tactic {
  const format = opts.format;
  const homeFormation = opts.homeFormation ?? defaultFormation(format);
  const awayFormation = opts.awayFormation ?? defaultFormation(format);
  const home = buildTeam('home', homeFormation, format);
  const away = buildTeam('away', awayFormation, format);
  const now = Date.now();
  const p = pitchFor(format);
  return {
    id: uid('tactic'),
    name: opts.name ?? `New ${format}v${format} tactic`,
    description: '',
    format,
    phase: opts.phase ?? 'attack',
    homeName: 'Home',
    awayName: 'Away',
    homeFormation,
    awayFormation,
    showOpponents: opts.showOpponents ?? true,
    rules: { offside: format >= 8 },
    players: [...home.players, ...away.players],
    initial: { ...home.positions, ...away.positions },
    ballOwner: 'h0',
    ballStart: { x: p.length / 2, y: p.width / 2 },
    steps: [],
    createdAt: now,
    updatedAt: now,
    source: { type: 'scenario' },
  };
}

export function newStep(): Step {
  return { id: uid('step'), duration: 2, note: '', expectedOutcome: 'none', moves: {} };
}

/** Players that take part in the scenario (away team hidden when opponents are off). */
export function activePlayers(t: Tactic): Player[] {
  return t.showOpponents ? t.players : t.players.filter((p) => p.team === 'home');
}

export function playerById(t: Tactic, id: string | undefined): Player | undefined {
  return id ? t.players.find((p) => p.id === id) : undefined;
}

export function endOf(path: Vec[] | undefined, fallback: Vec): Vec {
  return path && path.length ? path[path.length - 1] : fallback;
}

/** Full board state at a step boundary. */
export interface BoardState {
  positions: Record<string, Vec>;
  ballOwner?: string;
  ball: Vec;
}

const PICKUP_RADIUS = 1.6;

/**
 * Board states at every step boundary: index 0 is the setup, index i is the
 * state after step i-1 has been played.
 */
export function boardStates(t: Tactic): BoardState[] {
  const p = pitchFor(t.format);
  const startOwner = t.ballOwner && t.initial[t.ballOwner] ? t.ballOwner : undefined;
  let state: BoardState = {
    positions: { ...t.initial },
    ballOwner: startOwner,
    ball: startOwner ? { ...t.initial[startOwner] } : { ...t.ballStart },
  };
  const out: BoardState[] = [state];
  for (const step of t.steps) {
    const positions: Record<string, Vec> = { ...state.positions };
    for (const [id, path] of Object.entries(step.moves)) {
      if (positions[id]) positions[id] = endOf(path, positions[id]);
    }
    let ballOwner = state.ballOwner;
    let ball = state.ball;
    const a = step.ball;
    if (a && positions[a.from]) {
      if ((a.type === 'pass' || a.type === 'cross') && a.to && positions[a.to]) {
        ballOwner = a.to;
        ball = positions[a.to];
      } else if (a.type === 'dribble') {
        ballOwner = a.from;
        ball = positions[a.from];
      } else if (a.type === 'shot') {
        ballOwner = undefined;
        const team = playerById(t, a.from)?.team ?? 'home';
        ball = a.target ?? attackingGoal(team, p);
      } else {
        ballOwner = undefined;
        ball = a.target ?? ball;
      }
    } else if (ballOwner && positions[ballOwner]) {
      ball = positions[ballOwner];
    }
    // A loose ball is collected by the nearest player who finishes on it.
    if (!ballOwner && a?.type !== 'shot') {
      let best: string | undefined;
      let bestD = PICKUP_RADIUS;
      for (const pl of activePlayers(t)) {
        const pos = positions[pl.id];
        const d = Math.hypot(pos.x - ball.x, pos.y - ball.y);
        if (d < bestD) {
          bestD = d;
          best = pl.id;
        }
      }
      if (best) {
        ballOwner = best;
        ball = positions[best];
      }
    }
    state = { positions, ballOwner, ball: { ...ball } };
    out.push(state);
  }
  return out;
}

export function teamInPossession(t: Tactic, state: BoardState): TeamSide | undefined {
  return playerById(t, state.ballOwner)?.team;
}

export function totalDuration(t: Tactic): number {
  return t.steps.reduce((s, st) => s + st.duration, 0);
}

export function cloneTactic(t: Tactic, overrides: Partial<Tactic> = {}): Tactic {
  const copy: Tactic = JSON.parse(JSON.stringify(t));
  const now = Date.now();
  return { ...copy, id: uid('tactic'), builtIn: false, createdAt: now, updatedAt: now, ...overrides };
}

export function playerLabel(pl: Player): string {
  return pl.name ? `#${pl.number} ${pl.name}` : `#${pl.number} ${pl.role}`;
}
