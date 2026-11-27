/**
 * Dev tool: tune built-in tactics so they work against the realistic defensive
 * engine. For each step with errors or warnings it searches small changes
 * (release timing, the receiver's finishing position, step duration) and keeps
 * the smallest change that makes that step clean. Prints the tuned specs as JSON.
 *
 *   npx vite-node scripts/tune-presets.ts [preset-key] [specs-module]
 */
import { analyseTactic } from '../src/engine/analysis';
import { pitchFor } from '../src/model/pitch';
import { buildPreset, type F, type PresetSpec, type PresetStep } from '../src/presets/builder';
import { PRESET_SPECS } from '../src/presets/tactics';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function stepProblems(spec: PresetSpec, i: number) {
  const r = analyseTactic(buildPreset({ ...spec, steps: spec.steps.slice(0, i + 1) }));
  const list = r.findings.filter((f) => f.stepIndex === i && (f.severity === 'error' || f.severity === 'warning'));
  return {
    score: list.reduce((s, f) => s + (f.severity === 'error' ? 100 : 10), 0),
    list: list.map((f) => `[${f.severity}] ${f.title}`),
    players: [...new Set(list.flatMap((f) => f.players))],
  };
}

function endOf(step: PresetStep, id: string): F | undefined {
  const m = step.moves?.[id];
  if (!m) return undefined;
  return (Array.isArray(m[0]) ? (m as F[])[(m as F[]).length - 1] : m) as F;
}

/** A player's position (as pitch fractions) at the start of step i. */
function startFraction(spec: PresetSpec, i: number, id: string): F {
  const t = buildPreset({ ...spec, steps: spec.steps.slice(0, i) });
  let pos = t.initial[id];
  for (const st of t.steps) {
    const m = st.moves[id];
    if (m?.length) pos = m[m.length - 1];
  }
  const p = pitchFor(t.format);
  return [round3(pos.x / p.length), round3(pos.y / p.width)];
}

export function tune(spec0: PresetSpec, log = console.error): PresetSpec {
  const spec = clone(spec0);
  for (let i = 0; i < spec.steps.length; i++) {
    const base = stepProblems(spec, i);
    if (base.score === 0) continue;
    const step = spec.steps[i];
    const mover = step.ball?.type === 'shot' ? step.ball.from : step.ball?.to ?? (step.ball?.type === 'dribble' ? step.ball.from : undefined);
    const at0 = step.ball?.at ?? 0.4;
    const wide = process.env.TUNE_WIDE === '1';
    const ats = step.ball && step.ball.type !== 'dribble'
      ? (wide ? [at0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7] : [0, -0.05, 0.1, 0.2, 0.3].map((d) => round3(at0 + d))).filter((v) => v >= 0.05 && v <= 0.8)
      : [at0];
    const ds = [step.d, step.d + 0.3, step.d - 0.2, step.d + 0.6].filter((v) => v >= 0.8);
    const offs = wide ? [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09, 0.12, -0.12] : [0, 0.03, -0.03, 0.06, -0.06, 0.09, -0.09];
    const ref = mover ? endOf(step, mover) ?? startFraction(spec, i, mover) : undefined;
    let best = { score: base.score, cost: 0, step: clone(step) };
    for (const at of ats) for (const d of ds) for (const ox of mover ? offs : [0]) for (const oy of mover ? offs : [0]) {
      const cost = Math.abs(at - at0) * 4 + Math.abs(d - step.d) * 2 + (Math.abs(ox) + Math.abs(oy)) * 30;
      if (best.score === 0 && cost >= best.cost) continue;
      const s2 = clone(step);
      s2.d = Math.round(d * 10) / 10;
      if (s2.ball) s2.ball.at = at;
      if (mover && ref && (ox || oy)) {
        s2.moves = { ...(s2.moves ?? {}), [mover]: [round3(Math.min(0.97, Math.max(0.03, ref[0] + ox))), round3(Math.min(0.97, Math.max(0.03, ref[1] + oy)))] };
      }
      const trial = clone(spec);
      trial.steps[i] = s2;
      const pr = stepProblems(trial, i);
      if (pr.score < best.score || (pr.score === best.score && cost < best.cost)) best = { score: pr.score, cost, step: s2 };
    }
    spec.steps[i] = best.step;
    // Second pass: nudge other attackers involved in the remaining problems
    // (e.g. a runner who finishes on top of a defender).
    for (const id of stepProblems(spec, i).players) {
      // Only adjust runs that are part of the design: players without a scripted run are
      // moved by the support / defence engines and must stay that way.
      if (!id.startsWith('h') || id === mover || !spec.steps[i].moves?.[id]) continue;
      const cur = spec.steps[i];
      const ref2 = endOf(cur, id) ?? startFraction(spec, i, id);
      let best2 = { score: stepProblems(spec, i).score, cost: 0, step: clone(cur) };
      if (best2.score === 0) break;
      for (const ox of offs) for (const oy of offs) {
        if (!ox && !oy) continue;
        const s2 = clone(cur);
        s2.moves = { ...(s2.moves ?? {}), [id]: [round3(Math.min(0.97, Math.max(0.03, ref2[0] + ox))), round3(Math.min(0.97, Math.max(0.03, ref2[1] + oy)))] };
        const trial = clone(spec);
        trial.steps[i] = s2;
        const pr = stepProblems(trial, i);
        const cost = (Math.abs(ox) + Math.abs(oy)) * 30;
        if (pr.score < best2.score || (pr.score === best2.score && pr.score < 1000 && cost < best2.cost && best2.cost > 0)) best2 = { score: pr.score, cost, step: s2 };
      }
      spec.steps[i] = best2.step;
    }
    log(`  ${spec.key} step ${i + 1}: ${base.list.join('; ')}  =>  ${stepProblems(spec, i).list.join('; ') || 'clean'}`);
  }
  return spec;
}

const key = process.argv[2];
const mod = process.argv[3];
const source: PresetSpec[] = mod ? Object.values((await import(mod)).CAND as Record<string, PresetSpec>) : PRESET_SPECS;
const out = source.filter((s) => !key || s.key === key).map((s) => tune(s));
console.log(JSON.stringify(out, null, 1));
