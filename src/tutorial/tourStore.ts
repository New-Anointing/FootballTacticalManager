import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface TourState {
  /** The welcome screen has been answered (shown once, on the first visit). */
  welcomed: boolean;
  /** Tours finished at least once. */
  completed: string[];
  /** The tour in progress and the step being shown. */
  active?: { tourId: string; index: number };
  helpOpen: boolean;

  start: (tourId: string) => void;
  goTo: (index: number) => void;
  /** Leave the tour; `finished` marks it as completed. */
  end: (finished?: boolean) => void;
  setWelcomed: (v: boolean) => void;
  setHelpOpen: (v: boolean) => void;
}

export const useTour = create<TourState>()(
  persist(
    (set, get) => ({
      welcomed: false,
      completed: [],
      helpOpen: false,
      start: (tourId) => set({ active: { tourId, index: 0 }, welcomed: true, helpOpen: false }),
      goTo: (index) => {
        const a = get().active;
        if (a) set({ active: { ...a, index } });
      },
      end: (finished = false) => {
        const a = get().active;
        set({
          active: undefined,
          completed: finished && a && !get().completed.includes(a.tourId) ? [...get().completed, a.tourId] : get().completed,
        });
      },
      setWelcomed: (welcomed) => set({ welcomed }),
      setHelpOpen: (helpOpen) => set({ helpOpen }),
    }),
    {
      name: 'ftm-tutorial-v1',
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
      partialize: (s) => ({ welcomed: s.welcomed, completed: s.completed }),
    },
  ),
);
