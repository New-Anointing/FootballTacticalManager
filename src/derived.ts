import { analyseTactic, type AnalysisReport } from './engine/analysis';
import { boardStates, type BoardState } from './model/tactic';
import type { Tactic } from './model/types';

// The store replaces the tactic object on every edit, so caching by identity is safe.
const stateCache = new WeakMap<Tactic, BoardState[]>();
const reportCache = new WeakMap<Tactic, AnalysisReport>();

export function statesOf(t: Tactic): BoardState[] {
  let s = stateCache.get(t);
  if (!s) {
    s = boardStates(t);
    stateCache.set(t, s);
  }
  return s;
}

export function reportOf(t: Tactic): AnalysisReport {
  let r = reportCache.get(t);
  if (!r) {
    r = analyseTactic(t);
    reportCache.set(t, r);
  }
  return r;
}
