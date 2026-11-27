import { useState } from 'react';
import { AI_MODEL } from '../ai/config';
import { useStore } from '../store';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { settings, setSettings } = useStore();
  const [key, setKey] = useState(settings.apiKey);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Settings">
        <h1>Settings</h1>
        <h2>Board</h2>
        <div className="row">
          <div>
            <label>Your team colour</label>
            <input type="color" value={settings.homeColor} onChange={(e) => setSettings({ homeColor: e.target.value })} style={{ width: '100%', height: 34 }} />
          </div>
          <div>
            <label>Opponent colour</label>
            <input type="color" value={settings.awayColor} onChange={(e) => setSettings({ awayColor: e.target.value })} style={{ width: '100%', height: 34 }} />
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.showLabels} onChange={(e) => setSettings({ showLabels: e.target.checked })} /> Show role / name labels
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.showGhosts} onChange={(e) => setSettings({ showGhosts: e.target.checked })} /> Show where players start each step (ghosts)
        </label>

        <h2>AI coach (optional)</h2>
        <p className="muted small">
          The built-in assistant coach and analysis work offline. To also get written advice from Claude ({AI_MODEL}), paste an Anthropic API key.
          It is stored only in this browser and sent only to the Anthropic API. Each question uses API credits on your account.
        </p>
        <label>Anthropic API key</label>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" />
        <div className="foot">
          {settings.apiKey && (
            <button className="danger" onClick={() => { setSettings({ apiKey: '' }); setKey(''); }}>Remove key</button>
          )}
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={() => { setSettings({ apiKey: key.trim() }); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
