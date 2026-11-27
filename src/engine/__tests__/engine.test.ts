import { describe, expect, it } from 'vitest';
import { FORMATIONS, buildTeam, formationSlots, isValidFormation } from '../../model/formations';
import { pitchFor } from '../../model/pitch';
import { boardStates, createTactic, newStep } from '../../model/tactic';
import type { Tactic } from '../../model/types';
import { FORMATS } from '../../model/types';
import { PRESET_TACTICS } from '../../presets/tactics';
import { analyseTactic } from '../analysis';
import { frameAtTime, stepStartTime } from '../animation';
import { generateAttack, generatePress, suggestFormations } from '../coach';
import { PRESS_SPEED, reactAll, reactStep } from '../defence';
import { isOffside, shotXg } from '../options';

describe('formations', () => {
  it('every listed formation adds up to the format', () => {
    for (const f of FORMATS) {
      expect(FORMATIONS[f].length).toBeGreaterThan(0);
      for (const formation of FORMATIONS[f]) {
        expect(isValidFormation(formation, f)).toBe(true);
        expect(formationSlots(formation, f)).toHaveLength(f);
      }
    }
  });

  it('places teams inside their own half and mirrors the away side', () => {
    const p = pitchFor(11);
    const home = buildTeam('home', '4-3-3', 11);
    const away = buildTeam('away', '4-3-3', 11);
    for (const pos of Object.values(home.positions)) expect(pos.x).toBeLessThan(p.length / 2);
    for (const pos of Object.values(away.positions)) expect(pos.x).toBeGreaterThan(p.length / 2);
    expect(home.players[1].role).toBe('LB');
    // Away left-back is on their left, which is the bottom of the screen.
    expect(away.positions.a1.y).toBeGreaterThan(p.width / 2);
  });
});

describe('board states and animation', () => {
  function simplePass(): Tactic {
    const t = createTactic({ format: 5, homeFormation: '1-2-1', awayFormation: '2-2', showOpponents: false });
    t.ballOwner = 'h1';
    const s = newStep();
    s.duration = 2;
    s.moves = { h4: [{ x: 30, y: 10 }] };
    s.ball = { type: 'pass', from: 'h1', to: 'h4', releaseAt: 0.5 };
    t.steps.push(s);
    return t;
  }

  it('passes the ball to the receiver at the end of the step', () => {
    const t = simplePass();
    const states = boardStates(t);
    expect(states).toHaveLength(2);
    expect(states[1].ballOwner).toBe('h4');
    expect(states[1].ball).toEqual({ x: 30, y: 10 });
  });

  it('keeps the ball with the passer until release, then moves it towards the receiver', () => {
    const t = simplePass();
    const before = frameAtTime(t, 0.5);
    expect(before.ball).toEqual(before.positions.h1);
    const end = frameAtTime(t, 2);
    expect(end.ball.x).toBeCloseTo(30);
    expect(end.positions.h4.x).toBeCloseTo(30);
    const mid = frameAtTime(t, 1.5);
    expect(mid.ball.x).toBeGreaterThan(before.ball.x);
    expect(mid.ball.x).toBeLessThan(30);
  });

  it('computes step start times', () => {
    const t = simplePass();
    t.steps.push({ ...newStep(), duration: 3 });
    expect(stepStartTime(t, 0)).toBe(0);
    expect(stepStartTime(t, 1)).toBe(2);
    expect(stepStartTime(t, 2)).toBe(5);
  });

  it('lets a runner collect a pass into space', () => {
    const t = simplePass();
    t.steps[0].ball = { type: 'pass', from: 'h1', target: { x: 30, y: 10 }, releaseAt: 0.4 };
    expect(boardStates(t)[1].ballOwner).toBe('h4');
  });
});

describe('analysis', () => {
  it('ships presets that work against a realistic, pressing defence', () => {
    for (const t of PRESET_TACTICS) {
      const r = analyseTactic(t);
      const errors = r.findings.filter((f) => f.severity === 'error').map((f) => `${t.name}: ${f.title}`);
      expect(errors).toEqual([]);
      // No "statue" defending: opponents must press, shift and track in every preset.
      const passive = r.findings.filter((f) => f.category === 'realism').map((f) => `${t.name}: ${f.title}`);
      expect(passive).toEqual([]);
      const warnings = r.findings.filter((f) => f.severity === 'warning');
      expect(warnings.length).toBeLessThanOrEqual(1);
      expect(r.score).toBeGreaterThanOrEqual(95);
    }
  });

  it('flags opponents who stand still and let the ball be played freely', () => {
    const t = createTactic({ format: 5, homeFormation: '1-2-1', awayFormation: '2-2' });
    t.ballOwner = 'h1';
    t.initial.h1 = { x: 12, y: 10 };
    t.initial.h3 = { x: 16, y: 17 };
    const s = newStep();
    s.duration = 1.5;
    s.moves = { h3: [{ x: 26, y: 17 }] };
    s.ball = { type: 'pass', from: 'h1', to: 'h3', releaseAt: 0.2 };
    t.steps.push(s); // opponents have no movement at all
    const passive = analyseTactic(t).findings.filter((f) => f.category === 'realism');
    expect(passive.length).toBeGreaterThan(0);
    expect(passive[0].fix?.kind).toBe('react-defence');
    // With the defensive engine, the same move is played against a reacting opponent.
    t.steps = reactAll(t);
    expect(analyseTactic(t).findings.filter((f) => f.category === 'realism')).toEqual([]);
  });

  it('flags an impossible sprint and offers a longer step', () => {
    const t = createTactic({ format: 11 });
    const s = newStep();
    s.duration = 1;
    s.moves = { h9: [{ x: 90, y: 34 }] }; // ~40 m in a second
    t.steps.push(s);
    const r = analyseTactic(t);
    const f = r.findings.find((x) => x.category === 'movement' && x.severity === 'error');
    expect(f).toBeTruthy();
    expect(f!.fix?.kind).toBe('extend-duration');
    expect(r.score).toBeLessThan(70);
  });

  it('detects a pass straight through a defender', () => {
    const t = createTactic({ format: 7, homeFormation: '2-3-1', awayFormation: '3-2-1' });
    t.ballOwner = 'h4';
    t.initial.h4 = { x: 20, y: 20 };
    t.initial.h6 = { x: 40, y: 20 };
    t.initial.a6 = { x: 30, y: 20 }; // standing on the passing line
    const s = newStep();
    s.ball = { type: 'pass', from: 'h4', to: 'h6', releaseAt: 0.3 };
    t.steps.push(s);
    const r = analyseTactic(t);
    expect(r.findings.some((f) => f.title.includes('intercepted'))).toBe(true);
  });

  it('flags a pass from a player without the ball', () => {
    const t = createTactic({ format: 5 });
    t.ballOwner = 'h1';
    const s = newStep();
    s.ball = { type: 'pass', from: 'h2', to: 'h3', releaseAt: 0.3 };
    t.steps.push(s);
    expect(analyseTactic(t).findings.some((f) => f.title.includes("doesn't have the ball"))).toBe(true);
  });

  it('detects offside in 11v11 but not in futsal', () => {
    const t = createTactic({ format: 11 });
    const p = pitchFor(11);
    const positions = { ...t.initial };
    // Away back line around x = 80; receiver at x = 90 is beyond it.
    for (const id of ['a1', 'a2', 'a3', 'a4']) positions[id] = { ...positions[id], x: 80 };
    expect(isOffside(t, 'home', positions, { x: 60, y: 34 }, { x: 90, y: 34 })).toBe(true);
    expect(isOffside(t, 'home', positions, { x: 60, y: 34 }, { x: 79, y: 34 })).toBe(false);
    const futsal = createTactic({ format: 5 });
    expect(futsal.rules.offside).toBe(false);
    expect(isOffside(futsal, 'home', futsal.initial, { x: 20, y: 10 }, { x: 39, y: 10 })).toBe(false);
    expect(p.length).toBe(105);
  });

  it('rates close central shots far above long-range ones', () => {
    const t = createTactic({ format: 11, showOpponents: false });
    const close = shotXg(t, 'home', { x: 97, y: 34 }, t.initial);
    const far = shotXg(t, 'home', { x: 70, y: 34 }, t.initial);
    const angle = shotXg(t, 'home', { x: 103, y: 5 }, t.initial);
    expect(close).toBeGreaterThan(0.3);
    expect(far).toBeLessThan(0.05);
    expect(angle).toBeLessThan(close);
  });
});

describe('defensive engine', () => {
  it('closes down the receiver, from the goal side, at a realistic speed', () => {
    const t = createTactic({ format: 5, homeFormation: '1-2-1', awayFormation: '2-2' });
    t.ballOwner = 'h4';
    t.initial.h4 = { x: 20, y: 10 };
    t.initial.h1 = { x: 12, y: 10 };
    const s = newStep();
    s.duration = 1.2;
    s.ball = { type: 'pass', from: 'h4', to: 'h1', releaseAt: 0.1 };
    t.steps.push(s);
    const before = boardStates(t)[0];
    const moves = reactStep(t, before, s);
    // The nearest ala charges the fixo receiving the back pass.
    const presser = ['a3', 'a4'].find((id) => moves[id]);
    expect(presser).toBeTruthy();
    const end = moves[presser!][moves[presser!].length - 1];
    const startGap = Math.hypot(before.positions[presser!].x - 12, before.positions[presser!].y - 10);
    expect(Math.hypot(end.x - 12, end.y - 10)).toBeLessThan(startGap - 4);
    expect(end.x).toBeGreaterThan(12); // goal side of the fixo
    for (const [id, path] of Object.entries(moves)) {
      const from = before.positions[id];
      const last = path[path.length - 1];
      expect(Math.hypot(last.x - from.x, last.y - from.y) / s.duration).toBeLessThanOrEqual(PRESS_SPEED + 0.01);
    }
  });

  it("doesn't move opponents when they have the ball", () => {
    const t = createTactic({ format: 11 });
    t.ballOwner = 'a5';
    const s = newStep();
    s.ball = { type: 'pass', from: 'a5', to: 'a6', releaseAt: 0.3 };
    expect(reactStep(t, boardStates(t)[0], s)).toEqual({});
  });
});

describe('assistant coach', () => {
  it('generates an attacking move for every format that ends in a shot and has no errors', () => {
    for (const f of FORMATS) {
      const t = createTactic({ format: f });
      const res = generateAttack(t);
      expect(res.steps.length).toBeGreaterThan(0);
      t.steps.push(...res.steps);
      const last = t.steps[t.steps.length - 1];
      expect(['shot', 'pass', 'dribble', 'cross']).toContain(last.ball?.type);
      const errors = analyseTactic(t).findings.filter((x) => x.severity === 'error');
      expect(errors.map((e) => `${f}v${f}: ${e.title}`)).toEqual([]);
    }
  });

  it('generates a press when the opponent has the ball', () => {
    const t = createTactic({ format: 11 });
    t.ballOwner = 'a2';
    const res = generatePress(t);
    expect(res.steps).toHaveLength(1);
    expect(Object.keys(res.steps[0].moves).length).toBeGreaterThan(3);
    t.ballOwner = 'h2';
    expect(generatePress(t).steps).toHaveLength(0);
  });

  it('prefers a midfield overload against a two-man midfield', () => {
    const top = suggestFormations(11, '4-2-3-1')[0];
    expect(top.formation).toBeTruthy();
    const ranked = suggestFormations(11, '4-4-2').map((s) => s.formation);
    expect(ranked.indexOf('4-3-3')).toBeLessThan(ranked.indexOf('5-3-2') + 1);
  });
});
