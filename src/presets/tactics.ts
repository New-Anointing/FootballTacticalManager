import type { Tactic } from '../model/types';
import { buildPreset, type PresetSpec } from './builder';

// Built-in tactics. Player ids follow formation order: h0/a0 = goalkeeper, then
// each line from defence to attack, left to right from the team's own point of
// view. Coordinates are fractions of the pitch; home attacks towards x = 1.
//
// Opponents are NOT scripted: the defensive engine (engine/defence.ts) makes
// them press, hold a zonal shape, track runners and recover, at realistic
// speeds. Every preset is designed and tuned (scripts/tune-presets.ts) to work
// against that active defence, and a test keeps it that way.

export const PRESET_SPECS: PresetSpec[] = [
  {
    key: '4v4-rotation',
    name: '4v4 Rotation and third-man run',
    description: 'Small-sided pattern: the wingers rotate to drag markers, the fixo finds the free player running in behind.',
    format: 4, phase: 'attack', home: '1-2', away: '1-2', ballOwner: 'h1',
    setup: {
      h0: [0.05, 0.5], h1: [0.3, 0.5], h2: [0.55, 0.15], h3: [0.55, 0.85], a0: [0.96, 0.5], a1: [0.8, 0.5],
      a2: [0.62, 0.68], a3: [0.62, 0.32],
    },
    steps: [
      {
        d: 1.6, note: 'Fixo opens play to the right winger, who checks back to receive.', outcome: 'retain',
        moves: { h3: [0.5, 0.82], h1: [0.36, 0.5], h2: [0.62, 0.15] },
        ball: { type: 'pass', from: 'h1', to: 'h3', at: 0.3 },
      },
      {
        d: 1.6, note: 'Winger lays it back first time; the far winger starts a diagonal run behind.', outcome: 'retain',
        moves: { h1: [0.42, 0.55], h2: [0.74, 0.3] },
        ball: { type: 'pass', from: 'h3', to: 'h1', at: 0.25 },
      },
      {
        d: 1.6, note: 'Third-man ball: the fixo slides it into the runner behind the last defender.', outcome: 'progress',
        moves: { h2: [0.82, 0.34], h3: [0.66, 0.78] },
        ball: { type: 'pass', from: 'h1', to: 'h2', at: 0.3 },
      },
      {
        d: 1.4, note: 'Runner carries into the area.', outcome: 'chance',
        moves: { h2: [0.9, 0.39] },
        ball: { type: 'dribble', from: 'h2' },
      },
      {
        d: 1, note: 'Finish across the keeper.', outcome: 'goal',
        moves: { h2: [0.96, 0.39] },
        ball: { type: 'shot', from: 'h2', target: [1, 0.55], at: 0.4 },
      },
    ],
  },
  {
    key: '5v5-kickoff',
    name: 'Futsal kick-off: beat the press',
    description: 'Kick-off against a pressing 2-2. Pivo plays back to draw both alas, the fixo plays first time down the line, then a pivo wall pass releases the ala for a back-post finish.',
    format: 5, phase: 'set-piece', home: '1-2-1', away: '2-2', ballOwner: 'h4',
    setup: {
      h4: [0.5, 0.5], h1: [0.3, 0.5], h2: [0.44, 0.15], h3: [0.44, 0.85],
    },
    steps: [
      {
        d: 1.2, note: 'Pivo plays back to the fixo. Both alas press; our right ala drops deep and wide.', outcome: 'retain',
        moves: { h4: [0.6, 0.5], h2: [0.48, 0.12], h3: [0.38, 0.9] },
        ball: { type: 'pass', from: 'h4', to: 'h1', at: 0.1 },
      },
      {
        d: 1.3, note: 'Fixo plays first time to the right ala, away from the press. The pivo drifts into the right channel.', outcome: 'retain',
        moves: { h4: [0.62, 0.8], h2: [0.56, 0.15] },
        ball: { type: 'pass', from: 'h1', to: 'h3', at: 0.1 },
      },
      {
        d: 1.1, note: 'Shown down the line, the ala plays it first time into the pivo.', outcome: 'progress',
        moves: { h4: [0.66, 0.88], h3: [0.46, 0.74], h2: [0.62, 0.3] },
        ball: { type: 'pass', from: 'h3', to: 'h4', at: 0.1 },
      },
      {
        d: 1.3, note: 'Pivo holds it up under pressure, then lays it off inside to the ala.', outcome: 'retain',
        moves: { h3: [0.58, 0.61], h2: [0.7, 0.2] },
        ball: { type: 'pass', from: 'h4', to: 'h3', at: 0.38 },
      },
      {
        d: 1.3, note: 'Third man: the ball goes in behind for the left ala.', outcome: 'chance',
        moves: { h2: [0.86, 0.26], h4: [0.8, 0.72] },
        ball: { type: 'pass', from: 'h3', to: 'h2', at: 0.2 },
      },
      {
        d: 1.5, note: 'Square ball to the pivo arriving at the back post.', outcome: 'chance',
        moves: { h4: [0.9, 0.56] },
        ball: { type: 'pass', from: 'h2', to: 'h4', at: 0.3 },
      },
      {
        d: 0.8, note: 'First-time finish.', outcome: 'goal',
        ball: { type: 'shot', from: 'h4', target: [1, 0.42], at: 0.1 },
      },
    ],
  },
  {
    key: '6v6-pattern',
    name: '6v6 Passing pattern (unopposed)',
    description: 'Unopposed rehearsal pattern: up-back-through combination to practise timing of runs without opponents.',
    format: 6, phase: 'attack', home: '2-1-2', away: '2-1-2', showOpponents: false, ballOwner: 'h1',
    steps: [
      {
        d: 1.8, note: 'Centre-back plays into the midfielder.', outcome: 'retain',
        moves: { h3: [0.36, 0.45] },
        ball: { type: 'pass', from: 'h1', to: 'h3', at: 0.3 },
      },
      {
        d: 1.8, note: 'Up: midfielder plays up to the striker, who drops in.', outcome: 'progress',
        moves: { h4: [0.52, 0.35], h5: [0.62, 0.78] },
        ball: { type: 'pass', from: 'h3', to: 'h4', at: 0.3 },
      },
      {
        d: 1.8, note: 'Back: set back to the midfielder arriving.', outcome: 'retain',
        moves: { h3: [0.46, 0.45], h5: [0.7, 0.68] },
        ball: { type: 'pass', from: 'h4', to: 'h3', at: 0.3 },
      },
      {
        d: 2, note: 'Through: ball in behind for the far striker.', outcome: 'chance',
        moves: { h5: [0.88, 0.52] },
        ball: { type: 'pass', from: 'h3', to: 'h5', at: 0.35 },
      },
      {
        d: 1, note: 'Finish.', outcome: 'goal',
        ball: { type: 'shot', from: 'h5', at: 0.2 },
      },
    ],
  },
  {
    key: '7v7-overlap',
    name: '7v7 Overlap and cutback',
    description: 'Right-sided combination: the centre-back overlaps, gets to the byline and cuts back for the late midfield runner.',
    format: 7, phase: 'attack', home: '2-3-1', away: '3-2-1', ballOwner: 'h5',
    setup: {
      h0: [0.06, 0.5], h1: [0.3, 0.35], h2: [0.36, 0.75], h3: [0.55, 0.2], h4: [0.48, 0.5], h5: [0.56, 0.86],
      h6: [0.72, 0.5], a0: [0.96, 0.5], a3: [0.8, 0.28], a2: [0.8, 0.5], a1: [0.78, 0.74], a5: [0.64, 0.38],
      a4: [0.65, 0.7], a6: [0.54, 0.58],
    },
    steps: [
      {
        d: 2.5, note: 'Right midfielder plays inside; the right centre-back starts the overlap.', outcome: 'retain',
        moves: { h2: [0.6, 0.92], h4: [0.48, 0.46] },
        ball: { type: 'pass', from: 'h5', to: 'h4', at: 0.3 },
      },
      {
        d: 2.5, note: 'Ball out wide into the overlapping run; the midfielder drifts inside.', outcome: 'progress',
        moves: { h2: [0.76, 0.93], h5: [0.68, 0.72], h6: [0.82, 0.45] },
        ball: { type: 'pass', from: 'h4', to: 'h2', at: 0.3 },
      },
      {
        d: 2, note: 'Overlapper drives to the byline; striker attacks the near post to take a defender away.', outcome: 'progress',
        moves: { h2: [0.92, 0.86], h6: [0.92, 0.46], h5: [0.82, 0.58], h4: [0.66, 0.5] },
        ball: { type: 'dribble', from: 'h2' },
      },
      {
        d: 1.4, note: 'Cutback to the penalty spot for the late runner.', outcome: 'chance',
        moves: { h5: [0.85, 0.57] },
        ball: { type: 'pass', from: 'h2', to: 'h5', at: 0.5 },
      },
      {
        d: 1, note: 'Finish from the penalty spot.', outcome: 'goal',
        moves: { h5: [0.91, 0.6] },
        ball: { type: 'shot', from: 'h5', target: [1, 0.46], at: 0.4 },
      },
    ],
  },
  {
    key: '9v9-switch',
    name: '9v9 Overload and switch',
    description: 'Draw the opposition to the left, then switch quickly to the isolated right winger and attack the back post.',
    format: 9, phase: 'attack', home: '3-2-3', away: '3-3-2', ballOwner: 'h6',
    setup: {
      h0: [0.05, 0.5], h1: [0.3, 0.2], h2: [0.28, 0.5], h3: [0.32, 0.78], h4: [0.5, 0.32], h5: [0.48, 0.62],
      h6: [0.6, 0.1], h7: [0.74, 0.5], h8: [0.74, 0.9], a0: [0.96, 0.5], a3: [0.74, 0.2], a2: [0.77, 0.42],
      a1: [0.78, 0.64], a6: [0.63, 0.2], a5: [0.62, 0.42], a4: [0.6, 0.62], a8: [0.63, 0.14], a7: [0.55, 0.5],
    },
    steps: [
      {
        d: 2, note: 'Left winger, under pressure, plays inside to the left midfielder.', outcome: 'retain',
        moves: { h4: [0.48, 0.33] },
        ball: { type: 'pass', from: 'h6', to: 'h4', at: 0.5 },
      },
      {
        d: 1.8, note: 'Sideways to the right midfielder, after a touch to draw the presser.', outcome: 'retain',
        moves: { h5: [0.57, 0.55] },
        ball: { type: 'pass', from: 'h4', to: 'h5', at: 0.65 },
      },
      {
        d: 2.5, note: 'Switch: long diagonal to the right winger, who is 1v1 with lots of space.', outcome: 'progress',
        moves: { h6: [0.72, 0.14] },
        ball: { type: 'pass', from: 'h5', to: 'h8', at: 0.5 },
      },
      {
        d: 2.5, note: 'Winger attacks the full-back; striker and far winger attack the box.', outcome: 'progress',
        moves: { h8: [0.86, 0.82], h7: [0.9, 0.56], h6: [[0.8, 0.2], [0.87, 0.36]] },
        ball: { type: 'dribble', from: 'h8' },
      },
      {
        d: 1.4, note: 'Cross to the back post.', outcome: 'chance',
        moves: { h6: [0.84, 0.48] },
        ball: { type: 'cross', from: 'h8', to: 'h6', at: 0.3 },
      },
      {
        d: 1, note: 'Finish at the back post.', outcome: 'goal',
        moves: { h6: [0.87, 0.51] },
        ball: { type: 'shot', from: 'h6', target: [1, 0.52], at: 0.5 },
      },
    ],
  },
  {
    key: '11v11-buildup',
    name: '4-3-3 Build-up through the pivot',
    description: 'Build out from the back against a 4-4-2: centre-backs split, the 6 drops between the strikers, and the 8 receives on the half-turn.',
    format: 11, phase: 'attack', home: '4-3-3', away: '4-4-2', ballOwner: 'h0',
    setup: {
      h0: [0.04, 0.5], h1: [0.2, 0.08], h2: [0.1, 0.3], h3: [0.1, 0.7], h4: [0.2, 0.92], h5: [0.34, 0.28],
      h6: [0.22, 0.5], h7: [0.34, 0.72], h8: [0.5, 0.1], h9: [0.56, 0.5], h10: [0.5, 0.9], a0: [0.96, 0.5],
      a4: [0.58, 0.12], a3: [0.58, 0.38], a2: [0.58, 0.62], a1: [0.58, 0.88], a8: [0.4, 0.16], a7: [0.42, 0.4],
      a6: [0.42, 0.6], a5: [0.4, 0.84], a10: [0.24, 0.36], a9: [0.24, 0.64],
    },
    steps: [
      {
        d: 2, note: 'Keeper plays short to the left centre-back, who has split wide.', outcome: 'retain',
        moves: { h2: [0.12, 0.24] },
        ball: { type: 'pass', from: 'h0', to: 'h2', at: 0.3 },
      },
      {
        d: 2.5, note: 'Striker presses; the 6 drops into the gap between the two strikers.', outcome: 'retain',
        moves: { h6: [0.2, 0.43], h5: [0.36, 0.3] },
        ball: { type: 'pass', from: 'h2', to: 'h6', at: 0.6 },
      },
      {
        d: 2.5, note: 'The 6 turns and finds the 8 on the half-turn between the lines.', outcome: 'progress',
        moves: { h5: [0.33, 0.24], h8: [0.56, 0.08] },
        ball: { type: 'pass', from: 'h6', to: 'h5', at: 0.7 },
      },
      {
        d: 2.5, note: 'The 8 drives forward into the space vacated by the full-back tracking the winger.', outcome: 'progress',
        moves: { h5: [0.5, 0.3], h9: [0.66, 0.5], h1: [0.36, 0.08] },
        ball: { type: 'dribble', from: 'h5' },
      },
      {
        d: 3.5, note: 'Through ball for the striker, timed to stay onside.', outcome: 'progress',
        moves: { h9: [0.7, 0.3] },
        ball: { type: 'pass', from: 'h5', to: 'h9', at: 0.6 },
      },
      {
        d: 2.9, note: 'Striker carries into the box.', outcome: 'chance',
        moves: { h9: [0.86, 0.45] },
        ball: { type: 'dribble', from: 'h9' },
      },
      {
        d: 1, note: 'Finish.', outcome: 'goal',
        moves: { h9: [0.89, 0.45] },
        ball: { type: 'shot', from: 'h9', target: [1, 0.53], at: 0.5 },
      },
    ],
  },
  {
    key: '11v11-counter',
    name: '4-4-2 Counter-attack after a regain',
    description: 'Win the ball in midfield and attack the space behind a high line with three quick passes.',
    format: 11, phase: 'transition', home: '4-4-2', away: '4-3-3', ballOwner: 'h6',
    setup: {
      h0: [0.05, 0.5], h1: [0.24, 0.12], h2: [0.2, 0.38], h3: [0.2, 0.62], h4: [0.24, 0.88], h5: [0.38, 0.15],
      h6: [0.4, 0.42], h7: [0.36, 0.6], h8: [0.4, 0.86], h9: [0.5, 0.36], h10: [0.48, 0.66], a0: [0.92, 0.5],
      a4: [0.5, 0.1], a3: [0.6, 0.38], a2: [0.6, 0.62], a1: [0.5, 0.9], a7: [0.42, 0.24], a6: [0.43, 0.48],
      a5: [0.42, 0.72], a10: [0.3, 0.14], a9: [0.28, 0.5], a8: [0.3, 0.86],
    },
    steps: [
      {
        d: 2, note: 'Ball won: the first pass goes forward immediately to the striker checking short.', outcome: 'progress',
        moves: { h9: [0.52, 0.42], h10: [0.56, 0.7], h5: [0.48, 0.12] },
        ball: { type: 'pass', from: 'h6', to: 'h9', at: 0.2 },
      },
      {
        d: 3.7, note: 'Lay-off into the second striker running into the space behind the full-back.', outcome: 'progress',
        moves: { h10: [0.71, 0.61], h8: [0.54, 0.88] },
        ball: { type: 'pass', from: 'h9', to: 'h10', at: 0.35 },
      },
      {
        d: 4, note: 'Carry at speed while the striker spins in behind the centre-back.', outcome: 'progress',
        moves: { h10: [0.82, 0.64], h9: [[0.62, 0.46], [0.78, 0.44]], h5: [0.68, 0.2] },
        ball: { type: 'dribble', from: 'h10' },
      },
      {
        d: 2.2, note: 'Square ball across the box to the striker attacking the far post.', outcome: 'chance',
        moves: { h9: [0.89, 0.48] },
        ball: { type: 'pass', from: 'h10', to: 'h9', at: 0.4 },
      },
      {
        d: 1, note: 'Tap-in.', outcome: 'goal',
        moves: { h9: [0.91, 0.5] },
        ball: { type: 'shot', from: 'h9', target: [1, 0.55], at: 0.45 },
      },
    ],
  },
  {
    key: '11v11-press',
    name: '4-3-3 Touchline pressing trap',
    description: 'Show the opposition full-back down the line, then close the trap with winger, 8 and full-back to win the ball.',
    format: 11, phase: 'defence', home: '4-3-3', away: '4-3-3', ballOwner: 'a2',
    setup: {
      h0: [0.15, 0.5], h1: [0.48, 0.14], h2: [0.45, 0.38], h3: [0.45, 0.62], h4: [0.48, 0.86], h5: [0.56, 0.26],
      h6: [0.52, 0.5], h7: [0.56, 0.72], h8: [0.72, 0.22], h9: [0.74, 0.48], h10: [0.72, 0.78], a0: [0.96, 0.5],
      a1: [0.8, 0.9], a2: [0.86, 0.64], a3: [0.86, 0.36], a4: [0.78, 0.1], a5: [0.7, 0.72], a6: [0.74, 0.5],
      a7: [0.68, 0.3], a8: [0.52, 0.82], a9: [0.5, 0.5], a10: [0.5, 0.18],
    },
    steps: [
      {
        d: 2, note: 'Striker curves the run to block the switch and show the centre-back towards the full-back.', outcome: 'none',
        moves: { h9: [[0.8, 0.52], [0.84, 0.48]], h8: [0.76, 0.24] },
        ball: { type: 'pass', from: 'a2', to: 'a3', at: 0.2 },
      },
      {
        d: 2.2, note: 'Trigger: pass to the full-back. Winger presses on the inside, the 8 and full-back lock the line.', outcome: 'none',
        moves: { h8: [0.76, 0.2], h5: [0.7, 0.2], h1: [0.58, 0.12], h6: [0.6, 0.34] },
        ball: { type: 'pass', from: 'a3', to: 'a4', at: 0.25 },
      },
      {
        d: 1.8, note: 'Trapped: the full-back tries the line and the left-back steps in to intercept.', outcome: 'regain',
        moves: { h1: [0.64, 0.08], h8: [0.76, 0.12] },
        ball: { type: 'pass', from: 'a4', to: 'h1', at: 0.45 },
      },
      {
        d: 2, note: 'Win it and attack immediately while they are out of shape.', outcome: 'progress',
        moves: { h9: [0.86, 0.44], h10: [0.8, 0.7], h5: [0.76, 0.24] },
        ball: { type: 'pass', from: 'h1', to: 'h5', at: 0.6 },
      },
    ],
  },
  {
    key: '11v11-corner',
    name: 'Short corner and cutback',
    description: 'Short corner to create a 2v1 at the flag. The 6 drives inside along the byline while the 10 drifts out of the box to lose his marker, then arrives late for the cutback.',
    format: 11, phase: 'set-piece', home: '4-2-3-1', away: '4-4-2', ballOwner: 'h7',
    setup: {
      h0: [0.3, 0.5], h1: [0.55, 0.12], h2: [0.55, 0.4], h3: [0.9, 0.62], h4: [0.55, 0.85], h5: [0.84, 0.14],
      h6: [0.7, 0.6], h7: [1, 0.005], h8: [0.9, 0.42], h9: [0.88, 0.54], h10: [0.91, 0.7], a0: [0.99, 0.5],
      a1: [0.95, 0.62], a2: [0.94, 0.46], a3: [0.94, 0.54], a4: [0.97, 0.4], a5: [0.9, 0.44], a6: [0.91, 0.58],
      a7: [0.9, 0.68], a8: [0.93, 0.36], a9: [0.62, 0.5], a10: [0.92, 0.12],
    },
    steps: [
      {
        d: 1.6, note: 'The 6 comes short towards the flag for a 2v1. The 10 drifts out of the box to lose their marker.', outcome: 'retain',
        moves: { h5: [0.84, 0.08], h8: [0.8, 0.44] },
        ball: { type: 'pass', from: 'h7', to: 'h5', at: 0.6 },
      },
      {
        d: 2.3, note: 'The 6 drives inside along the byline; the box runners hold their markers on the six-yard line.', outcome: 'progress',
        moves: { h5: [0.96, 0.24], h7: [0.95, 0.06], h9: [0.93, 0.52], h3: [0.94, 0.64] },
        ball: { type: 'dribble', from: 'h5' },
      },
      {
        d: 1.6, note: 'Cutback to the 10, arriving late between the penalty spot and the six-yard box.', outcome: 'chance',
        moves: { h8: [0.85, 0.46] },
        ball: { type: 'pass', from: 'h5', to: 'h8', at: 0.3 },
      },
      {
        d: 1.1, note: 'Takes one touch towards goal and finishes into the far corner.', outcome: 'goal',
        moves: { h8: [0.91, 0.4] },
        ball: { type: 'shot', from: 'h8', target: [1, 0.55], at: 0.5 },
      },
    ],
  },
];

export const PRESET_TACTICS: Tactic[] = PRESET_SPECS.map(buildPreset);
