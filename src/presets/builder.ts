import { frac, pitchFor } from '../model/pitch';
import { autoTeams } from '../engine/teams';
import { createTactic } from '../model/tactic';
import type { BallActionType, Step, StepOutcome, Tactic, TacticPhase, Vec } from '../model/types';

/** [x, y] as fractions of pitch length / width. Home attacks to the right (x → 1). */
export type F = [number, number];

export interface PresetStep {
  d: number;
  note: string;
  outcome?: StepOutcome;
  moves?: Record<string, F | F[]>;
  ball?: { type: BallActionType; from: string; to?: string; target?: F; at?: number };
}

export interface PresetSpec {
  key: string;
  name: string;
  description: string;
  format: number;
  phase: TacticPhase;
  home: string;
  away: string;
  showOpponents?: boolean;
  homeName?: string;
  awayName?: string;
  ballOwner: string;
  /** Override starting positions (fractions). */
  setup?: Record<string, F>;
  /** Override role labels, e.g. to show futsal names. */
  roles?: Record<string, string>;
  /**
   * How the players without a scripted run move. 'react' (default): the team in
   * possession supports the play (support engine) and the other team defends as a
   * unit (defence engine), for both sides; runs written in a step are kept as they
   * are. 'manual': only the moves written here.
   */
  opponents?: 'react' | 'manual';
  steps: PresetStep[];
}

export function buildPreset(spec: PresetSpec): Tactic {
  const t = createTactic({
    name: spec.name,
    format: spec.format,
    homeFormation: spec.home,
    awayFormation: spec.away,
    showOpponents: spec.showOpponents ?? true,
    phase: spec.phase,
  });
  const p = pitchFor(spec.format);
  const v = (f: F): Vec => frac(f[0], f[1], p);
  t.id = `preset_${spec.key}`;
  t.builtIn = true;
  t.description = spec.description;
  t.homeName = spec.homeName ?? 'Us';
  t.awayName = spec.awayName ?? 'Opponent';
  t.ballOwner = spec.ballOwner;
  t.createdAt = 0;
  t.updatedAt = 0;
  for (const [id, f] of Object.entries(spec.setup ?? {})) t.initial[id] = v(f);
  for (const [id, role] of Object.entries(spec.roles ?? {})) {
    const pl = t.players.find((x) => x.id === id);
    if (pl) pl.role = role;
  }
  t.steps = spec.steps.map((s, i): Step => {
    const moves: Record<string, Vec[]> = {};
    for (const [id, m] of Object.entries(s.moves ?? {})) {
      const list = (Array.isArray(m[0]) ? m : [m]) as F[];
      moves[id] = list.map(v);
    }
    return {
      id: `${t.id}_s${i}`,
      duration: s.d,
      note: s.note,
      expectedOutcome: s.outcome ?? 'none',
      moves,
      ball: s.ball
        ? {
            type: s.ball.type,
            from: s.ball.from,
            to: s.ball.to,
            target: s.ball.target ? v(s.ball.target) : undefined,
            releaseAt: s.ball.at ?? 0.4,
          }
        : undefined,
    };
  });
  if ((spec.opponents ?? 'react') === 'react') {
    t.steps = autoTeams(t, { support: ['home', 'away'], defend: ['home', 'away'], keep: true });
  }
  return t;
}
