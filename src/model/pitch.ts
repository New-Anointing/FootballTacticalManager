import type { TeamSide, Vec } from './types';

export interface PitchSpec {
  length: number;
  width: number;
  goalWidth: number;
  /** Depth / width of the penalty (or goal) area. */
  boxDepth: number;
  boxWidth: number;
  /** Small goal area; 0 for formats that don't use one. */
  sixDepth: number;
  sixWidth: number;
  centreRadius: number;
  penaltySpot: number;
  label: string;
}

/**
 * Pitch dimensions per players-per-side. Small-sided formats use futsal-like
 * courts; 7v7, 9v9 and 11v11 follow common grassroots / FIFA guidance.
 */
export function pitchFor(format: number): PitchSpec {
  if (format <= 5) {
    return {
      length: 40, width: 20, goalWidth: 3, boxDepth: 6, boxWidth: 12,
      sixDepth: 0, sixWidth: 0, centreRadius: 3, penaltySpot: 6, label: 'Small-sided / futsal court',
    };
  }
  if (format <= 7) {
    return {
      length: 60, width: 40, goalWidth: 5, boxDepth: 10, boxWidth: 24,
      sixDepth: 4, sixWidth: 12, centreRadius: 6, penaltySpot: 8, label: '7-a-side pitch',
    };
  }
  if (format <= 9) {
    return {
      length: 75, width: 50, goalWidth: 6.4, boxDepth: 13, boxWidth: 32,
      sixDepth: 5, sixWidth: 16, centreRadius: 7.5, penaltySpot: 9, label: '9-a-side pitch',
    };
  }
  return {
    length: 105, width: 68, goalWidth: 7.32, boxDepth: 16.5, boxWidth: 40.3,
    sixDepth: 5.5, sixWidth: 18.32, centreRadius: 9.15, penaltySpot: 11, label: 'Full-size pitch',
  };
}

/** Centre of the goal a team is attacking. */
export function attackingGoal(side: TeamSide, p: PitchSpec): Vec {
  return side === 'home' ? { x: p.length, y: p.width / 2 } : { x: 0, y: p.width / 2 };
}

export function ownGoal(side: TeamSide, p: PitchSpec): Vec {
  return attackingGoal(side === 'home' ? 'away' : 'home', p);
}

/** How far up the pitch a point is from the given team's point of view (0 = own goal line, 1 = opponent's). */
export function progress(side: TeamSide, pos: Vec, p: PitchSpec): number {
  return side === 'home' ? pos.x / p.length : 1 - pos.x / p.length;
}

export function insidePitch(pos: Vec, p: PitchSpec, margin = 0): boolean {
  return pos.x >= -margin && pos.x <= p.length + margin && pos.y >= -margin && pos.y <= p.width + margin;
}

export function inPenaltyArea(side: TeamSide, pos: Vec, p: PitchSpec): boolean {
  // side = team that attacks this box
  const top = (p.width - p.boxWidth) / 2;
  const inY = pos.y >= top && pos.y <= top + p.boxWidth;
  return side === 'home' ? inY && pos.x >= p.length - p.boxDepth : inY && pos.x <= p.boxDepth;
}

/** Convert pitch fractions (0..1) to metres. Presets are written in fractions so they scale to any pitch. */
export function frac(fx: number, fy: number, p: PitchSpec): Vec {
  return { x: fx * p.length, y: fy * p.width };
}
