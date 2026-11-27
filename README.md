# Football Tactical Manager

A web app for coaches and managers to **design, animate and analyse football tactics**, from 4v4 (3 outfield players + goalkeeper) up to 11v11.

## Phase 1 features

- **Formations and tactics for 4v4 → 11v11.** Each format gets the right pitch size (futsal court, 7-a-side, 9-a-side, full size) and a set of formations; offside is on by default from 8v8 up.
- **Movement editor.** Drag players into a starting shape, then build the move step by step:
  - **Run**: multi-waypoint runs (dashed arrows).
  - **Pass / Cross / Dribble / Shoot / Clear**: ball actions (solid arrows), with adjustable release timing.
  - A coaching note and an **expected outcome** per step (keep the ball, progress, switch play, create a chance, score, win it back, clear).
  - Undo/redo and keyboard shortcuts (`V R P C D S L` tools, `Space` play, `←/→` steps, `Ctrl+Z`).
- **Animation.** Play the tactic back with eased runs, timed passes and lofted crosses; scrub, change speed and loop. **Present** mode shows a full-screen view with captions for players.
- **Analysis mode.** A rule engine replays every step and judges the tactic:
  - realistic running speeds and pass speeds
  - passing lanes checked against *moving* defenders (interceptions and risky lanes)
  - offside at the moment the ball is played
  - pressure on receivers and dribbles into defenders
  - shot quality (a simple xG model)
  - width, depth, crowding, rest defence and safe passing options
  - defensive shape: players goal-side of the ball, unmarked attackers, a stretched block
  - whether each step achieves its expected outcome

  Findings give a 0–100 score and grade. Click a finding to jump to its step and highlight the players; some come with a one-click **Fix**, such as a safer receiver, a longer step or an earlier release.
- **Assistant coach.**
  - *Generate attacking move*: continues the tactic with support runs that look for space, safe passes, carries, lofted balls over a block and a finish. Every proposed step is checked by the analysis engine first.
  - *Generate press*: the nearest player presses the ball, the next players screen the passing lanes and the rest shift across.
  - Formation advice against the opponent's shape, coaching points drawn from the analysis, and related library tactics.
  - **Optional AI coach (Claude):** add an Anthropic API key in Settings to ask questions about the tactic in plain language. The key stays in your browser.
- **Library.** Built-in tactics for every size of game: 4v4 rotation, a futsal kick-off routine, an unopposed 6v6 pattern, a 7v7 overlap and cutback, a 9v9 switch of play, an 11v11 build-up, a counter-attack, a pressing trap and a corner. Editing a built-in tactic saves your own copy. Tactics are saved in the browser and can be exported or imported as JSON files to share.

## Running it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine and analysis tests
npm run build      # production build in dist/
```

## Project layout

```
src/
  model/        data types, pitch dimensions, formations, board-state simulation
  engine/       animation, geometry, passing options and xG, analysis, assistant coach
  presets/      built-in tactics (written in pitch fractions so they scale to any pitch)
  ai/           optional Claude coach (loaded only when used)
  components/   React UI: pitch (SVG), toolbar, timeline, panels, dialogs
  store.ts      Zustand store with undo/redo, saved to localStorage
```

Coordinates are in metres. The home team (your team) always attacks to the right.

## Phase 2 (planned)

Upload match video and analyse it against these tactics. `Tactic.source` is already reserved for a video reference and time offset, so scenarios can be linked to video clips.
