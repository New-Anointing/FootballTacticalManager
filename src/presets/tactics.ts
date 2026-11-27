import type { Tactic } from '../model/types';
import { buildPreset, type PresetSpec } from './builder';

// Built-in tactics, each based on a recognised coaching pattern:
//  - futsal: kick-off isolation (2-1-1), rehearsed kick-in through the pivo, and
//    using the pivo to beat a high press (lay-off to a player facing forward);
//  - 7v7: 2v1 with a dribble inside and an overlap; 9v9: overload and switch;
//  - 11v11: the 6 dropping between the centre-backs for a 3v2 against a two-striker
//    press, a counter-attack with the first pass forward behind a high full-back,
//    a touchline pressing trap with cover shadows, and a short corner and cutback.
//
// Player ids follow formation order: h0/a0 = goalkeeper, then each line from
// defence to attack, left to right from the team's own point of view.
// Coordinates are fractions of the pitch; home attacks towards x = 1.
//
// Opponents are NOT scripted: the defensive engine (engine/defence.ts) makes them
// press with one player, block the most dangerous lane with a cover shadow, hold
// a zonal shape and track runners, at realistic speeds and without crowding.
// Every preset is designed and tuned (scripts/tune-presets.ts) to work against
// that defence, and a test keeps it that way.

export const PRESET_SPECS: PresetSpec[] = [
  {
    key: '4v4-wall-pass',
    name: '4v4 Wall pass and third-man run',
    description: 'Small-sided pattern built on the pivot as a wall: the fixo plays into the high player, who lays it off to the ala arriving facing forward, then spins in behind for the return.',
    format: 4, phase: 'attack', home: '1-2', away: '1-2', ballOwner: 'h1',
    setup: {
      h0: [0.05, 0.5], h1: [0.3, 0.5], h2: [0.44, 0.18], h3: [0.7, 0.62], a0: [0.96, 0.5], a1: [0.84, 0.52],
      a2: [0.6, 0.66], a3: [0.6, 0.34],
    },
    steps: [
      {
        d: 1.3, note: 'The fixo plays into the high player, who checks towards the ball to receive.', outcome: 'progress',
        moves: { h3: [0.64, 0.64], h2: [0.48, 0.24] },
        ball: { type: 'pass', from: 'h1', to: 'h3', at: 0.15 },
      },
      {
        d: 1.6, note: 'Wall pass: a quick lay-off to the ala, who arrives inside facing forward.', outcome: 'retain',
        moves: { h2: [0.65, 0.38], h1: [0.36, 0.82] },
        ball: { type: 'pass', from: 'h3', to: 'h2', at: 0.7 },
      },
      {
        d: 2.2, note: 'The high player spins in behind; the ala plays it straight back into the run.', outcome: 'chance',
        moves: { h3: [0.89, 0.73] },
        ball: { type: 'pass', from: 'h2', to: 'h3', at: 0.5 },
      },
      {
        d: 0.8, note: 'Takes it on and finishes across the keeper.', outcome: 'goal',
        moves: { h3: [0.92, 0.58] },
        ball: { type: 'shot', from: 'h3', target: [1, 0.42], at: 0.7 },
      },
    ],
  },
  {
    key: '5v5-kickoff-isolation',
    name: 'Futsal kick-off: ala isolation (2-1-1)',
    description: 'Kick-off isolation: three players move away from one side to form a 2-1-1, leaving the right ala 1v1 with space to attack after a diagonal from the fixo.',
    format: 5, phase: 'set-piece', home: '1-2-1', away: '1-2-1', ballOwner: 'h4',
    setup: {
      h4: [0.5, 0.5], h1: [0.32, 0.5], h2: [0.44, 0.18], h3: [0.44, 0.88], a0: [0.97, 0.5], a1: [0.84, 0.5],
      a2: [0.7, 0.72], a3: [0.7, 0.28], a4: [0.6, 0.5],
    },
    steps: [
      {
        d: 1.5, note: 'The pivo plays back to the fixo. The pivo and left ala move away to the left, clearing the right side.', outcome: 'retain',
        moves: { h4: [0.62, 0.3], h2: [0.46, 0.14], h3: [0.5, 0.9] },
        ball: { type: 'pass', from: 'h4', to: 'h1', at: 0.1 },
      },
      {
        d: 1.6, note: 'Isolation: the fixo plays the diagonal into the right ala, now 1v1 with space in front.', outcome: 'progress',
        moves: { h3: [0.69, 0.9] },
        ball: { type: 'pass', from: 'h1', to: 'h3', at: 0.15 },
      },
      {
        d: 3.3, note: 'The ala attacks the defender 1v1 and cuts inside onto the stronger foot.', outcome: 'chance',
        moves: { h3: [0.86, 0.7], h4: [0.8, 0.3] },
        ball: { type: 'dribble', from: 'h3' },
      },
      {
        d: 1.2, note: 'Shot to the far post, with the pivo following in for any rebound.', outcome: 'goal',
        moves: { h4: [0.9, 0.4], h3: [0.97, 0.67] },
        ball: { type: 'shot', from: 'h3', target: [1, 0.42], at: 0.7 },
      },
    ],
  },
  {
    key: '5v5-kick-in',
    name: 'Futsal kick-in: pivo wide, kicker shoots',
    description: 'Rehearsed kick-in (only four seconds to take it): the base player finds the pivo wide, and the pivo plays the ball into the middle for the kicker, who has run inside, to shoot.',
    format: 5, phase: 'set-piece', home: '1-2-1', away: '1-2-1', ballOwner: 'h3',
    setup: {
      h0: [0.06, 0.5], h1: [0.56, 0.55], h2: [0.62, 0.2], h3: [0.7, 0.995], h4: [0.84, 0.6], a0: [0.97, 0.5],
      a1: [0.885, 0.55], a2: [0.8, 0.78], a3: [0.72, 0.36], a4: [0.62, 0.62],
    },
    steps: [
      {
        d: 1.5, note: 'Kick-in to the base player, who comes towards the ball.', outcome: 'retain',
        moves: { h1: [0.58, 0.65], h4: [0.86, 0.78] },
        ball: { type: 'pass', from: 'h3', to: 'h1', at: 0.2 },
      },
      {
        d: 2, note: 'The base player finds the pivo, who has drifted wide. The kicker steps in off the line.', outcome: 'progress',
        moves: { h3: [0.74, 0.8], h4: [0.83, 0.77] },
        ball: { type: 'pass', from: 'h1', to: 'h4', at: 0.4 },
      },
      {
        d: 1, note: 'The pivo plays it into the middle for the kicker arriving at the top of the area.', outcome: 'chance',
        moves: { h3: [0.85, 0.61] },
        ball: { type: 'pass', from: 'h4', to: 'h3', at: 0.6 },
      },
      {
        d: 0.8, note: 'Takes a touch forward, past the defender who comes across, and shoots across the keeper into the far corner.', outcome: 'goal',
        moves: { h3: [0.912, 0.595] },
        ball: { type: 'shot', from: 'h3', target: [1, 0.45], at: 0.7 },
      },
    ],
  },
  {
    key: '5v5-pivot-press',
    name: 'Futsal 3-1: beating the press through the pivo',
    description: 'Against a high press, the ball goes into the pivo, who shields it and lays it off to a team-mate arriving facing forward; then a switch to the far ala attacking the back post.',
    format: 5, phase: 'attack', home: '3-1', away: '2-2', ballOwner: 'h0',
    setup: {
      h0: [0.05, 0.5], h1: [0.24, 0.12], h2: [0.2, 0.5], h3: [0.24, 0.88], h4: [0.56, 0.6], a0: [0.96, 0.5],
      a1: [0.6, 0.72], a2: [0.6, 0.32], a3: [0.32, 0.66], a4: [0.32, 0.34],
    },
    steps: [
      {
        d: 1.3, note: 'The keeper rolls it to the right ala, who drops wide away from the press.', outcome: 'retain',
        moves: { h3: [0.2, 0.9], h4: [0.52, 0.8] },
        ball: { type: 'pass', from: 'h0', to: 'h3', at: 0.15 },
      },
      {
        d: 1.6, note: 'Down the line into the pivo, who has come short and wide.', outcome: 'progress',
        moves: { h4: [0.48, 0.83], h2: [0.34, 0.55] },
        ball: { type: 'pass', from: 'h3', to: 'h4', at: 0.3 },
      },
      {
        d: 2.2, note: 'The pivo shields and lays it off to the fixo, arriving facing forward.', outcome: 'retain',
        moves: { h2: [0.42, 0.6], h1: [0.5, 0.15] },
        ball: { type: 'pass', from: 'h4', to: 'h2', at: 0.3 },
      },
      {
        d: 3.3, note: 'The fixo carries forward, then switches play to the left ala running in behind.', outcome: 'progress',
        moves: { h1: [0.76, 0.29], h4: [0.66, 0.78] },
        ball: { type: 'pass', from: 'h2', to: 'h1', at: 0.7 },
      },
      {
        d: 2.3, note: 'Square ball across the area to the pivo at the back post.', outcome: 'chance',
        moves: { h4: [0.88, 0.56], h1: [0.86, 0.26] },
        ball: { type: 'pass', from: 'h1', to: 'h4', at: 0.5 },
      },
      {
        d: 1.1, note: 'Finish at the back post.', outcome: 'goal',
        ball: { type: 'shot', from: 'h4', target: [1, 0.42], at: 0.7 },
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
        d: 2.1, note: 'Up: midfielder plays up to the striker, who drops in.', outcome: 'progress',
        moves: { h4: [0.52, 0.35], h5: [0.62, 0.78] },
        ball: { type: 'pass', from: 'h3', to: 'h4', at: 0.3 },
      },
      {
        d: 1.8, note: 'Back: set back to the midfielder arriving.', outcome: 'retain',
        moves: { h3: [0.46, 0.45], h5: [0.7, 0.68] },
        ball: { type: 'pass', from: 'h4', to: 'h3', at: 0.3 },
      },
      {
        d: 2.3, note: 'Through: ball in behind for the far striker.', outcome: 'chance',
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
    name: '7v7 2v1: dribble inside, full-back overlaps',
    description: '2-3-1 pattern: the wide midfielder dribbles inside to engage the defender while the right centre-back overlaps outside; the ball is released into the overlap for a cutback. Only one defender pushes on, so the other stays home.',
    format: 7, phase: 'attack', home: '2-3-1', away: '3-2-1', ballOwner: 'h2',
    setup: {
      h0: [0.06, 0.5], h1: [0.24, 0.35], h2: [0.36, 0.78], h3: [0.52, 0.22], h4: [0.46, 0.5], h5: [0.52, 0.86],
      h6: [0.72, 0.48], a0: [0.96, 0.5], a3: [0.8, 0.28], a2: [0.8, 0.5], a1: [0.79, 0.73], a5: [0.64, 0.38],
      a4: [0.64, 0.66], a6: [0.52, 0.55],
    },
    steps: [
      {
        d: 1.8, note: 'The right centre-back steps in and plays square to the wide midfielder.', outcome: 'retain',
        ball: { type: 'pass', from: 'h2', to: 'h5', at: 0.3 },
      },
      {
        d: 2.6, note: 'The wide midfielder dribbles inside to engage the defender; the centre-back sets off on the overlap.', outcome: 'progress',
        moves: { h5: [0.62, 0.78], h2: [0.56, 0.92], h6: [0.8, 0.45] },
        ball: { type: 'dribble', from: 'h5' },
      },
      {
        d: 2.4, note: 'The defender is committed: the ball is released into the overlap.', outcome: 'progress',
        moves: { h2: [0.83, 0.92], h4: [0.66, 0.52] },
        ball: { type: 'pass', from: 'h5', to: 'h2', at: 0.2 },
      },
      {
        d: 2.1, note: 'Carry to the byline while the striker attacks the near post and the 6 arrives late.', outcome: 'progress',
        moves: { h2: [0.92, 0.72], h6: [0.92, 0.46], h4: [0.8, 0.56] },
        ball: { type: 'dribble', from: 'h2' },
      },
      {
        d: 1.9, note: 'Cutback to the 6, arriving late at the edge of the six-yard area.', outcome: 'retain',
        moves: { h4: [0.8, 0.49] },
        ball: { type: 'pass', from: 'h2', to: 'h4', at: 0.4 },
      },
      {
        d: 1.3, note: 'The 6 takes it in stride and finishes low.', outcome: 'goal',
        moves: { h4: [0.92, 0.4] },
        ball: { type: 'shot', from: 'h4', target: [1, 0.44], at: 0.7 },
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
        d: 1.8, note: 'Left winger, under pressure, plays inside to the left midfielder.', outcome: 'retain',
        moves: { h4: [0.48, 0.33] },
        ball: { type: 'pass', from: 'h6', to: 'h4', at: 0.7 },
      },
      {
        d: 2.9, note: 'Sideways to the right midfielder, after a touch to draw the presser.', outcome: 'retain',
        moves: { h5: [0.66, 0.46] },
        ball: { type: 'pass', from: 'h4', to: 'h5', at: 0.7 },
      },
      {
        d: 2.5, note: 'Switch: long diagonal to the right winger, who is 1v1 with lots of space.', outcome: 'progress',
        moves: { h6: [0.72, 0.14], h8: [0.8, 0.81] },
        ball: { type: 'pass', from: 'h5', to: 'h8', at: 0.4 },
      },
      {
        d: 2.9, note: 'Winger attacks the full-back; striker and far winger attack the box.', outcome: 'progress',
        moves: { h8: [0.89, 0.97], h7: [0.87, 0.62], h6: [[0.8, 0.2], [0.87, 0.36]] },
        ball: { type: 'dribble', from: 'h8' },
      },
      {
        d: 2.1, note: 'Cross to the back post.', outcome: 'chance',
        moves: { h6: [0.84, 0.54] },
        ball: { type: 'cross', from: 'h8', to: 'h6', at: 0.4 },
      },
      {
        d: 1.9, note: 'Finish at the back post.', outcome: 'goal',
        moves: { h6: [0.93, 0.6] },
        ball: { type: 'shot', from: 'h6', target: [1, 0.52], at: 0.6 },
      },
    ],
  },
  {
    key: '11v11-buildup',
    name: '4-3-3 Build-up vs a 4-4-2 press: the 6 drops in',
    description: 'Against two pressing strikers, the 6 drops between the centre-backs to make a 3v2. The free centre-back carries into midfield, finds the 10 between the lines, and the 10 releases the winger.',
    format: 11, phase: 'attack', home: '4-3-3', away: '4-4-2', ballOwner: 'h0',
    setup: {
      h0: [0.04, 0.5], h1: [0.3, 0.06], h2: [0.12, 0.28], h3: [0.12, 0.72], h4: [0.3, 0.94], h5: [0.36, 0.32],
      h6: [0.2, 0.5], h7: [0.38, 0.66], h8: [0.5, 0.08], h9: [0.56, 0.5], h10: [0.5, 0.92], a0: [0.96, 0.5],
      a4: [0.62, 0.12], a3: [0.6, 0.38], a2: [0.6, 0.62], a1: [0.62, 0.88], a8: [0.44, 0.16], a7: [0.44, 0.4],
      a6: [0.44, 0.6], a5: [0.44, 0.84], a10: [0.26, 0.38], a9: [0.26, 0.62],
    },
    steps: [
      {
        d: 2, note: 'The 6 drops between the centre-backs: three against their two strikers.', outcome: 'retain',
        moves: { h6: [0.12, 0.5], h2: [0.14, 0.22], h3: [0.14, 0.78] },
        ball: { type: 'pass', from: 'h0', to: 'h6', at: 0.4 },
      },
      {
        d: 2.2, note: 'With both strikers committed, the 6 plays out to the free right centre-back.', outcome: 'retain',
        ball: { type: 'pass', from: 'h6', to: 'h3', at: 0.2 },
      },
      {
        d: 4.1, note: 'The free centre-back carries into midfield, drawing a midfielder out of their line.', outcome: 'progress',
        moves: { h3: [0.33, 0.71], h7: [0.46, 0.62] },
        ball: { type: 'dribble', from: 'h3' },
      },
      {
        d: 3.4, note: 'The centre-back finds the 10 in the space between their lines, on the half-turn.', outcome: 'progress',
        moves: { h7: [0.48, 0.6], h10: [0.6, 0.94] },
        ball: { type: 'pass', from: 'h3', to: 'h7', at: 0.5 },
      },
      {
        d: 3.1, note: 'The 10 releases the right winger, 1v1 against the full-back.', outcome: 'progress',
        moves: { h10: [0.73, 0.77], h9: [0.7, 0.48], h8: [0.68, 0.18] },
        ball: { type: 'pass', from: 'h7', to: 'h10', at: 0.6 },
      },
      {
        d: 3.4, note: 'The winger drives to the byline; the striker attacks the near post and the left winger the far post.', outcome: 'progress',
        moves: { h10: [0.9, 0.82], h9: [0.9, 0.48], h8: [0.86, 0.3] },
        ball: { type: 'dribble', from: 'h10' },
      },
      {
        d: 2.2, note: 'Low cross into the six-yard area.', outcome: 'chance',
        moves: { h9: [0.94, 0.62] },
        ball: { type: 'pass', from: 'h10', to: 'h9', at: 0.4 },
      },
      {
        d: 1.5, note: 'Finish.', outcome: 'goal',
        moves: { h9: [0.91, 0.62] },
        ball: { type: 'shot', from: 'h9', target: [1, 0.46], at: 0.4 },
      },
    ],
  },
  {
    key: '11v11-counter',
    name: '4-4-2 Counter: first pass forward, behind the full-back',
    description: 'Win the ball in midfield and play forward at once into the space behind the high full-back, while the other striker and the far winger sprint ahead, timing their runs to stay onside.',
    format: 11, phase: 'transition', home: '4-4-2', away: '4-3-3', ballOwner: 'h6',
    setup: {
      h0: [0.05, 0.5], h1: [0.22, 0.14], h2: [0.18, 0.38], h3: [0.18, 0.62], h4: [0.22, 0.86], h5: [0.34, 0.14],
      h6: [0.34, 0.42], h7: [0.32, 0.62], h8: [0.36, 0.86], h9: [0.46, 0.4], h10: [0.48, 0.66], a0: [0.92, 0.5],
      a4: [0.46, 0.08], a3: [0.62, 0.38], a2: [0.62, 0.62], a1: [0.5, 0.92], a7: [0.4, 0.3], a6: [0.44, 0.52],
      a5: [0.4, 0.7], a10: [0.28, 0.16], a9: [0.26, 0.48], a8: [0.3, 0.84],
    },
    steps: [
      {
        d: 2.6, note: 'Ball won. One touch to set it, then the first pass goes forward into the space behind their high right-back, for the striker running the channel.', outcome: 'progress',
        moves: { h10: [0.56, 0.72], h9: [0.56, 0.44], h5: [0.44, 0.14] },
        ball: { type: 'pass', from: 'h6', to: 'h10', at: 0.5 },
      },
      {
        d: 4.8, note: 'The striker carries at speed. The strike partner and the far winger sprint ahead, staying level with the last defender.', outcome: 'progress',
        moves: { h10: [0.75, 0.7], h9: [0.74, 0.46], h5: [0.66, 0.2] },
        ball: { type: 'dribble', from: 'h10' },
      },
      {
        d: 3.4, note: 'With the centre-back drawn across, the ball goes across to the strike partner.', outcome: 'chance',
        moves: { h9: [0.86, 0.55] },
        ball: { type: 'pass', from: 'h10', to: 'h9', at: 0.5 },
      },
      {
        d: 1.2, note: 'Takes a touch and finishes into the far corner.', outcome: 'goal',
        moves: { h9: [0.92, 0.58] },
        ball: { type: 'shot', from: 'h9', target: [1, 0.44], at: 0.5 },
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
      h6: [0.55, 0.47], h7: [0.56, 0.72], h8: [0.72, 0.22], h9: [0.74, 0.48], h10: [0.72, 0.78], a0: [0.96, 0.5],
      a1: [0.8, 0.9], a2: [0.86, 0.64], a3: [0.86, 0.36], a4: [0.78, 0.1], a5: [0.7, 0.72], a6: [0.78, 0.55],
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
        d: 3, note: 'Trapped: the full-back tries the line and the left-back steps in to intercept.', outcome: 'regain',
        moves: { h1: [0.73, 0.08], h8: [0.76, 0.12] },
        ball: { type: 'pass', from: 'a4', to: 'h1', at: 0.45 },
      },
      {
        d: 3, note: 'Win it, take a touch to set, then attack while they are still out of shape.', outcome: 'progress',
        moves: { h9: [0.86, 0.44], h10: [0.8, 0.7], h5: [0.82, 0.21] },
        ball: { type: 'pass', from: 'h1', to: 'h5', at: 0.6 },
      },
    ],
  },
  {
    key: '11v11-corner',
    name: 'Short corner and cutback',
    description: 'Short corner for a 2v1 at the flag against the one player sent to block it. The 6 carries inside along the byline while the runners pin their markers at the far post, and the 10 waits outside the box to arrive late for the cutback.',
    format: 11, phase: 'set-piece', home: '4-2-3-1', away: '4-4-2', ballOwner: 'h7',
    setup: {
      h0: [0.286, 0.5], h1: [0.533, 0.294], h2: [0.524, 0.456], h3: [0.929, 0.647], h4: [0.533, 0.735], h5: [0.9, 0.132],
      h6: [0.829, 0.588], h7: [1, 0.005], h8: [0.829, 0.36], h9: [0.914, 0.551], h10: [0.895, 0.765], a0: [0.99, 0.5],
      a1: [0.861, 0.572], a2: [0.967, 0.412], a3: [0.962, 0.493], a4: [0.987, 0.365], a5: [0.946, 0.532], a6: [0.949, 0.604],
      a7: [0.913, 0.719], a8: [0.938, 0.106], a9: [0.571, 0.441], a10: [0.571, 0.647],
    },
    steps: [
      {
        d: 1.8, note: 'The 6 comes short to the flag: a 2v1 with the taker against the one player sent to block the short corner. The runners hold their markers at the far post and the 10 waits outside the box.', outcome: 'retain',
        moves: { h5: [0.955, 0.06], h9: [0.914, 0.551], h3: [0.929, 0.647], h10: [0.895, 0.765], h6: [0.829, 0.588], h8: [0.824, 0.346] },
        ball: { type: 'pass', from: 'h7', to: 'h5', at: 0.35 },
      },
      {
        d: 3.8, note: 'The 6 carries inside along the byline, with the defender jockeying goal-side, and the taker follows round the outside as a second option. The zonal defenders drop to protect the near post.', outcome: 'retain',
        moves: { h5: [0.986, 0.324], h7: [0.971, 0.071], h9: [0.914, 0.551], h3: [0.929, 0.647], h10: [0.895, 0.765], h6: [0.829, 0.588], h8: [0.833, 0.353] },
        ball: { type: 'dribble', from: 'h5' },
      },
      {
        d: 2.3, note: 'Cutback to the 10, arriving late into the space between the penalty spot and the near post that the far-post runners have left empty.', outcome: 'chance',
        moves: { h8: [0.919, 0.419], h7: [0.967, 0.103], h9: [0.914, 0.551], h3: [0.929, 0.647], h10: [0.895, 0.765], h6: [0.829, 0.588] },
        ball: { type: 'pass', from: 'h5', to: 'h8', at: 0.4 },
      },
      {
        d: 1, note: 'First-time finish inside the near post before the defence can close.', outcome: 'goal',
        moves: { h9: [0.914, 0.551], h3: [0.929, 0.647], h10: [0.895, 0.765], h6: [0.829, 0.588], h7: [0.967, 0.103] },
        ball: { type: 'shot', from: 'h8', target: [1, 0.465], at: 0.25 },
      },
    ],
  },
];

export const PRESET_TACTICS: Tactic[] = PRESET_SPECS.map(buildPreset);
