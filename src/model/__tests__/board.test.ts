import { beforeEach, describe, expect, it } from 'vitest';
import { useBoards } from '../../boardStore';
import { BENCH_SIZE, boardFromTactic, boardViewBox, createBoard, lineUp, playerText } from '../board';
import { pitchFor } from '../pitch';
import { boardStates, createTactic } from '../tactic';

describe('tactics board model', () => {
  it('starts with both squads lined up, the bench empty of the board, and a ball', () => {
    const b = createBoard({ format: 11, homeFormation: '4-3-3', awayFormation: '4-4-2' });
    const p = pitchFor(11);
    expect(b.squad.filter((m) => m.team === 'home')).toHaveLength(11 + BENCH_SIZE);
    expect(b.pieces.filter((pc) => pc.kind === 'player')).toHaveLength(22);
    expect(b.pieces.filter((pc) => pc.kind === 'ball')).toHaveLength(1);
    for (const pc of b.pieces.filter((x) => x.kind === 'player')) {
      if (pc.team === 'home') expect(pc.x).toBeLessThan(p.length / 2);
      else expect(pc.x).toBeGreaterThan(p.length / 2);
      expect(pc.squadId).toBeTruthy();
    }
    // Exactly one keeper each, and the squad number shows on the disc.
    expect(b.pieces.filter((pc) => pc.kind === 'player' && pc.gk)).toHaveLength(2);
    const gk = b.pieces.find((pc) => pc.team === 'home' && pc.gk)!;
    expect(playerText(b, gk).number).toBe('1');
  });

  it('lines a side up again in a new shape, leaving the other side alone', () => {
    const b = createBoard({ format: 7, homeFormation: '2-3-1', awayFormation: '3-2-1' });
    const away = JSON.stringify(b.pieces.filter((pc) => pc.team === 'away'));
    lineUp(b, 'home', '3-2-1');
    expect(b.pieces.filter((pc) => pc.kind === 'player' && pc.team === 'home')).toHaveLength(7);
    expect(JSON.stringify(b.pieces.filter((pc) => pc.team === 'away'))).toBe(away);
  });

  it('shows the requested part of the pitch, either way up', () => {
    const b = createBoard({ format: 11 });
    const full = boardViewBox(b, false);
    const tall = boardViewBox(b, true);
    expect(full.w).toBeGreaterThan(full.h);
    expect(tall.h).toBeCloseTo(full.w, 6);
    expect(tall.w).toBeCloseTo(full.h, 6);
    b.view = 'attack';
    const half = boardViewBox(b, false);
    expect(half.x).toBeGreaterThan(pitchFor(11).length / 2 - 5);
    expect(half.w).toBeLessThan(full.w * 0.6);
  });

  it('freezes a moment of an animated tactic onto a board', () => {
    const t = createTactic({ format: 9 });
    const st = boardStates(t)[0];
    const b = boardFromTactic(t, st.positions, st.ball, [{ points: [{ x: 10, y: 10 }, { x: 20, y: 12 }], style: 'run' }]);
    expect(b.format).toBe(9);
    expect(b.pieces.filter((pc) => pc.kind === 'player')).toHaveLength(18);
    expect(b.drawings).toHaveLength(1);
    expect(b.drawings[0].style).toBe('run');
  });
});

describe('tactics board store', () => {
  beforeEach(() => {
    useBoards.getState().newBoard({ format: 11, homeFormation: '4-4-2', awayFormation: '4-3-3' });
  });
  const board = () => {
    const s = useBoards.getState();
    return s.boards.find((b) => b.id === s.currentId)!;
  };

  it('moves pieces, undoes and redoes', () => {
    const pc = board().pieces[0];
    useBoards.getState().movePieces({ [pc.id]: { x: 50, y: 30 } });
    expect(board().pieces.find((x) => x.id === pc.id)).toMatchObject({ x: 50, y: 30 });
    useBoards.getState().undo();
    expect(board().pieces.find((x) => x.id === pc.id)).toMatchObject({ x: pc.x, y: pc.y });
    useBoards.getState().redo();
    expect(board().pieces.find((x) => x.id === pc.id)).toMatchObject({ x: 50, y: 30 });
  });

  it('brings a sub on from the bench and sends a starter off', () => {
    const s = useBoards.getState();
    const onBoard = new Set(board().pieces.map((pc) => pc.squadId));
    const sub = board().squad.find((m) => m.team === 'home' && !onBoard.has(m.id))!;
    s.addPiece({ kind: 'squad', memberId: sub.id }, { x: 40, y: 20 });
    s.addPiece({ kind: 'squad', memberId: sub.id }, { x: 42, y: 22 }); // placing again moves them, no duplicate
    expect(board().pieces.filter((pc) => pc.squadId === sub.id)).toHaveLength(1);
    expect(board().pieces.find((pc) => pc.squadId === sub.id)).toMatchObject({ x: 42, y: 22 });
    s.benchMember(sub.id);
    expect(board().pieces.some((pc) => pc.squadId === sub.id)).toBe(false);
  });

  it('flattens a selected back line and spreads it evenly', () => {
    const s = useBoards.getState();
    const back = board().pieces.filter((pc) => pc.kind === 'player' && pc.team === 'home' && !pc.gk).sort((a, b) => a.x - b.x).slice(0, 4);
    s.movePieces({ [back[0].id]: { x: back[0].x + 3, y: back[0].y } });
    s.select(back.map((pc) => pc.id));
    s.arrangeSelected('line');
    const xs = board().pieces.filter((pc) => back.some((b) => b.id === pc.id)).map((pc) => pc.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-9);
    s.arrangeSelected('spread');
    const ys = board().pieces.filter((pc) => back.some((b) => b.id === pc.id)).map((pc) => pc.y).sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeCloseTo(ys[3] - ys[2], 6);
  });

  it('rescales everything when the pitch size changes', () => {
    const s = useBoards.getState();
    s.addDrawing({ kind: 'arrow', points: [{ x: 52.5, y: 34 }, { x: 70, y: 34 }], color: '#fff', style: 'pass' });
    s.setFormat(7);
    const p = pitchFor(7);
    for (const pc of board().pieces) {
      expect(pc.x).toBeGreaterThanOrEqual(-1);
      expect(pc.x).toBeLessThanOrEqual(p.length + 1);
    }
    expect(board().drawings[0].points[0].x).toBeCloseTo(p.length / 2, 6);
  });
});
