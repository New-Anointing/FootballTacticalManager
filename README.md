# Football Tactical Manager

A web app for coaches and managers to **design, animate and analyse football tactics**, from 4v4 (3 outfield players + goalkeeper) up to 11v11.

## Phase 1 features

- **Formations and tactics for 4v4 → 11v11.** Each format gets the right pitch size (futsal court, 7-a-side, 9-a-side, full size) and a set of formations; offside is on by default from 8v8 up.
- **Movement editor.** Drag players into a starting shape, then build the move step by step:
  - **Run**: multi-waypoint runs (dashed arrows).
  - **Pass / Cross / Dribble / Shoot / Clear**: ball actions (solid arrows), with adjustable release timing.
  - A coaching note and an **expected outcome** per step (keep the ball, progress, switch play, create a chance, score, win it back, clear).
  - **Previous-step shadow**: while editing step 2 onwards, the previous step's players and arrows are shown as a blurred shadow, so you can see where everyone came from. Toggle it with the **Prev step** button, the `H` key or in Settings.
  - Undo/redo and keyboard shortcuts (`V R P C D S L` tools, `Space` play, `←/→` steps, `H` shadow, `Ctrl+Z`).
- **Animation.** Play the tactic back with eased runs, timed passes and lofted crosses; scrub, change speed and loop. **Present** mode shows a full-screen view with captions for players.
- **Realistic players.** Script only the key runs; the engines move everyone else like a real team:
  - **Team defending** (*Make opponents react*): one player presses the ball, approaching from the inside to show the carrier down the line and only once the pass is played. One more blocks the most dangerous passing lane. The rest hold a compact zonal shape that slides, steps up and drops with the ball, and runners are tracked a metre or two goal-side. Nobody but the presser crowds the ball, and the back line holds the edge of the box until the ball gets there. At set pieces near their own goal (corners, wide free kicks, kick-ins), the box defence holds its zones, markers stay with their men and the keeper covers the near post without leaving the goal mouth.
  - **Team support** (*Move my team with the play*): the team on the ball moves as a unit. The back line pushes up behind the ball as rest defence, full-backs and midfielders support, the far side tucks in, runners attack the near post, far post, penalty spot and cutback zone when the ball goes wide, and the keeper sweeps behind a high line.
  - Both work for either side, so the same engines defend your team when the opponent has the ball. Scripted runs are never changed.
  - Players run round each other, not through each other: a final pass bends any engine run that would cross an opponent or team-mate mid-step, without crowding the ball or doubling up on an attacker.
- **Analysis mode.** A rule engine replays every step and judges the tactic:
  - realistic running, dribbling and pass speeds
  - passing lanes checked against *moving* defenders (interceptions and risky lanes)
  - offside at the moment the ball is played
  - pressure on receivers and dribbles into defenders
  - shot quality (a simple xG model)
  - width, depth, crowding, rest defence and safe passing options
  - defensive shape: players goal-side of the ball, unmarked attackers, a stretched block
  - realism: opponents who stand still, nobody pressing the ball, two defenders crowding one player or the carrier, players running on top of each other mid-step, and team-mates left behind while the ball goes forward
  - the Laws at set pieces: restart distances (9.15 m in 11v11, 5 m in futsal) and kick-off positions, plus players starting on top of each other
  - whether each step achieves its expected outcome

  Findings give a 0–100 score and grade. Click a finding to jump to its step and highlight the players; some come with a one-click **Fix**, such as a safer receiver, a longer step, an earlier release, making the opponents react or moving the team with the play.
- **Assistant coach.**
  - *Generate attacking move*: continues the tactic with support runs that look for space, safe passes, carries, lofted balls over a block and a finish. Every proposed step is checked by the analysis engine first.
  - *Generate press*: the nearest player presses the ball, the next players screen the passing lanes and the rest shift across.
  - Formation advice against the opponent's shape, coaching points drawn from the analysis, and related library tactics.
  - **Optional AI coach (Claude):** add an Anthropic API key in Settings to ask questions about the tactic in plain language. The key stays in your browser.
- **Library.** Built-in tactics for every size of game, based on common coaching patterns and played against a defence that presses and tracks:
  - 4v4 wall pass and third-man run
  - futsal kick-off (ala isolation), futsal kick-in, and beating the press through the pivo
  - 6v6 passing pattern (unopposed)
  - 7v7 2v1: dribble inside while the full-back overlaps
  - 9v9 overload and switch
  - 11v11 build-up against a 4-4-2 press (the 6 drops in), 4-4-2 counter behind the full-back, 4-3-3 touchline pressing trap, and a short corner with a cutback

  Every preset is tested to analyse at grade A with no realism problems. Editing a built-in tactic saves your own copy. Tactics are saved in the browser and can be exported or imported as JSON files to share.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine and analysis tests
npm run build      # production build in dist/
```

`scripts/tune-presets.ts` is a development tool that re-tunes the built-in tactics (release timing, step length and receiver positions) after engine changes: `npx vite-node scripts/tune-presets.ts [preset-key]`.

## Project layout

```
src/
  model/        data types, pitch dimensions, formations, board-state simulation
  engine/       animation, geometry, passing options and xG, analysis, assistant coach,
                team defending (defence.ts), team support (support.ts), both together
                step by step (teams.ts) and run de-confliction (deconflict.ts)
  presets/      built-in tactics (written in pitch fractions so they scale to any pitch)
  ai/           optional Claude coach (loaded only when used)
  components/   React UI: pitch (SVG), toolbar, timeline, panels, dialogs
  store.ts      Zustand store with undo/redo, saved to localStorage
```

Coordinates are in metres. The home team (your team) always attacks to the right.

## Phase 2 (planned)

Upload match video and analyse it against these tactics. `Tactic.source` is already reserved for a video reference and time offset, so scenarios can be linked to video clips.
