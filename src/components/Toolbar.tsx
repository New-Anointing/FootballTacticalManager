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

export function Toolbar() {
  const { tool, setTool, stepIndex, undo, redo, past, future, toolSource, setToolSource, settings, setSettings } = useStore();
  const prevOn = settings.showPrevStep !== false;
  const active = TOOLS.find((t) => t.id === tool)!;
  return (
    <div className="toolbar">
      {TOOLS.map((t) => (
        <button key={t.id} className={tool === t.id ? 'active' : ''} onClick={() => setTool(t.id)} title={`${t.hint} (${t.key})`}>
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
