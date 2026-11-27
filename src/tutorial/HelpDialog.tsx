import { useTour } from './tourStore';
import { TOURS } from './tours';

const SHORTCUTS: { mode: string; keys: [string, string][] }[] = [
  {
    mode: 'Tactics',
    keys: [
      ['V R P C D S L', 'Move, Run, Pass, Cross, Dribble, Shoot, Clear'],
      ['Space', 'Play / pause'],
      ['← →', 'Previous / next step'],
      ['H', 'Show / hide the previous step shadow'],
      ['Delete', 'Remove the selected player\'s run'],
      ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
      ['Esc', 'Cancel the current tool'],
    ],
  },
  {
    mode: 'Board',
    keys: [
      ['V P L R E T X', 'Move, Pen, Line, Zone ▭, Zone ◯, Text, Eraser'],
      ['A', 'Arrow (Run / Pass / Dribble)'],
      ['Shift + click, or drag a box', 'Select several pieces'],
      ['Ctrl+A', 'Select every piece'],
      ['Delete', 'Remove what is selected'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
      ['Esc', 'Back to Move; leave Present'],
    ],
  },
];

function TourList({ onStart }: { onStart: (id: string) => void }) {
  const completed = useTour((s) => s.completed);
  return (
    <div className="tour-list">
      {TOURS.map((t, i) => (
        <button key={t.id} className={`tour-choice ${i === 0 ? 'first' : ''}`} onClick={() => onStart(t.id)}>
          <span className="tour-choice-head">
            <b>{t.title}</b>
            <span className="muted small">{t.minutes} min{completed.includes(t.id) ? ' · done ✓' : ''}</span>
          </span>
          <span className="muted small">{t.summary}</span>
        </button>
      ))}
    </div>
  );
}

/** First visit: offer a tour. */
export function WelcomeDialog() {
  const { start, setWelcomed } = useTour();
  return (
    <div className="modal-backdrop">
      <div className="modal welcome" role="dialog" aria-labelledby="welcome-title">
        <div className="welcome-badge" aria-hidden>⚽</div>
        <h1 id="welcome-title">Welcome to Tactical Manager</h1>
        <p className="muted">
          Plan tactics from 4v4 to 11v11, animate them, have them analysed against a realistic opponent, and use the free tactics board for team
          talks. Pick a short tour to find your way round:
        </p>
        <TourList onStart={start} />
        <div className="foot">
          <button className="ghost" onClick={() => setWelcomed(true)}>Skip, I'll explore myself</button>
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>You can open the tours again any time with the ? button at the top.</p>
      </div>
    </div>
  );
}

/** The ? menu: replay a tour, see the shortcuts. */
export function HelpDialog() {
  const { start, setHelpOpen } = useTour();
  return (
    <div className="modal-backdrop" onClick={() => setHelpOpen(false)}>
      <div className="modal" role="dialog" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <h1 id="help-title">Help and tutorials</h1>
        <p className="muted small" style={{ marginTop: 0 }}>Short guided tours. Press Next or use the arrow keys; Esc ends a tour.</p>
        <TourList onStart={start} />
        <h2>Keyboard shortcuts</h2>
        {SHORTCUTS.map((g) => (
          <div key={g.mode} className="card">
            <h3>{g.mode}</h3>
            <table className="shortcuts">
              <tbody>
                {g.keys.map(([k, what]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <div className="foot">
          <button className="primary" onClick={() => setHelpOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}
