import { useRef, useState } from 'react';
import { FORMATS, type Tactic } from '../model/types';
import { PRESET_TACTICS } from '../presets/tactics';
import { useStore } from '../store';

const PHASE_LABEL: Record<string, string> = {
  attack: 'Attack', defence: 'Defence', transition: 'Transition', 'set-piece': 'Set piece',
};

function TacticCard({ t, current, onOpen }: { t: Tactic; current: boolean; onOpen: () => void }) {
  return (
    <div className={`card clickable ${current ? 'current' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <h3>{t.name}</h3>
      <div style={{ margin: '4px 0' }}>
        <span className="tag">{t.format}v{t.format}</span>
        <span className="tag">{PHASE_LABEL[t.phase]}</span>
        <span className="tag">{t.homeFormation}</span>
        {t.steps.length > 0 && <span className="tag">{t.steps.length} steps</span>}
      </div>
      {t.description && <p>{t.description}</p>}
    </div>
  );
}

export function Library({ onNew }: { onNew: () => void }) {
  const { library, current, openTactic, deleteTactic, duplicateCurrent, importTactics } = useStore();
  const [tab, setTab] = useState<'mine' | 'presets'>(library.length ? 'mine' : 'presets');
  const [format, setFormat] = useState<number | 'all'>('all');
  const fileRef = useRef<HTMLInputElement>(null);

  const list = (tab === 'mine' ? library : PRESET_TACTICS).filter((t) => format === 'all' || t.format === format);

  const exportCurrent = () => {
    const blob = new Blob([JSON.stringify({ app: 'football-tactical-manager', version: 1, tactics: [current] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${current.name.replace(/[^\w-]+/g, '_') || 'tactic'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const tactics: Tactic[] = Array.isArray(data) ? data : data.tactics ?? [data];
      const n = importTactics(tactics);
      alert(n ? `Imported ${n} tactic${n > 1 ? 's' : ''}.` : 'No valid tactics found in that file.');
      if (n) setTab('mine');
    } catch {
      alert('Could not read that file. Export files from this app are JSON.');
    }
  };

  return (
    <div>
      <button className="primary" style={{ width: '100%' }} onClick={onNew}>+ New tactic</button>
      <div className="list-actions">
        <button onClick={duplicateCurrent} title="Save a copy of the open tactic">Duplicate</button>
        <button onClick={exportCurrent} title="Download the open tactic as a file to share">Export</button>
        <button onClick={() => fileRef.current?.click()}>Import</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>
      <div className="tabs" style={{ position: 'static' }}>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>My tactics ({library.length})</button>
        <button className={tab === 'presets' ? 'active' : ''} onClick={() => setTab('presets')}>Library</button>
      </div>
      <select value={format} onChange={(e) => setFormat(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))} aria-label="Filter by format">
        <option value="all">All formats</option>
        {FORMATS.map((f) => (
          <option key={f} value={f}>{f}v{f}</option>
        ))}
      </select>
      <div style={{ marginTop: 10 }}>
        {list.length === 0 && (
          <p className="muted small">
            {tab === 'mine' ? 'Nothing saved yet. Create a tactic, or open one from the Library and edit it to make your own copy.' : 'No presets for this format yet.'}
          </p>
        )}
        {list.map((t) => (
          <div key={t.id}>
            <TacticCard t={t} current={t.id === current.id} onOpen={() => openTactic(t.id)} />
            {tab === 'mine' && t.id === current.id && (
              <button
                className="ghost danger small"
                style={{ marginTop: -4, marginBottom: 8 }}
                onClick={() => confirm(`Delete "${t.name}"?`) && deleteTactic(t.id)}
              >
                Delete
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
