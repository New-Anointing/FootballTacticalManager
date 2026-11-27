import { describe, expect, it } from 'vitest';
import { useTour } from '../tourStore';
import { TOURS } from '../tours';

// The app's component sources, read as text by Vite.
const sources = (import.meta as unknown as { glob: (p: string, o: object) => Record<string, string> }).glob('../../**/*.tsx', {
  query: '?raw', import: 'default', eager: true,
});

/** Every `data-tour` name used in the app's components. */
function tourTargets(): Set<string> {
  const names = new Set<string>();
  for (const text of Object.values(sources)) {
    for (const m of text.matchAll(/data-tour="([\w-]+)"/g)) names.add(m[1]);
  }
  // The tactics toolbar names its tool buttons from the tool list.
  for (const tool of ['select', 'run', 'pass', 'cross', 'dribble', 'shot', 'clearance']) names.add(`tool-${tool}`);
  return names;
}

describe('tutorial', () => {
  it('only points at parts of the app that exist', () => {
    const targets = tourTargets();
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    const missing = TOURS.flatMap((t) =>
      t.steps.flatMap((s) => [s.target, s.fallback]).filter((name): name is string => !!name && !targets.has(name)).map((name) => `${t.id}: ${name}`),
    );
    expect(missing).toEqual([]);
  });

  it('gives every step something to read, and every task a clear instruction', () => {
    for (const t of TOURS) {
      expect(t.steps.length).toBeGreaterThan(3);
      for (const s of t.steps) {
        expect(s.title.length).toBeGreaterThan(3);
        expect(s.body.length).toBeGreaterThan(20);
        if (s.task) expect(s.task.hint.length).toBeGreaterThan(8);
      }
    }
    expect(new Set(TOURS.map((t) => t.id)).size).toBe(TOURS.length);
  });

  it('remembers finished tours and that the welcome screen was answered', () => {
    const s = useTour.getState();
    expect(s.welcomed).toBe(false);
    s.start('board');
    expect(useTour.getState()).toMatchObject({ welcomed: true, active: { tourId: 'board', index: 0 } });
    useTour.getState().goTo(3);
    expect(useTour.getState().active?.index).toBe(3);
    useTour.getState().end(true);
    expect(useTour.getState().active).toBeUndefined();
    expect(useTour.getState().completed).toContain('board');
    // Leaving early doesn't count as finishing.
    useTour.getState().start('overview');
    useTour.getState().end(false);
    expect(useTour.getState().completed).not.toContain('overview');
  });
});
