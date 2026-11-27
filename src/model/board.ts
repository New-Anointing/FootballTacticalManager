import { buildTeam, defaultFormation, formationSlots, shirtNumbers } from './formations';
import { discRadius, pitchFor } from './pitch';
import { uid } from './tactic';
import type { Tactic, TeamSide, Vec } from './types';

/**
 * A free tactics board: like a magnetic board in the dressing room. No steps and no
 * animation. Pieces (players, ball, cones, poles, mini goals, mannequins) sit wherever
 * they're put, and arrows, lines, zones and notes are drawn on top. Everything is in
 * metres on the chosen pitch, so a board looks right on any screen and in any view.
 */

export type PieceKind = 'player' | 'ball' | 'cone' | 'pole' | 'goal' | 'mannequin';

export interface BoardPiece {
  id: string;
  kind: PieceKind;
  x: number;
  y: number;
  /** Players: which side. */
  team?: TeamSide;
  /** Players: goalkeeper kit. */
  gk?: boolean;
  /** Players not in the squad list: shirt number and label shown on the disc. */
  number?: string;
  label?: string;
  /** Linked squad member (name and number come from the squad list). */
  squadId?: string;
  /** Cones, poles, mannequins. */
  color?: string;
  /** Mini goals and mannequins, in degrees. */
  angle?: number;
}

export type DrawingKind = 'arrow' | 'line' | 'pen' | 'rect' | 'ellipse' | 'text';
/** Arrow styles follow the usual coaching notation. */
export type ArrowStyle = 'run' | 'pass' | 'dribble';

export interface BoardDrawing {
  id: string;
  kind: DrawingKind;
  /** arrow / line: start and end; pen: the stroke; rect / ellipse: two corners; text: anchor. */
  points: Vec[];
  color: string;
  style?: ArrowStyle;
  /** Pen strokes can finish in an arrowhead. */
  head?: boolean;
  text?: string;
}

export interface SquadMember {
  id: string;
  team: TeamSide;
  number: string;
  name: string;
  /** Position label shown when there's no name. */
  role: string;
  gk?: boolean;
}

/** Which part of the pitch the board shows. Home attacks to the right. */
export type BoardView = 'full' | 'attack' | 'defence';
/** Auto: vertical on tall screens (phones), horizontal on wide ones. */
export type BoardOrientation = 'auto' | 'horizontal' | 'vertical';

export interface Board {
  id: string;
  name: string;
  notes: string;
  format: number;
  view: BoardView;
  orientation: BoardOrientation;
  homeName: string;
  awayName: string;
  squad: SquadMember[];
  pieces: BoardPiece[];
  drawings: BoardDrawing[];
  createdAt: number;
  updatedAt: number;
}

export const BENCH_SIZE = 5;
export const DRAW_COLORS = ['#ffffff', '#ffd54a', '#ff6b6b', '#4dabf7', '#3ddc84', '#111111'];
export const CONE_COLORS = ['#ff8c1a', '#ffd54a', '#4dabf7', '#ff6b6b', '#ffffff'];

function squadFor(side: TeamSide, format: number): SquadMember[] {
  const slots = formationSlots(defaultFormation(format), format);
  const numbers = shirtNumbers(slots, format);
  const starters = slots.map((s, i) => ({
    id: uid('sq'), team: side, number: String(numbers[i]), name: '', role: s.role, gk: s.line === 'GK',
  }));
  const used = new Set(numbers);
  const bench: SquadMember[] = [];
  for (let n = 12; bench.length < BENCH_SIZE; n++) {
    if (used.has(n)) continue;
    bench.push({ id: uid('sq'), team: side, number: String(n), name: '', role: bench.length === 0 ? 'GK' : 'SUB', gk: bench.length === 0 });
  }
  return [...starters, ...bench];
}

/** A new board with both squads lined up and the ball on the centre spot. */
export function createBoard(opts: { format?: number; name?: string; homeFormation?: string; awayFormation?: string } = {}): Board {
  const format = opts.format ?? 11;
  const p = pitchFor(format);
  const now = Date.now();
  const board: Board = {
    id: uid('board'),
    name: opts.name ?? `${format}v${format} board`,
    notes: '',
    format,
    view: 'full',
    orientation: 'auto',
    homeName: 'Us',
    awayName: 'Opponent',
    squad: [...squadFor('home', format), ...squadFor('away', format)],
    pieces: [],
    drawings: [],
    createdAt: now,
    updatedAt: now,
  };
  lineUp(board, 'home', opts.homeFormation ?? defaultFormation(format));
  lineUp(board, 'away', opts.awayFormation ?? defaultFormation(format));
  board.pieces.push({ id: uid('pc'), kind: 'ball', x: p.length / 2, y: p.width / 2 });
  return board;
}

/**
 * Put one side out in a formation: the first squad members take the positions (the
 * rest stay on the bench). Any players of that side already on the board are replaced.
 */
export function lineUp(board: Board, side: TeamSide, formation: string): void {
  const build = buildTeam(side, formation, board.format);
  const squad = board.squad.filter((m) => m.team === side);
  board.pieces = board.pieces.filter((pc) => !(pc.kind === 'player' && pc.team === side));
  build.players.forEach((pl, i) => {
    const pos = build.positions[pl.id];
    const member = squad[i];
    if (member) {
      member.role = pl.role;
      member.gk = pl.line === 'GK';
    }
    board.pieces.push({
      id: uid('pc'), kind: 'player', team: side, x: pos.x, y: pos.y, gk: pl.line === 'GK',
      squadId: member?.id, number: member ? undefined : String(pl.number), label: member ? undefined : pl.role,
    });
  });
}

/** What a player disc shows: shirt number and the name (or position) underneath. */
export function playerText(board: Board, pc: BoardPiece): { number: string; label: string } {
  const m = pc.squadId ? board.squad.find((x) => x.id === pc.squadId) : undefined;
  if (m) return { number: m.number, label: m.name || m.role };
  return { number: pc.number ?? '', label: pc.label ?? '' };
}

/** Size of the pieces on this board (metres). */
export function pieceRadius(board: Board): number {
  return discRadius(pitchFor(board.format));
}

/** The area of the pitch the board shows, with a margin for the goals and the bench edge. */
export function boardViewBox(board: Board, vertical: boolean): { x: number; y: number; w: number; h: number } {
  const p = pitchFor(board.format);
  const m = Math.max(2, p.length * 0.03);
  const x0 = board.view === 'attack' ? p.length / 2 - m : -m;
  const x1 = board.view === 'defence' ? p.length / 2 + m : p.length + m;
  const y0 = -m;
  const y1 = p.width + m;
  // Vertical boards show the pitch rotated: home attacks upwards.
  return vertical ? { x: y0, y: p.length - x1, w: y1 - y0, h: x1 - x0 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** A board showing one moment of an animated tactic, with its runs and the ball drawn as arrows. */
export function boardFromTactic(
  t: Tactic, positions: Record<string, Vec>, ball: Vec,
  arrows: { points: Vec[]; style: ArrowStyle; team?: TeamSide }[] = [],
): Board {
  const now = Date.now();
  const squad: SquadMember[] = t.players.map((pl) => ({
    id: uid('sq'), team: pl.team, number: String(pl.number), name: pl.name, role: pl.role, gk: pl.line === 'GK',
  }));
  const byPlayer = new Map(t.players.map((pl, i) => [pl.id, squad[i]]));
  const pieces: BoardPiece[] = [];
  for (const pl of t.players) {
    if (pl.team === 'away' && !t.showOpponents) continue;
    const pos = positions[pl.id];
    if (!pos) continue;
    pieces.push({ id: uid('pc'), kind: 'player', team: pl.team, x: pos.x, y: pos.y, gk: pl.line === 'GK', squadId: byPlayer.get(pl.id)!.id });
  }
  pieces.push({ id: uid('pc'), kind: 'ball', x: ball.x, y: ball.y });
  return {
    id: uid('board'),
    name: t.name,
    notes: t.description ?? '',
    format: t.format,
    view: 'full',
    orientation: 'auto',
    homeName: t.homeName,
    awayName: t.awayName,
    squad,
    pieces,
    drawings: arrows.map((a) => ({
      id: uid('dw'), kind: 'arrow' as const, points: a.points, style: a.style,
      color: a.style === 'pass' ? '#ffffff' : a.team === 'away' ? '#ff6b6b' : '#ffd54a',
    })),
    createdAt: now,
    updatedAt: now,
  };
}
