import { useState } from 'react';
import { FORMATIONS, defaultFormation } from '../model/formations';
import { pitchFor } from '../model/pitch';
import { FORMATS, type TacticPhase } from '../model/types';
import { useStore } from '../store';

export function NewTacticDialog({ onClose }: { onClose: () => void }) {
  const newTactic = useStore((s) => s.newTactic);
  const [format, setFormat] = useState(11);
  const [home, setHome] = useState(defaultFormation(11));
  const [away, setAway] = useState(defaultFormation(11));
  const [name, setName] = useState('');
  const [phase, setPhase] = useState<TacticPhase>('attack');
  const [opponents, setOpponents] = useState(true);

  const pickFormat = (f: number) => {
    setFormat(f);
    setHome(defaultFormation(f));
    setAway(FORMATIONS[f][1] ?? defaultFormation(f));
  };

  const create = () => {
    newTactic({
      name: name.trim() || `${format}v${format} ${phase} (${home})`,
      format,
      homeFormation: home,
      awayFormation: away,
      showOpponents: opponents,
      phase,
    });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New tactic">
        <h1>New tactic</h1>
        <p className="muted small">Pick the number of players per side (including goalkeepers), then the formations.</p>
        <label>Players per side</label>
        <div className="format-grid">
          {FORMATS.map((f) => (
            <button key={f} className={f === format ? 'active' : ''} onClick={() => pickFormat(f)}>
              {f}v{f}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          {pitchFor(format).label}: {pitchFor(format).length} × {pitchFor(format).width} m
          {format >= 8 ? ' · offside on' : ' · no offside'}
        </p>
        <div className="row">
          <div>
            <label>Your formation</label>
            <select value={home} onChange={(e) => setHome(e.target.value)}>
              {FORMATIONS[format].map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label>Opponent formation</label>
            <select value={away} onChange={(e) => setAway(e.target.value)} disabled={!opponents}>
              {FORMATIONS[format].map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div>
            <label>Phase of play</label>
            <select value={phase} onChange={(e) => setPhase(e.target.value as TacticPhase)}>
              <option value="attack">Attack / build-up</option>
              <option value="defence">Defence / pressing</option>
              <option value="transition">Transition / counter</option>
              <option value="set-piece">Set piece</option>
            </select>
          </div>
          <div>
            <label>Name (optional)</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Right-side overload" />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={opponents} onChange={(e) => setOpponents(e.target.checked)} />
          Include opponents (turn off for unopposed patterns)
        </label>
        <div className="foot">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}
