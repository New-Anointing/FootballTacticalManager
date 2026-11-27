import { useState } from 'react';
import { useBoards, useCurrentBoard } from '../../boardStore';
import { CONE_COLORS, DRAW_COLORS, playerText, type BoardOrientation, type BoardView } from '../../model/board';
import { FORMATIONS, defaultFormation } from '../../model/formations';
import { FORMATS } from '../../model/types';

const KIND_NAMES: Record<string, string> = {
  player: 'Player', ball: 'Ball', cone: 'Cone', pole: 'Pole', goal: 'Mini goal', mannequin: 'Mannequin',
  arrow: 'Arrow', line: 'Line', pen: 'Drawing', rect: 'Zone', ellipse: 'Zone', text: 'Text',
};

function Swatches({ colors, value, onPick }: { colors: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className="swatches" style={{ margin: '4px 0 8px' }}>
      {colors.map((c) => (
        <button key={c} className={`swatch ${value === c ? 'on' : ''}`} style={{ background: c }} onClick={() => onPick(c)} aria-label={`Colour ${c}`} />
      ))}
    </div>
  );
}

/** Properties of what's selected, or the board's own settings. */
export function BoardPanel({ onExport }: { onExport: () => void }) {
  const board = useCurrentBoard();
  const { selection, change, removeSelected, select, updateMember, lineUpTeam, clear, setFormat, arrangeSelected } = useBoards();
  const [homeF, setHomeF] = useState<string>(() => defaultFormation(board.format));
  const [awayF, setAwayF] = useState<string>(() => FORMATIONS[board.format][1] ?? defaultFormation(board.format));
  const pieces = board.pieces.filter((pc) => selection.includes(pc.id));
  const drawings = board.drawings.filter((d) => selection.includes(d.id));
  const formations = FORMATIONS[board.format] ?? [];
  const homeFormation = formations.includes(homeF) ? homeF : defaultFormation(board.format);
  const awayFormation = formations.includes(awayF) ? awayF : defaultFormation(board.format);

  if (pieces.length + drawings.length > 1) {
    const players = pieces.filter((pc) => pc.kind === 'player').length;
    return (
      <div>
        <h2>{pieces.length + drawings.length} selected</h2>
        <p className="small muted">Drag any of them to move the group. Shift-click adds to the selection.</p>
        {players >= 2 && (
          <div className="list-actions">
            <button onClick={() => arrangeSelected('line')} title="Same depth: a flat line across the pitch">Make a line</button>
            <button onClick={() => arrangeSelected('spread')} title="Equal gaps across the pitch">Spread evenly</button>
          </div>
        )}
        <div className="list-actions">
          <button className="danger" onClick={removeSelected}>Remove</button>
          <button className="ghost" onClick={() => select([])}>Deselect</button>
        </div>
      </div>
    );
  }

  const pc = pieces[0];
  if (pc) {
    const member = pc.squadId ? board.squad.find((m) => m.id === pc.squadId) : undefined;
    const text = playerText(board, pc);
    const setPiece = (patch: Partial<typeof pc>) => change((b) => Object.assign(b.pieces.find((x) => x.id === pc.id) ?? {}, patch));
    return (
      <div>
        <h2>{KIND_NAMES[pc.kind]}</h2>
        {pc.kind === 'player' && (
          <>
            <div className="row">
              <div style={{ flex: '0 0 80px' }}>
                <label>Number</label>
                <input
                  type="text" value={text.number}
                  onChange={(e) => (member ? updateMember(member.id, { number: e.target.value.slice(0, 3) }) : setPiece({ number: e.target.value.slice(0, 3) }))}
                />
              </div>
              <div>
                <label>{member ? 'Name' : 'Label'}</label>
                <input
                  type="text" value={member ? member.name : (pc.label ?? '')} placeholder={member?.role}
                  onChange={(e) => (member ? updateMember(member.id, { name: e.target.value }) : setPiece({ label: e.target.value }))}
                />
              </div>
            </div>
            {member && (
              <>
                <label>Position</label>
                <input type="text" value={member.role} onChange={(e) => updateMember(member.id, { role: e.target.value.slice(0, 6) })} />
              </>
            )}
            <label className="check">
              <input type="checkbox" checked={!!pc.gk} onChange={(e) => (member ? updateMember(member.id, { gk: e.target.checked }) : setPiece({ gk: e.target.checked }))} />
              Goalkeeper kit
            </label>
            {!member && (
              <div className="row tight">
                <button className={pc.team !== 'away' ? 'active' : ''} onClick={() => setPiece({ team: 'home' })}>{board.homeName || 'Us'}</button>
                <button className={pc.team === 'away' ? 'active' : ''} onClick={() => setPiece({ team: 'away' })}>{board.awayName || 'Opponent'}</button>
              </div>
            )}
            {member && <p className="small muted">From the squad list. Drag them off the board to send them back to the bench.</p>}
          </>
        )}
        {(pc.kind === 'cone' || pc.kind === 'pole' || pc.kind === 'mannequin') && (
          <>
            <label>Colour</label>
            <Swatches colors={CONE_COLORS} value={pc.color} onPick={(c) => setPiece({ color: c })} />
          </>
        )}
        {(pc.kind === 'goal' || pc.kind === 'mannequin') && (
          <>
            <label>Turn ({Math.round(pc.angle ?? 0)}°)</label>
            <input type="range" min={0} max={345} step={15} value={pc.angle ?? 0} onChange={(e) => setPiece({ angle: parseInt(e.target.value, 10) })} style={{ width: '100%', accentColor: 'var(--accent)' }} />
          </>
        )}
        <div className="list-actions">
          <button className="danger" onClick={removeSelected}>Remove</button>
          <button className="ghost" onClick={() => select([])}>Done</button>
        </div>
      </div>
    );
  }

  const d = drawings[0];
  if (d) {
    const setDrawing = (patch: Partial<typeof d>) => change((b) => Object.assign(b.drawings.find((x) => x.id === d.id) ?? {}, patch));
    return (
      <div>
        <h2>{KIND_NAMES[d.kind]}</h2>
        {d.kind === 'arrow' && (
          <div className="row tight">
            {(['run', 'pass', 'dribble'] as const).map((s) => (
              <button key={s} className={(d.style ?? 'run') === s ? 'active' : ''} onClick={() => setDrawing({ style: s })}>{s[0].toUpperCase() + s.slice(1)}</button>
            ))}
          </div>
        )}
        {d.kind === 'pen' && (
          <label className="check"><input type="checkbox" checked={!!d.head} onChange={(e) => setDrawing({ head: e.target.checked })} /> Arrowhead</label>
        )}
        {d.kind === 'text' && (
          <>
            <label>Text</label>
            <input type="text" value={d.text ?? ''} onChange={(e) => setDrawing({ text: e.target.value })} />
          </>
        )}
        <label>Colour</label>
        <Swatches colors={DRAW_COLORS} value={d.color} onPick={(c) => setDrawing({ color: c })} />
        <div className="list-actions">
          <button className="danger" onClick={removeSelected}>Remove</button>
          <button className="ghost" onClick={() => select([])}>Done</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Board</h2>
      <label>Pitch</label>
      <select value={board.format} onChange={(e) => setFormat(parseInt(e.target.value, 10))}>
        {FORMATS.map((f) => <option key={f} value={f}>{f === 5 ? '5v5 futsal court' : `${f}v${f} pitch`}</option>)}
      </select>
      <div className="row">
        <div>
          <label>Show</label>
          <select value={board.view} onChange={(e) => change((b) => void (b.view = e.target.value as BoardView))}>
            <option value="full">Full pitch</option>
            <option value="attack">Attacking half</option>
            <option value="defence">Defending half</option>
          </select>
        </div>
        <div>
          <label>Layout</label>
          <select value={board.orientation ?? 'auto'} onChange={(e) => change((b) => void (b.orientation = e.target.value as BoardOrientation))}>
            <option value="auto">Auto (fit screen)</option>
            <option value="horizontal">Horizontal</option>
            <option value="vertical">Vertical</option>
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label>Our team</label>
          <input type="text" value={board.homeName} onChange={(e) => change((b) => void (b.homeName = e.target.value))} />
        </div>
        <div>
          <label>Opponent</label>
          <input type="text" value={board.awayName} onChange={(e) => change((b) => void (b.awayName = e.target.value))} />
        </div>
      </div>

      <div data-tour="line-up">
      <h2>Line up</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Puts the first players of the squad into a formation. The rest stay on the bench.</p>
      <div className="row">
        <select value={homeFormation} onChange={(e) => setHomeF(e.target.value)} aria-label="Our formation">
          {formations.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button style={{ flex: '0 0 auto' }} onClick={() => lineUpTeam('home', homeFormation)}>Line up {board.homeName || 'us'}</button>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <select value={awayFormation} onChange={(e) => setAwayF(e.target.value)} aria-label="Opponent formation">
          {formations.map((f) => <option key={f}>{f}</option>)}
        </select>
        <button style={{ flex: '0 0 auto' }} onClick={() => lineUpTeam('away', awayFormation)}>Line up {board.awayName || 'them'}</button>
      </div>
      </div>

      <h2>Notes</h2>
      <textarea value={board.notes} placeholder="Key messages for the players…" onChange={(e) => change((b) => void (b.notes = e.target.value))} />

      <h2>Clear</h2>
      <div className="list-actions">
        <button onClick={() => clear('drawings')} disabled={!board.drawings.length}>Drawings</button>
        <button onClick={() => clear('players')}>Players</button>
        <button className="danger" onClick={() => confirm('Clear everything on this board?') && clear('all')}>Everything</button>
      </div>
      <div className="list-actions">
        <button className="primary" onClick={onExport}>Export PNG</button>
      </div>
      <p className="small muted">
        Tips: drag pieces anywhere; drag a box to move a group; draw arrows from a player; drag a player off the board to bench them. Undo with Ctrl+Z.
      </p>
    </div>
  );
}
