import { useBoards } from '../boardStore';
import { statesOf } from '../derived';
import { ballFlight } from '../engine/animation';
import { carryFor } from '../engine/motion';
import { boardFromTactic } from '../model/board';
import { useStore, type Tool } from '../store';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Move', key: 'V', hint: 'Drag players. In Setup this sets starting positions; in a step it sets where they finish. Drag the ball onto a player to give them possession.' },
  { id: 'run', label: 'Run', key: 'R', hint: 'Click a player, then click the pitch to add waypoints for their run in this step.' },
  { id: 'pass', label: 'Pass', key: 'P', hint: 'The player with the ball passes: click a teammate, or empty space for a pass into space.' },
  { id: 'cross', label: 'Cross', key: 'C', hint: 'Lofted ball from the player in possession to the player you click.' },
  { id: 'dribble', label: 'Dribble', key: 'D', hint: 'Click where the ball carrier should carry the ball to.' },
  { id: 'shot', label: 'Shoot', key: 'S', hint: 'Ball carrier shoots: click inside the goal to aim, or anywhere for the centre of goal.' },
  { id: 'clearance', label: 'Clear', key: 'L', hint: 'Ball carrier clears the ball to the point you click.' },
];

/** Freeze the moment on screen onto a free tactics board: positions, ball and this step's arrows. */
function openOnBoard() {
  const { current, stepIndex } = useStore.getState();
  const states = statesOf(current);
  const at = states[Math.min(states.length - 1, stepIndex + 1)] ?? states[0];
  const before = stepIndex >= 0 ? states[stepIndex] : undefined;
  const step = stepIndex >= 0 ? current.steps[stepIndex] : undefined;
  const arrows: Parameters<typeof boardFromTactic>[3] = [];
  if (step && before) {
    for (const [id, path] of Object.entries(step.moves)) {
      const pl = current.players.find((x) => x.id === id);
      const start = before.positions[id];
      if (!pl || !start || !path.length || (pl.team === 'away' && !current.showOpponents)) continue;
      // The run ends where the player now stands on the board.
      arrows.push({ points: [start, ...path], style: step.ball?.type === 'dribble' && step.ball.from === id ? 'dribble' : 'run', team: pl.team });
    }
    const a = step.ball;
    if (a && a.type !== 'dribble' && before.positions[a.from]) {
      const flight = ballFlight(current, step, before, at, carryFor(current, states, stepIndex));
      if (flight) arrows.push({ points: [flight.origin, flight.dest], style: 'pass' });
    }
  }
  const board = boardFromTactic(current, at.positions, at.ball, arrows);
  if (step) board.name = `${current.name}: step ${stepIndex + 1}`;
  useStore.getState().setPlaying(false);
  useBoards.getState().addBoard(board);
}

export function Toolbar() {
  const { tool, setTool, stepIndex, undo, redo, past, future, toolSource, setToolSource, settings, setSettings } = useStore();
  const prevOn = settings.showPrevStep !== false;
  const active = TOOLS.find((t) => t.id === tool)!;
  const in3d = !!settings.view3d;
  const viewToggle = (
    <span className="seg" role="group" aria-label="2D or 3D" data-tour="view-toggle">
      <button className={!in3d ? 'active' : ''} onClick={() => setSettings({ view3d: false })} title="Top-down tactics board: edit and play">2D</button>
      <button className={in3d ? 'active' : ''} onClick={() => setSettings({ view3d: true })} title="Watch the tactic in 3D from a choice of cameras">3D</button>
    </span>
  );
  if (in3d) {
    return (
      <div className="toolbar" data-tour="tools">
        {viewToggle}
        <span className="sep" />
        <button onClick={openOnBoard} title="Copy what's on screen onto a free tactics board, to move pieces and draw freely" data-tour="open-on-board">Open on board</button>
        <span className="hint">3D view: pick a camera, or drag to look around. Switch to 2D to edit the move.</span>
      </div>
    );
  }
  return (
    <div className="toolbar" data-tour="tools">
      {viewToggle}
      <span className="sep" />
      {TOOLS.map((t) => (
        <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.hint} (${t.key})`} data-tour={`tool-${t.id}`}>
          {t.label}
        </button>
      ))}
      <span className="sep" />
      <button
        className={prevOn ? 'active' : ''}
        onClick={() => setSettings({ showPrevStep: !prevOn })}
        aria-pressed={prevOn}
        title={`${prevOn ? 'Hide' : 'Show'} the previous step's movement as a shadow (H)`}
      >
        Prev step {prevOn ? 'on' : 'off'}
      </button>
      <span className="sep" />
      <button onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">Undo</button>
      <button onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
      <button onClick={openOnBoard} title="Copy what's on screen onto a free tactics board, to move pieces and draw freely" data-tour="open-on-board">Open on board</button>
      {tool === 'run' && toolSource && (
        <button className="ghost" onClick={() => setToolSource(undefined)}>Finish run</button>
      )}
      <span className="hint">
        {stepIndex < 0 && tool !== 'select' ? 'Drawing goes into step 1. ' : ''}
        {active.hint}
      </span>
    </div>
  );
}
