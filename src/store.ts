import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Fix } from './engine/analysis';
import { applyFormation, isValidFormation } from './model/formations';
import { cloneTactic, createTactic, newStep, type NewTacticOptions } from './model/tactic';
import type { BallAction, Step, Tactic, TeamSide, Vec } from './model/types';
import { PRESET_TACTICS } from './presets/tactics';

export type Tool = 'select' | 'run' | 'pass' | 'cross' | 'shot' | 'dribble' | 'clearance';
export type PanelTab = 'edit' | 'analysis' | 'coach';

export interface Settings {
  homeColor: string;
  awayColor: string;
  apiKey: string;
  showGhosts: boolean;
  showLabels: boolean;
}

interface State {
  library: Tactic[];
  current: Tactic;
  /** -1 = Setup frame, otherwise index of the step being edited. */
  stepIndex: number;
  selectedPlayer?: string;
  /** Player whose pass / run is being drawn with the active tool. */
  toolSource?: string;
  tool: Tool;
  tab: PanelTab;
  playing: boolean;
  /** True while the board shows the animation (playing or scrubbing) instead of the editor. */
  playbackView: boolean;
  time: number;
  speed: number;
  loop: boolean;
  presenting: boolean;
  highlight: string[];
  settings: Settings;
  past: Tactic[];
  future: Tactic[];
  dirty: boolean;

  // Library
  newTactic: (opts: NewTacticOptions) => void;
  openTactic: (id: string) => void;
  saveCurrent: () => void;
  duplicateCurrent: () => void;
  deleteTactic: (id: string) => void;
  importTactics: (list: Tactic[]) => number;

  // Editing
  update: (fn: (t: Tactic) => void) => void;
  undo: () => void;
  redo: () => void;
  setStepIndex: (i: number) => void;
  addStep: () => void;
  deleteStep: (i: number) => void;
  moveStep: (i: number, dir: -1 | 1) => void;
  appendSteps: (steps: Step[]) => void;
  setPlayerPosition: (id: string, pos: Vec) => void;
  addWaypoint: (id: string, pos: Vec) => void;
  clearMove: (id: string) => void;
  setBallAction: (a: BallAction | undefined) => void;
  setBallStart: (pos: Vec, owner?: string) => void;
  setFormation: (side: TeamSide, formation: string) => void;
  applyFix: (fix: Fix) => void;

  // UI
  setTool: (t: Tool) => void;
  setToolSource: (id?: string) => void;
  selectPlayer: (id?: string) => void;
  setTab: (t: PanelTab) => void;
  setPlaying: (p: boolean) => void;
  setPlaybackView: (v: boolean) => void;
  setTime: (t: number) => void;
  setSpeed: (s: number) => void;
  setLoop: (l: boolean) => void;
  setPresenting: (p: boolean) => void;
  setHighlight: (ids: string[]) => void;
  setSettings: (s: Partial<Settings>) => void;
}

const HISTORY = 60;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function initialTactic(): Tactic {
  return clone(PRESET_TACTICS.find((t) => t.id === 'preset_11v11-buildup') ?? PRESET_TACTICS[0]);
}

export const useStore = create<State>()(
  persist(
    (set, get) => {
      /** Apply a change to the current tactic with undo history; built-in presets become a personal copy. */
      const mutate = (fn: (t: Tactic) => void) => {
        const { current, past } = get();
        const next = clone(current);
        if (next.builtIn) {
          next.builtIn = false;
          next.id = `tactic_${Math.random().toString(36).slice(2, 9)}`;
          next.name = `${current.name} (my copy)`;
          next.createdAt = Date.now();
        }
        fn(next);
        next.updatedAt = Date.now();
        set({ current: next, past: [...past.slice(-HISTORY), current], future: [], dirty: true, playbackView: false, playing: false });
        get().saveCurrent();
      };

      return {
        library: [],
        current: initialTactic(),
        stepIndex: -1,
        tool: 'select',
        tab: 'edit',
        playing: false,
        playbackView: false,
        time: 0,
        speed: 1,
        loop: false,
        presenting: false,
        highlight: [],
        settings: { homeColor: '#f5c518', awayColor: '#e5484d', apiKey: '', showGhosts: true, showLabels: true },
        past: [],
        future: [],
        dirty: false,

        newTactic: (opts) => {
          const t = createTactic(opts);
          set({ current: t, stepIndex: -1, past: [], future: [], time: 0, playing: false, playbackView: false, selectedPlayer: undefined, highlight: [] });
          get().saveCurrent();
        },
        openTactic: (id) => {
          const t = get().library.find((x) => x.id === id) ?? PRESET_TACTICS.find((x) => x.id === id);
          if (!t) return;
          set({ current: clone(t), stepIndex: -1, past: [], future: [], time: 0, playing: false, playbackView: false, selectedPlayer: undefined, highlight: [], dirty: false });
        },
        saveCurrent: () => {
          const { current, library } = get();
          if (current.builtIn) return;
          const idx = library.findIndex((x) => x.id === current.id);
          const next = [...library];
          if (idx >= 0) next[idx] = current;
          else next.unshift(current);
          set({ library: next, dirty: false });
        },
        duplicateCurrent: () => {
          const copy = cloneTactic(get().current, { name: `${get().current.name} (copy)` });
          set({ current: copy, past: [], future: [] });
          get().saveCurrent();
        },
        deleteTactic: (id) => {
          const library = get().library.filter((x) => x.id !== id);
          set({ library });
          if (get().current.id === id) set({ current: library[0] ? clone(library[0]) : initialTactic(), stepIndex: -1, past: [], future: [] });
        },
        importTactics: (list) => {
          const valid = list.filter((t) => t && Array.isArray(t.players) && Array.isArray(t.steps) && t.initial);
          const imported = valid.map((t) => cloneTactic(t, { name: t.name }));
          set({ library: [...imported, ...get().library] });
          if (imported[0]) set({ current: clone(imported[0]), stepIndex: -1, past: [], future: [] });
          return imported.length;
        },

        update: (fn) => {
          set({ playbackView: false, playing: false });
          mutate(fn);
        },
        undo: () => {
          const { past, current, future } = get();
          const prev = past[past.length - 1];
          if (!prev) return;
          set({ current: prev, past: past.slice(0, -1), future: [current, ...future], stepIndex: Math.min(get().stepIndex, prev.steps.length - 1) });
          get().saveCurrent();
        },
        redo: () => {
          const { past, current, future } = get();
          const next = future[0];
          if (!next) return;
          set({ current: next, past: [...past, current], future: future.slice(1) });
          get().saveCurrent();
        },
        setStepIndex: (i) =>
          set({ stepIndex: Math.max(-1, Math.min(i, get().current.steps.length - 1)), toolSource: undefined, playing: false, playbackView: false }),
        addStep: () => {
          const at = get().stepIndex + 1;
          mutate((t) => {
            t.steps.splice(at, 0, newStep());
          });
          set({ stepIndex: at });
        },
        deleteStep: (i) => {
          mutate((t) => {
            t.steps.splice(i, 1);
          });
          set({ stepIndex: Math.min(i, get().current.steps.length - 1) });
        },
        moveStep: (i, dir) => {
          const j = i + dir;
          if (j < 0 || j >= get().current.steps.length) return;
          mutate((t) => {
            const [s] = t.steps.splice(i, 1);
            t.steps.splice(j, 0, s);
          });
          set({ stepIndex: j });
        },
        appendSteps: (steps) => {
          if (!steps.length) return;
          const start = get().current.steps.length;
          mutate((t) => {
            t.steps.push(...clone(steps));
          });
          set({ stepIndex: start });
        },
        setPlayerPosition: (id, pos) => {
          const i = get().stepIndex;
          mutate((t) => {
            if (i < 0) {
              t.initial[id] = pos;
              return;
            }
            const step = t.steps[i];
            const path = step.moves[id];
            if (path && path.length) path[path.length - 1] = pos;
            else step.moves[id] = [pos];
          });
        },
        addWaypoint: (id, pos) => {
          let i = get().stepIndex;
          if (i < 0) {
            if (get().current.steps.length === 0) get().addStep();
            i = Math.max(0, get().stepIndex);
            set({ stepIndex: i });
          }
          mutate((t) => {
            const step = t.steps[i];
            step.moves[id] = [...(step.moves[id] ?? []), pos];
          });
        },
        clearMove: (id) => {
          const i = get().stepIndex;
          if (i < 0) return;
          mutate((t) => {
            delete t.steps[i].moves[id];
          });
        },
        setBallAction: (a) => {
          let i = get().stepIndex;
          if (i < 0) {
            if (get().current.steps.length === 0) get().addStep();
            i = Math.max(0, get().stepIndex);
            set({ stepIndex: i });
          }
          mutate((t) => {
            t.steps[i].ball = a;
          });
        },
        setBallStart: (pos, owner) =>
          mutate((t) => {
            t.ballOwner = owner;
            t.ballStart = pos;
          }),
        setFormation: (side, formation) => {
          const t0 = get().current;
          if (!isValidFormation(formation, t0.format)) return;
          mutate((t) => {
            const built = applyFormation(t.players, side, formation, t.format);
            t.players = [...t.players.filter((p) => p.team !== side), ...built.players].sort(
              (a, b) => (a.team === b.team ? 0 : a.team === 'home' ? -1 : 1),
            );
            Object.assign(t.initial, built.positions);
            if (side === 'home') t.homeFormation = formation;
            else t.awayFormation = formation;
          });
        },
        applyFix: (fix) => {
          mutate((t) => {
            const step = t.steps[fix.stepIndex];
            if (!step) return;
            if (fix.kind === 'extend-duration') step.duration = Math.max(step.duration, fix.duration);
            if (fix.kind === 'set-release' && step.ball) step.ball.releaseAt = Math.round(fix.releaseAt * 100) / 100;
            if (fix.kind === 'reroute-pass' && step.ball) {
              step.ball.to = fix.to;
              step.ball.target = undefined;
            }
          });
          set({ stepIndex: fix.stepIndex });
        },

        setTool: (tool) => set({ tool, toolSource: undefined }),
        setToolSource: (toolSource) => set({ toolSource }),
        selectPlayer: (selectedPlayer) => set({ selectedPlayer }),
        setTab: (tab) => set({ tab }),
        setPlaying: (playing) => set(playing ? { playing, playbackView: true } : { playing }),
        setPlaybackView: (playbackView) => set({ playbackView, playing: playbackView ? get().playing : false }),
        setTime: (time) => set({ time }),
        setSpeed: (speed) => set({ speed }),
        setLoop: (loop) => set({ loop }),
        setPresenting: (presenting) =>
          set(presenting ? { presenting, time: 0, playing: true, playbackView: true } : { presenting, playing: false }),
        setHighlight: (highlight) => set({ highlight }),
        setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
      };
    },
    {
      name: 'ftm-store-v1',
      storage: createJSONStorage(() => {
        try {
          return window.localStorage;
        } catch {
          // Storage can be unavailable (private mode); fall back to memory only.
          const mem = new Map<string, string>();
          return {
            getItem: (k: string) => mem.get(k) ?? null,
            setItem: (k: string, v: string) => void mem.set(k, v),
            removeItem: (k: string) => void mem.delete(k),
          };
        }
      }),
      partialize: (s) => ({ library: s.library, settings: s.settings, current: s.current }),
    },
  ),
);
