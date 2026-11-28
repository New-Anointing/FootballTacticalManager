import { describe, expect, it } from 'vitest';
import {
  actionPhase, actionWeight, applyAction, CONTACT_HIP, cycleLength, cycleRate, dribbleAhead, facingFor, gaitBlend, gaitPose, headPitch,
  HIP_HEIGHT, kickLeg, kickWindow, legDrop, legIK, legReach, lookAngles, NECK_LIMIT, CHEST_LIMIT, newPose, type GaitInput,
} from '../body';

const gait = (over: Partial<GaitInput> = {}): GaitInput => ({
  speed: 0, phase: 0, fwd: 1, lat: 0, accel: 0, scale: 1, time: 0, dribble: false, ...over,
});

describe('looking at the ball', () => {
  it('turns the head within the neck limits', () => {
    expect(lookAngles(0.5, 0).neck).toBeCloseTo(0.5);
    expect(lookAngles(3, 0).neck).toBe(NECK_LIMIT);
    expect(lookAngles(-3, 0).neck).toBe(-NECK_LIMIT);
    // Wraps the short way round.
    expect(lookAngles(2 * Math.PI + 0.3, 0).neck).toBeCloseTo(0.3);
  });

  it('turns the chest a little only when standing', () => {
    expect(lookAngles(1, 0).chest).toBe(0);
    const still = lookAngles(1, 1);
    expect(still.chest).toBeGreaterThan(0.2);
    expect(still.chest + still.neck).toBeCloseTo(1);
    expect(lookAngles(3, 1).chest).toBeLessThanOrEqual(CHEST_LIMIT);
  });

  it('looks down at a ball at the feet and up at one in the air', () => {
    expect(headPitch(1.7, 2, 0)).toBeGreaterThan(0.3);
    expect(headPitch(1.7, 3, 4)).toBeLessThan(0);
    expect(headPitch(1.7, 40, 0)).toBeLessThan(0.1);
  });

  it('backpedals or side-steps a few metres facing the ball, but faces the run at pace', () => {
    // Ball straight behind the direction of travel.
    expect(Math.abs(facingFor(0, Math.PI, 1, Math.PI))).toBeCloseTo(Math.PI);
    expect(facingFor(0, Math.PI, 7, 0)).toBeCloseTo(0);
    // In between: half-turned, keeping the side it's already turned to.
    const mid = facingFor(0, Math.PI, 2.7, 1);
    expect(mid).toBeGreaterThan(0.8);
    expect(mid).toBeLessThan(2.4);
    expect(facingFor(0, Math.PI, 2.7, -1)).toBeCloseTo(-mid);
  });
});

describe('gait', () => {
  it('blends walk, jog and sprint by speed', () => {
    const sum = (b: ReturnType<typeof gaitBlend>) => b.still + b.walk + b.jog + b.sprint;
    for (const v of [0, 0.5, 1.5, 2.5, 4, 6, 8, 10]) expect(sum(gaitBlend(v))).toBeCloseTo(1);
    expect(gaitBlend(0).still).toBe(1);
    expect(gaitBlend(1.4).walk).toBeGreaterThan(0.9);
    expect(gaitBlend(4).jog).toBeGreaterThan(0.95);
    expect(gaitBlend(8.5).sprint).toBe(1);
    // Smooth: no jumps between nearby speeds.
    for (let v = 0; v < 10; v += 0.05) {
      const a = gaitBlend(v);
      const b = gaitBlend(v + 0.05);
      expect(Math.abs(a.jog - b.jog) + Math.abs(a.walk - b.walk) + Math.abs(a.sprint - b.sprint)).toBeLessThan(0.15);
    }
  });

  it('takes longer, quicker strides as speed rises, shorter ones sideways or backwards', () => {
    expect(cycleLength(8)).toBeGreaterThan(cycleLength(4));
    expect(cycleRate(8)).toBeGreaterThan(cycleRate(4));
    expect(cycleLength(2, 0, 1)).toBeLessThan(cycleLength(2));
    expect(cycleLength(2, -1, 0)).toBeLessThan(cycleLength(2));
    // About 1.3 cycles a second at a jog, 2 at a sprint.
    expect(cycleRate(4) / (2 * Math.PI)).toBeGreaterThan(1.2);
    expect(cycleRate(8.5) / (2 * Math.PI)).toBeLessThan(2.3);
  });

  it('solves the leg so the ankle lands where it was asked', () => {
    const out = { hip: 0, knee: 0 };
    for (const [z, drop] of [[0.3, 0.8], [-0.35, 0.75], [0, 0.6], [0.1, 0.5]]) {
      legIK(z, drop, out);
      expect(out.knee).toBeGreaterThanOrEqual(0);
      expect(legReach(out.hip, out.knee)).toBeCloseTo(z, 4);
      expect(legDrop(out.hip, out.knee) - 0.05).toBeCloseTo(drop, 4);
    }
  });

  it('keeps the planted foot on the ground and lifts the other through', () => {
    const pose = newPose();
    const soles = () => [0, 1].map((i) => pose.pelvis - legDrop(pose.hip[i], pose.knee[i], pose.hipSide[i]));
    for (const speed of [1.4, 5, 8.5]) {
      let highest = -Infinity;
      let airborne = 0;
      for (let k = 0; k < 80; k++) {
        gaitPose(pose, gait({ speed, phase: (k / 80) * 2 * Math.PI, scale: 1.3 }));
        const [a, b] = soles();
        highest = Math.max(highest, a, b);
        // Never through the grass, and never far off it.
        expect(Math.min(a, b)).toBeGreaterThan(-0.01);
        expect(Math.min(a, b)).toBeLessThan(speed < 2 ? 0.005 : 0.2);
        if (Math.min(a, b) > 0.005) airborne++;
        // Knees only bend one way.
        expect(Math.min(pose.knee[0], pose.knee[1])).toBeGreaterThanOrEqual(0);
      }
      // Walking always has a foot down; running has a moment in the air.
      if (speed < 2) expect(airborne).toBe(0);
      else expect(airborne).toBeGreaterThan(0);
      expect(highest).toBeGreaterThan(speed < 2 ? 0.05 : 0.15);
    }
  });

  it('swings the arms against the legs and bends the elbows more at a sprint', () => {
    const pose = newPose();
    gaitPose(pose, gait({ speed: 5, phase: 0.1 }));
    // Right foot planted in front at the start of the cycle: left arm forward.
    expect(pose.hip[0]).toBeLessThan(0);
    expect(pose.shoulder[1]).toBeLessThan(0);
    expect(pose.shoulder[0]).toBeGreaterThan(0);
    const jogElbow = pose.elbow[0];
    gaitPose(pose, gait({ speed: 9, phase: 0.1 }));
    expect(pose.elbow[0]).toBeGreaterThan(jogElbow);
    expect(pose.lean).toBeGreaterThan(0.12);
    gaitPose(pose, gait({ speed: 0 }));
    expect(pose.lean).toBeLessThan(0.06);
    expect(pose.pelvis).toBeLessThan(HIP_HEIGHT);
  });

  it('leans harder when accelerating', () => {
    const a = newPose();
    const b = newPose();
    gaitPose(a, gait({ speed: 5, accel: 0 }));
    gaitPose(b, gait({ speed: 5, accel: 4 }));
    expect(b.lean).toBeGreaterThan(a.lean);
  });

  it('is continuous in phase (no pop between frames)', () => {
    const a = newPose();
    const b = newPose();
    for (let k = 0; k < 200; k++) {
      const ph = k * 0.07;
      gaitPose(a, gait({ speed: 6, phase: ph }));
      gaitPose(b, gait({ speed: 6, phase: ph + 0.01 }));
      expect(Math.abs(a.hip[0] - b.hip[0])).toBeLessThan(0.05);
      expect(Math.abs(a.knee[1] - b.knee[1])).toBeLessThan(0.08);
    }
  });

  it('dribbles with the ball back at the foot for each touch', () => {
    expect(dribbleAhead(0.95 * 2 * Math.PI, 5)).toBeCloseTo(0, 5);
    expect(dribbleAhead(1.95 * 2 * Math.PI, 5)).toBeGreaterThan(0.6);
    expect(dribbleAhead(2.95 * 2 * Math.PI, 5)).toBeCloseTo(0, 5);
    for (let k = 0; k < 100; k++) expect(dribbleAhead(k * 0.3, 8)).toBeLessThanOrEqual(1.1);
  });
});

describe('kicking', () => {
  it('times the action so contact is at phase 0.5', () => {
    expect(actionPhase('pass', 0)).toBe(0.5);
    expect(actionPhase('pass', -kickWindow('pass').pre)).toBe(0);
    expect(actionPhase('shot', kickWindow('shot').post)).toBe(1);
    expect(actionPhase('pass', -1)).toBeNull();
    expect(actionPhase('pass', 1)).toBeNull();
  });

  it('swings shots and clearances longer and harder than passes, crosses in between', () => {
    const span = (k: 'pass' | 'cross' | 'shot' | 'clearance') => kickWindow(k).pre + kickWindow(k).post;
    expect(span('shot')).toBeGreaterThan(span('cross'));
    expect(span('clearance')).toBeGreaterThan(span('cross'));
    expect(span('cross')).toBeGreaterThan(span('pass'));
    const back = (k: 'pass' | 'cross' | 'shot') => Math.max(...Array.from({ length: 101 }, (_, i) => kickLeg(k, i / 100).hip));
    expect(back('shot')).toBeGreaterThan(back('cross'));
    expect(back('cross')).toBeGreaterThan(back('pass'));
  });

  it('meets the ball at the release, with the foot moving fastest there', () => {
    for (const kind of ['pass', 'cross', 'shot', 'clearance'] as const) {
      expect(kickLeg(kind, 0.5).hip).toBeCloseTo(CONTACT_HIP);
      // Back-swing before contact, follow-through after.
      expect(kickLeg(kind, 0.3).hip).toBeGreaterThan(0);
      expect(kickLeg(kind, 0.7).hip).toBeLessThan(CONTACT_HIP);
      let fastest = 0;
      let at = 0;
      const { pre, post } = kickWindow(kind);
      for (let i = 1; i < 400; i++) {
        const p0 = (i - 1) / 400;
        const p1 = i / 400;
        const secs = (p1 < 0.5 ? 2 * pre : 2 * post) / 400;
        const v = Math.abs(kickLeg(kind, p1).hip - kickLeg(kind, p0).hip) / secs;
        if (v > fastest) {
          fastest = v;
          at = p1;
        }
      }
      expect(Math.abs(at - 0.5)).toBeLessThan(0.02);
      // Neutral at both ends so it blends from and back into the run.
      expect(Math.abs(kickLeg(kind, 0).hip)).toBeLessThan(1e-6);
      expect(Math.abs(kickLeg(kind, 1).hip)).toBeLessThan(0.02);
    }
  });

  it('blends in and out, and stands on the planted foot', () => {
    expect(actionWeight(0)).toBe(0);
    expect(actionWeight(0.5)).toBe(1);
    expect(actionWeight(1)).toBe(0);
    const pose = newPose();
    gaitPose(pose, gait({ speed: 3, phase: 1 }));
    expect(applyAction(pose, { kind: 'shot', phase: 0.5 })).toBe(1);
    expect(pose.hip[0]).toBeCloseTo(CONTACT_HIP);
    const planted = pose.pelvis - legDrop(pose.hip[1], pose.knee[1], pose.hipSide[1]);
    expect(Math.abs(planted)).toBeLessThan(1e-6);
    // The kicking foot meets the ball just above the grass, in front of the body.
    const foot = pose.pelvis - legDrop(pose.hip[0], pose.knee[0], pose.hipSide[0]);
    expect(foot).toBeGreaterThan(-0.02);
    expect(foot).toBeLessThan(0.12);
    expect(legReach(pose.hip[0], pose.knee[0])).toBeGreaterThan(0.2);
    expect(applyAction(pose, { kind: 'dribble', phase: 0.5 })).toBe(0);
    expect(applyAction(pose, undefined)).toBe(0);
  });
});
