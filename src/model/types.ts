// Core data model for tactics / match scenarios.
//
// Coordinates are in metres on a pitch whose origin is the top-left corner
// when drawn horizontally: x runs along the length (0..length), y across the
// width (0..width). The home team always attacks towards +x (the right).

export type TeamSide = 'home' | 'away';

export interface Vec {
  x: number;
  y: number;
}

/** Broad line a player belongs to; used by formations, analysis and the coach. */
export type Line = 'GK' | 'DEF' | 'MID' | 'FWD';

export interface Player {
  id: string;
  team: TeamSide;
  number: number;
  name: string;
  /** Short positional label shown on the pitch, e.g. "CB", "LW", "PIVO". */
  role: string;
  line: Line;
}

export type BallActionType = 'pass' | 'cross' | 'shot' | 'dribble' | 'clearance';

export interface BallAction {
  type: BallActionType;
  /** Player who has the ball when the action starts. */
  from: string;
  /** Receiving player (pass / cross). The ball is delivered to where they are at the end of the step. */
  to?: string;
  /** Free target point (pass into space, shot, clearance). Used when `to` is absent. */
  target?: Vec;
  /** Fraction of the step (0..1) at which the ball is released. */
  releaseAt: number;
}

/** Intended outcome the coach sets for a step; analysis checks it. */
export type StepOutcome =
  | 'none'
  | 'retain'
  | 'progress'
  | 'switch'
  | 'chance'
  | 'goal'
  | 'regain'
  | 'clear';

export interface Step {
  id: string;
  /** Seconds this phase of play takes during playback. */
  duration: number;
  /** Coaching note shown as a caption during playback. */
  note: string;
  expectedOutcome: StepOutcome;
  /**
   * Player runs for this step. Each entry is a list of waypoints; the last one is
   * where the player finishes. Players without an entry hold their position.
   */
  moves: Record<string, Vec[]>;
  ball?: BallAction;
}

export type TacticPhase = 'attack' | 'defence' | 'transition' | 'set-piece';

export interface TacticRules {
  offside: boolean;
}

export interface Tactic {
  id: string;
  name: string;
  description: string;
  /** Players per side including the goalkeeper (4..11). */
  format: number;
  phase: TacticPhase;
  homeName: string;
  awayName: string;
  homeFormation: string;
  awayFormation: string;
  /** When false the away team is hidden and ignored (pure shape / pattern work). */
  showOpponents: boolean;
  rules: TacticRules;
  players: Player[];
  /** Starting positions (the "Setup" frame). */
  initial: Record<string, Vec>;
  /** Who has the ball at the start; if undefined the ball starts at `ballStart`. */
  ballOwner?: string;
  ballStart: Vec;
  steps: Step[];
  builtIn?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Reserved for phase 2 (video analysis). */
  source?: { type: 'scenario' } | { type: 'video'; videoId: string; offsetSeconds: number };
}

export const FORMATS = [4, 5, 6, 7, 8, 9, 10, 11] as const;
export type Format = (typeof FORMATS)[number];
