import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createBoard, lineUp, type ArrowStyle, type Board, type BoardDrawing, type PieceKind, type SquadMember,
} from './model/board';
import { pitchFor } from './model/pitch';
import { uid } from './model/tactic';
import type { TeamSide, Vec } from './model/types';

export type AppMode = 'tactics' | 'board';

export type BoardTool = 'select' | 'place' | 'pen' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'text' | 'erase';

/** What the place tool puts down: a piece type, or a member of the squad. */
export type PlaceItem =
  | { kind: 'player'; team: TeamSide; gk?: boolean }
  | { kind: Exclude<PieceKind, 'player'> }
  | { kind: 'squad'; memberId: string };

interface BoardStore {
  mode: AppMode;
  boards: Board[];
  currentId: string;
  past: Board[];
  future: Board[];
  tool: BoardTool;
  place?: PlaceItem;
  arrowStyle: ArrowStyle;
  color: string;
  /** Selected pieces and drawings (ids). */
  selection: string[];
  presenting: boolean;

  setMode: (m: AppMode) => void;
  newBoard: (opts?: Parameters<typeof createBoard>[0]) => void;
  addBoard: (b: Board) => void;
  openBoard: (id: string) => void;
  duplicateBoard: () => void;
  deleteBoard: (id: string) => void;

  /** Change the current board (with undo history). */
  change: (fn: (b: Board) => void) => void;
  undo: () => void;
  redo: () => void;

  setTool: (t: BoardTool, place?: PlaceItem) => void;
  setArrowStyle: (s: ArrowStyle) => void;
  setColor: (c: string) => void;
  select: (ids: string[]) => void;
  setPresenting: (p: boolean) => void;

  movePieces: (moves: Record<string, Vec>) => void;
  addPiece: (item: PlaceItem, at: Vec) => string | undefined;
  removeSelected: () => void;
  removeItems: (ids: string[]) => void;
  addDrawing: (d: Omit<BoardDrawing, 'id'>) => string;
  moveDrawing: (id: string, by: Vec) => void;
  benchMember: (memberId: string) => void;
  updateMember: (id: string, patch: Partial<SquadMember>) => void;
  addMember: (team: TeamSide) => void;
  removeMember: (id: string) => void;
  lineUpTeam: (side: TeamSide, formation: string) => void;
  clear: (what: 'drawings' | 'players' | 'all') => void;
  /** Switch pitch size; everything on the board is scaled to the new pitch. */
  setFormat: (format: number) => void;
  /** Selected players: form a line across the pitch, or spread them evenly along it. */
  arrangeSelected: (how: 'line' | 'spread') => void;
}

const HISTORY = 80;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function firstBoard(): Board {
  return createBoard({ format: 11, name: 'My board', homeFormation: '4-3-3', awayFormation: '4-4-2' });
}

export const useBoards = create<BoardStore>()(
  persist(
    (set, get) => {
      const current = () => get().boards.find((b) => b.id === get().currentId) ?? get().boards[0];
      const change = (fn: (b: Board) => void) => {
        const cur = current();
        if (!cur) return;
        const next = clone(cur);
        fn(next);
        next.updatedAt = Date.now();
        set({
          boards: get().boards.map((b) => (b.id === cur.id ? next : b)),
          past: [...get().past.slice(-HISTORY), cur],
          future: [],
        });
      };
      const initial = firstBoard();
      return {
        mode: 'tactics',
        boards: [initial],
        currentId: initial.id,
        past: [],
        future: [],
        tool: 'select',
        arrowStyle: 'run',
        color: '#ffd54a',
        selection: [],
        presenting: false,

        setMode: (mode) => set({ mode }),
        newBoard: (opts) => {
          const b = createBoard(opts);
          set({ boards: [b, ...get().boards], currentId: b.id, past: [], future: [], selection: [] });
        },
        addBoard: (b) => set({ boards: [b, ...get().boards], currentId: b.id, past: [], future: [], selection: [], mode: 'board' }),
        openBoard: (id) => set({ currentId: id, past: [], future: [], selection: [], tool: 'select', place: undefined }),
        duplicateBoard: () => {
          const cur = current();
          if (!cur) return;
          const copy = { ...clone(cur), id: uid('board'), name: `${cur.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
          set({ boards: [copy, ...get().boards], currentId: copy.id, past: [], future: [], selection: [] });
        },
        deleteBoard: (id) => {
          let boards = get().boards.filter((b) => b.id !== id);
          if (!boards.length) boards = [firstBoard()];
          const currentId = get().currentId === id ? boards[0].id : get().currentId;
          set({ boards, currentId, past: [], future: [], selection: [] });
        },

        change,
        undo: () => {
          const { past, future } = get();
          const cur = current();
          if (!past.length || !cur) return;
          const prev = past[past.length - 1];
          set({ boards: get().boards.map((b) => (b.id === cur.id ? prev : b)), past: past.slice(0, -1), future: [cur, ...future], selection: [] });
        },
        redo: () => {
          const { past, future } = get();
          const cur = current();
          if (!future.length || !cur) return;
          const next = future[0];
          set({ boards: get().boards.map((b) => (b.id === cur.id ? next : b)), past: [...past, cur], future: future.slice(1), selection: [] });
        },

        setTool: (tool, place) => set({ tool, place: tool === 'place' ? place : undefined, selection: tool === 'select' ? get().selection : [] }),
        setArrowStyle: (arrowStyle) => set({ arrowStyle, tool: 'arrow', place: undefined }),
        setColor: (color) => {
          set({ color });
          // Recolour selected drawings too.
          const ids = new Set(get().selection);
          if (current()?.drawings.some((d) => ids.has(d.id))) {
            change((b) => b.drawings.forEach((d) => ids.has(d.id) && (d.color = color)));
          }
        },
        select: (selection) => set({ selection }),
        setPresenting: (presenting) => set({ presenting }),

        movePieces: (moves) =>
          change((b) => {
            for (const pc of b.pieces) {
              const to = moves[pc.id];
              if (to) {
                pc.x = to.x;
                pc.y = to.y;
              }
            }
          }),
        addPiece: (item, at) => {
          let id: string | undefined;
          change((b) => {
            if (item.kind === 'squad') {
              const m = b.squad.find((x) => x.id === item.memberId);
              if (!m) return;
              const existing = b.pieces.find((pc) => pc.squadId === m.id);
              if (existing) {
                existing.x = at.x;
                existing.y = at.y;
                id = existing.id;
                return;
              }
              id = uid('pc');
              b.pieces.push({ id, kind: 'player', team: m.team, gk: m.gk, squadId: m.id, x: at.x, y: at.y });
              return;
            }
            id = uid('pc');
            if (item.kind === 'player') {
              const used = new Set(b.pieces.filter((pc) => pc.kind === 'player' && pc.team === item.team).map((pc) => pc.number));
              let n = item.gk ? 1 : 2;
              while (used.has(String(n))) n++;
              b.pieces.push({ id, kind: 'player', team: item.team, gk: item.gk, number: String(n), label: item.gk ? 'GK' : '', x: at.x, y: at.y });
            } else {
              b.pieces.push({
                id, kind: item.kind, x: at.x, y: at.y,
                color: item.kind === 'cone' ? '#ff8c1a' : item.kind === 'pole' ? '#ffd54a' : item.kind === 'mannequin' ? '#4dabf7' : undefined,
                angle: item.kind === 'goal' ? 90 : 0,
              });
            }
          });
          return id;
        },
        removeSelected: () => {
          const ids = get().selection;
          if (ids.length) get().removeItems(ids);
        },
        removeItems: (ids) => {
          const del = new Set(ids);
          change((b) => {
            b.pieces = b.pieces.filter((pc) => !del.has(pc.id));
            b.drawings = b.drawings.filter((d) => !del.has(d.id));
          });
          set({ selection: get().selection.filter((id) => !del.has(id)) });
        },
        addDrawing: (d) => {
          const id = uid('dw');
          change((b) => void b.drawings.push({ ...d, id }));
          return id;
        },
        moveDrawing: (id, by) =>
          change((b) => {
            const d = b.drawings.find((x) => x.id === id);
            if (d) d.points = d.points.map((pt) => ({ x: pt.x + by.x, y: pt.y + by.y }));
          }),
        benchMember: (memberId) => change((b) => void (b.pieces = b.pieces.filter((pc) => pc.squadId !== memberId))),
        updateMember: (id, patch) =>
          change((b) => {
            const m = b.squad.find((x) => x.id === id);
            if (m) Object.assign(m, patch);
            if (m && patch.gk !== undefined) b.pieces.forEach((pc) => pc.squadId === id && (pc.gk = patch.gk));
          }),
        addMember: (team) =>
          change((b) => {
            const used = new Set(b.squad.filter((m) => m.team === team).map((m) => m.number));
            let n = 1;
            while (used.has(String(n))) n++;
            b.squad.push({ id: uid('sq'), team, number: String(n), name: '', role: 'SUB' });
          }),
        removeMember: (id) =>
          change((b) => {
            b.squad = b.squad.filter((m) => m.id !== id);
            b.pieces = b.pieces.filter((pc) => pc.squadId !== id);
          }),
        lineUpTeam: (side, formation) => change((b) => lineUp(b, side, formation)),
        clear: (what) =>
          change((b) => {
            if (what !== 'players') b.drawings = [];
            if (what === 'players') b.pieces = b.pieces.filter((pc) => pc.kind !== 'player');
            if (what === 'all') b.pieces = [];
          }),
        setFormat: (format) =>
          change((b) => {
            if (b.format === format) return;
            const from = pitchFor(b.format);
            const to = pitchFor(format);
            const sx = to.length / from.length;
            const sy = to.width / from.width;
            for (const pc of b.pieces) {
              pc.x *= sx;
              pc.y *= sy;
            }
            for (const d of b.drawings) d.points = d.points.map((q) => ({ x: q.x * sx, y: q.y * sy }));
            b.format = format;
          }),
        arrangeSelected: (how) => {
          const ids = new Set(get().selection);
          change((b) => {
            const chosen = b.pieces.filter((pc) => ids.has(pc.id));
            if (chosen.length < 2) return;
            if (how === 'line') {
              const x = chosen.reduce((sum, pc) => sum + pc.x, 0) / chosen.length;
              chosen.forEach((pc) => (pc.x = x));
            } else {
              chosen.sort((a, c) => a.y - c.y);
              const y0 = chosen[0].y;
              const y1 = chosen[chosen.length - 1].y;
              chosen.forEach((pc, i) => (pc.y = y0 + ((y1 - y0) * i) / (chosen.length - 1)));
            }
          });
        },
      };
    },
    {
      name: 'ftm-boards-v1',
      storage: createJSONStorage(() => {
        try {
          return window.localStorage;
        } catch {
          const mem = new Map<string, string>();
          return {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => void mem.set(k, v),
            removeItem: (k: string) => void mem.delete(k),
          };
        }
      }),
      partialize: (s) => ({ mode: s.mode, boards: s.boards, currentId: s.currentId, arrowStyle: s.arrowStyle, color: s.color }),
    },
  ),
);

/** The board being edited. */
export function useCurrentBoard(): Board {
  return useBoards((s) => s.boards.find((b) => b.id === s.currentId) ?? s.boards[0]);
}
