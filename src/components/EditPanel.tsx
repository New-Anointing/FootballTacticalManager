import { FORMATIONS } from '../model/formations';
import { playerById, playerLabel } from '../model/tactic';
import type { StepOutcome, TacticPhase } from '../model/types';
import { statesOf } from '../derived';
import { useStore } from '../store';

const OUTCOMES: { id: StepOutcome; label: string }[] = [
  { id: 'none', label: 'No specific outcome' },
  { id: 'retain', label: 'Keep possession' },
  { id: 'progress', label: 'Progress the ball' },
  { id: 'switch', label: 'Switch play' },
  { id: 'chance', label: 'Create a chance' },
  { id: 'goal', label: 'Score' },
  { id: 'regain', label: 'Win the ball back' },
  { id: 'clear', label: 'Clear the danger' },
];

export function EditPanel() {
  const { current: t, stepIndex, selectedPlayer, update, setFormation, clearMove, deleteStep, moveStep, setBallAction, setBallStart, selectPlayer } = useStore();
  const step = stepIndex >= 0 ? t.steps[stepIndex] : undefined;
  const states = statesOf(t);
  const sel = playerById(t, selectedPlayer);
  const holder = playerById(t, states[Math.max(0, stepIndex)]?.ballOwner);

  return (
    <div>
      {step ? (
        <>
          <h2>Step {stepIndex + 1}</h2>
          <label>Coaching note (shown during playback)</label>
          <textarea
            value={step.note}
            placeholder="e.g. Pivot drops to drag the centre-back out"
            onChange={(e) => update((x) => void (x.steps[stepIndex].note = e.target.value))}
          />
          <div className="row">
            <div>
              <label>Expected outcome</label>
              <select value={step.expectedOutcome} onChange={(e) => update((x) => void (x.steps[stepIndex].expectedOutcome = e.target.value as StepOutcome))}>
                {OUTCOMES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 96px' }}>
              <label>Duration (s)</label>
              <input
                type="number" min={0.5} max={20} step={0.5} value={step.duration}
                onChange={(e) => update((x) => void (x.steps[stepIndex].duration = Math.max(0.5, parseFloat(e.target.value) || 1)))}
              />
            </div>
          </div>

          <label>Ball</label>
          {step.ball ? (
            <div className="card">
              <div className="row">
                <span>
                  <b style={{ textTransform: 'capitalize' }}>{step.ball.type}</b>{' '}
                  {playerById(t, step.ball.from) ? `by ${playerLabel(playerById(t, step.ball.from)!)}` : ''}
                  {step.ball.to && playerById(t, step.ball.to) ? ` → ${playerLabel(playerById(t, step.ball.to)!)}` : step.ball.target ? ' → space' : ''}
                </span>
                <button className="ghost danger" style={{ flex: '0 0 auto' }} onClick={() => setBallAction(undefined)}>Remove</button>
              </div>
              {step.ball.type !== 'dribble' && (
                <>
                  <label>Release timing: {Math.round(step.ball.releaseAt * 100)}% into the step</label>
                  <input
                    type="range" min={0} max={0.9} step={0.05} value={step.ball.releaseAt} style={{ width: '100%', accentColor: 'var(--accent)' }}
                    onChange={(e) => update((x) => void (x.steps[stepIndex].ball!.releaseAt = parseFloat(e.target.value)))}
                  />
                  <p className="muted small">Later release lets runners arrive first; earlier release beats a closing defender.</p>
                </>
              )}
            </div>
          ) : (
            <p className="muted small">
              {holder ? `${playerLabel(holder)} has the ball. Use Pass, Cross, Dribble, Shoot or Clear to add a ball action.` : 'Nobody has the ball at the start of this step.'}
            </p>
          )}

          <label>Runs in this step</label>
          {Object.keys(step.moves).length === 0 && <p className="muted small">No runs yet. Use Run, or drag players with Move.</p>}
          {Object.keys(step.moves).map((id) => {
            const pl = playerById(t, id);
            if (!pl) return null;
            return (
              <div key={id} className="row" style={{ marginBottom: 4 }}>
                <span className="small" style={{ cursor: 'pointer' }} onClick={() => selectPlayer(id)}>
                  <span className="tag">{pl.team === 'home' ? t.homeName : t.awayName}</span>{playerLabel(pl)}
                  {step.moves[id].length > 1 ? ` (${step.moves[id].length - 1} waypoints)` : ''}
                </span>
                <button className="ghost danger small" style={{ flex: '0 0 auto' }} onClick={() => clearMove(id)}>Clear</button>
              </div>
            );
          })}
          <div className="list-actions">
            <button onClick={() => moveStep(stepIndex, -1)} disabled={stepIndex === 0}>Move earlier</button>
            <button onClick={() => moveStep(stepIndex, 1)} disabled={stepIndex >= t.steps.length - 1}>Move later</button>
            <button className="danger" onClick={() => deleteStep(stepIndex)}>Delete step</button>
          </div>
        </>
      ) : (
        <>
          <h2>Setup</h2>
          <p className="muted small">
            Drag players to their starting positions. Drag the ball onto a player to give them possession. Then add steps to build the movement.
          </p>
          <label>Ball starts with</label>
          <select
            value={t.ballOwner ?? ''}
            onChange={(e) => {
              const id = e.target.value || undefined;
              setBallStart(id ? t.initial[id] : t.ballStart, id);
            }}
          >
            <option value="">Nobody (loose ball)</option>
            {t.players.filter((p) => p.team === 'home' || t.showOpponents).map((p) => (
              <option key={p.id} value={p.id}>{p.team === 'home' ? t.homeName : t.awayName}: {playerLabel(p)}</option>
            ))}
          </select>
        </>
      )}

      {sel && (
        <>
          <h2>Player</h2>
          <div className="row">
            <div style={{ flex: '0 0 70px' }}>
              <label>Number</label>
              <input type="number" min={1} max={99} value={sel.number} onChange={(e) => update((x) => void (x.players.find((p) => p.id === sel.id)!.number = parseInt(e.target.value, 10) || sel.number))} />
            </div>
            <div style={{ flex: '0 0 84px' }}>
              <label>Role</label>
              <input type="text" maxLength={5} value={sel.role} onChange={(e) => update((x) => void (x.players.find((p) => p.id === sel.id)!.role = e.target.value.toUpperCase()))} />
            </div>
            <div>
              <label>Name</label>
              <input type="text" value={sel.name} placeholder="optional" onChange={(e) => update((x) => void (x.players.find((p) => p.id === sel.id)!.name = e.target.value))} />
            </div>
          </div>
        </>
      )}

      <h2>Tactic</h2>
      <label>Description</label>
      <textarea value={t.description} placeholder="What is this tactic for?" onChange={(e) => update((x) => void (x.description = e.target.value))} />
      <div className="row">
        <div>
          <label>Phase</label>
          <select value={t.phase} onChange={(e) => update((x) => void (x.phase = e.target.value as TacticPhase))}>
            <option value="attack">Attack</option>
            <option value="defence">Defence</option>
            <option value="transition">Transition</option>
            <option value="set-piece">Set piece</option>
          </select>
        </div>
        <div>
          <label>Format</label>
          <input type="text" value={`${t.format}v${t.format}`} disabled />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Your team</label>
          <input type="text" value={t.homeName} onChange={(e) => update((x) => void (x.homeName = e.target.value))} />
        </div>
        <div>
          <label>Opponent</label>
          <input type="text" value={t.awayName} onChange={(e) => update((x) => void (x.awayName = e.target.value))} />
        </div>
      </div>
      <div className="row">
        <div>
          <label>Your formation</label>
          <select value={t.homeFormation} onChange={(e) => confirmReshape(t.steps.length) && setFormation('home', e.target.value)}>
            {FORMATIONS[t.format].map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
        <div>
          <label>Opponent formation</label>
          <select value={t.awayFormation} disabled={!t.showOpponents} onChange={(e) => confirmReshape(t.steps.length) && setFormation('away', e.target.value)}>
            {FORMATIONS[t.format].map((f) => <option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={t.showOpponents} onChange={(e) => update((x) => void (x.showOpponents = e.target.checked))} />
        Show opponents
      </label>
      <label className="check">
        <input type="checkbox" checked={t.rules.offside} onChange={(e) => update((x) => void (x.rules.offside = e.target.checked))} />
        Offside rule
      </label>
    </div>
  );
}

function confirmReshape(steps: number): boolean {
  return steps === 0 || confirm('Changing formation resets starting positions. Runs in existing steps keep their end points. Continue?');
}
