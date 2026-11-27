import { pitchFor } from './pitch';
import type { Line, Player, TeamSide, Vec } from './types';

/**
 * Formations are written as outfield lines from defence to attack, e.g. "4-3-3".
 * The goalkeeper is implicit, so the numbers add up to (format - 1).
 */
export const FORMATIONS: Record<number, string[]> = {
  4: ['1-2', '2-1', '1-1-1'],
  5: ['1-2-1', '2-2', '3-1', '2-1-1'],
  6: ['2-1-2', '2-2-1', '3-2', '1-3-1'],
  7: ['2-3-1', '3-2-1', '3-1-2', '2-1-2-1'],
  8: ['3-3-1', '3-2-2', '2-3-2', '3-1-3'],
  9: ['3-2-3', '3-3-2', '2-4-2', '3-4-1'],
  10: ['4-4-1', '3-4-2', '4-3-2', '3-3-3'],
  11: ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '3-4-3', '5-3-2', '4-1-4-1', '4-4-1-1'],
};

export function parseFormation(f: string): number[] {
  return f.split('-').map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0);
}

export function isValidFormation(f: string, format: number): boolean {
  const lines = parseFormation(f);
  return lines.length >= 1 && lines.reduce((a, b) => a + b, 0) === format - 1;
}

export function defaultFormation(format: number): string {
  return FORMATIONS[format]?.[0] ?? '1-1-1';
}

interface Slot {
  line: Line;
  role: string;
  fx: number;
  fy: number;
}

function spread(n: number): number[] {
  if (n === 1) return [0.5];
  const margin = n >= 5 ? 0.08 : n === 4 ? 0.12 : n === 3 ? 0.2 : 0.3;
  return Array.from({ length: n }, (_, i) => margin + ((1 - 2 * margin) * i) / (n - 1));
}

function smallSidedRoles(lines: number[]): string[][] {
  // Futsal-style naming for 4- and 5-a-side.
  return lines.map((count, li) => {
    const last = li === lines.length - 1;
    const first = li === 0;
    if (count === 1) return [first && lines.length > 1 ? 'FIXO' : last ? 'PIVO' : 'MID'];
    if (count === 2) return first && lines.length > 1 ? ['DEF', 'DEF'] : ['ALA', 'ALA'];
    return Array.from({ length: count }, (_, i) =>
      i === 0 || i === count - 1 ? 'ALA' : first ? 'FIXO' : 'PIVO',
    );
  });
}

function defenderRoles(n: number): string[] {
  switch (n) {
    case 1: return ['CB'];
    case 2: return ['CB', 'CB'];
    case 3: return ['LCB', 'CB', 'RCB'];
    case 4: return ['LB', 'CB', 'CB', 'RB'];
    case 5: return ['LWB', 'CB', 'CB', 'CB', 'RWB'];
    default: return Array(n).fill('DEF');
  }
}

function midfieldRoles(n: number, kind: 'DM' | 'CM' | 'AM'): string[] {
  if (kind === 'DM') return n === 1 ? ['DM'] : Array(n).fill('DM');
  if (kind === 'AM') {
    if (n === 1) return ['AM'];
    if (n === 2) return ['AM', 'AM'];
    if (n === 3) return ['LW', 'AM', 'RW'];
    return ['LM', ...Array(n - 2).fill('AM'), 'RM'];
  }
  switch (n) {
    case 1: return ['CM'];
    case 2: return ['CM', 'CM'];
    case 3: return ['CM', 'CM', 'CM'];
    case 4: return ['LM', 'CM', 'CM', 'RM'];
    case 5: return ['LWB', 'CM', 'CM', 'CM', 'RWB'];
    default: return Array(n).fill('MID');
  }
}

function forwardRoles(n: number): string[] {
  switch (n) {
    case 1: return ['ST'];
    case 2: return ['ST', 'ST'];
    case 3: return ['LW', 'ST', 'RW'];
    default: return ['LW', ...Array(n - 2).fill('ST'), 'RW'];
  }
}

/** Build the slots of a formation for the home team (attacking +x), in pitch fractions. */
export function formationSlots(formation: string, format: number): Slot[] {
  const lines = parseFormation(formation);
  const slots: Slot[] = [{ line: 'GK', role: 'GK', fx: 0.035, fy: 0.5 }];
  const n = lines.length;
  // Base shape sits in the team's own half so it is a legal kick-off shape.
  const xs = n === 1 ? [0.3] : Array.from({ length: n }, (_, i) => 0.16 + (0.3 * i) / (n - 1));
  const small = format <= 5 ? smallSidedRoles(lines) : null;

  lines.forEach((count, li) => {
    const lineType: Line = n === 1 ? 'MID' : li === 0 ? 'DEF' : li === n - 1 ? 'FWD' : 'MID';
    let roles: string[];
    if (small) roles = small[li];
    else if (lineType === 'DEF') roles = defenderRoles(count);
    else if (lineType === 'FWD') roles = forwardRoles(count);
    else {
      const midLines = n - 2;
      const midIndex = li - 1;
      const kind = midLines >= 2 ? (midIndex === 0 ? 'DM' : midIndex === midLines - 1 ? 'AM' : 'CM') : 'CM';
      roles = midfieldRoles(count, kind);
    }
    const ys = spread(count);
    // Wide players in a back four / wing-backs sit slightly higher than centre-backs.
    ys.forEach((fy, i) => {
      const wide = count >= 4 && (i === 0 || i === count - 1);
      slots.push({ line: lineType, role: roles[i] ?? lineType, fx: xs[li] + (wide ? 0.025 : 0), fy });
    });
  });
  return slots;
}

/** Conventional shirt numbers by role (used for 7-a-side and up). */
const ROLE_NUMBERS: Record<string, number[]> = {
  GK: [1], RB: [2], RWB: [2], LB: [3], LWB: [3], CB: [4, 5, 15], LCB: [5, 15], RCB: [4, 2],
  DM: [6, 16], CM: [8, 6, 10, 14], AM: [10, 8], LM: [11, 7], RM: [7, 11], LW: [11, 7], RW: [7, 11], ST: [9, 10, 19],
};

export function shirtNumbers(slots: { role: string }[], format: number): number[] {
  if (format < 7) return slots.map((_, i) => i + 1);
  const used = new Set<number>();
  const out = slots.map((sl) => {
    const n = (ROLE_NUMBERS[sl.role] ?? []).find((x) => !used.has(x));
    if (n) used.add(n);
    return n ?? 0;
  });
  let next = 12;
  return out.map((n) => {
    if (n) return n;
    while (used.has(next)) next++;
    used.add(next);
    return next;
  });
}

export interface TeamBuild {
  players: Player[];
  positions: Record<string, Vec>;
}

/** Create players and positions for a team in a formation. The away team is mirrored. */
export function buildTeam(side: TeamSide, formation: string, format: number): TeamBuild {
  const p = pitchFor(format);
  const slots = formationSlots(formation, format);
  const prefix = side === 'home' ? 'h' : 'a';
  const players: Player[] = [];
  const positions: Record<string, Vec> = {};
  const numbers = shirtNumbers(slots, format);
  slots.forEach((s, i) => {
    const id = `${prefix}${i}`;
    players.push({ id, team: side, number: numbers[i], name: '', role: s.role, line: s.line });
    const fx = side === 'home' ? s.fx : 1 - s.fx;
    const fy = side === 'home' ? s.fy : 1 - s.fy;
    positions[id] = { x: fx * p.length, y: fy * p.width };
  });
  return { players, positions };
}

/** Re-shape an existing team into a new formation, keeping player ids, numbers and names. */
export function applyFormation(
  existing: Player[],
  side: TeamSide,
  formation: string,
  format: number,
): TeamBuild {
  const fresh = buildTeam(side, formation, format);
  const mine = existing.filter((pl) => pl.team === side);
  const players = fresh.players.map((fp, i) => {
    const old = mine[i];
    return old ? { ...old, role: fp.role, line: fp.line } : fp;
  });
  const positions: Record<string, Vec> = {};
  players.forEach((pl, i) => {
    positions[pl.id] = fresh.positions[fresh.players[i].id];
  });
  return { players, positions };
}

/** Count players per line, e.g. for coach comparisons. */
export function lineCounts(formation: string): { def: number; mid: number; fwd: number } {
  const lines = parseFormation(formation);
  if (lines.length === 1) return { def: 0, mid: lines[0], fwd: 0 };
  const def = lines[0];
  const fwd = lines[lines.length - 1];
  const mid = lines.slice(1, -1).reduce((a, b) => a + b, 0);
  return { def, mid, fwd };
}
