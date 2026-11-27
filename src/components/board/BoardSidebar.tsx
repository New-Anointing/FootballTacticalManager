import { useState, type DragEvent } from 'react';
import { useBoards, useCurrentBoard } from '../../boardStore';
import { FORMATIONS, defaultFormation } from '../../model/formations';
import type { TeamSide } from '../../model/types';
import { FORMATS } from '../../model/types';
import { DND_SQUAD } from './BoardCanvas';

function formatLabel(f: number) {
  return f === 5 ? '5v5 futsal' : `${f}v${f}`;
}

/** Squad list and bench: drag (or tap Place) to put a player on the board. */
function Squad() {
  const board = useCurrentBoard();
  const { updateMember, addMember, removeMember, benchMember, setTool, tool, place } = useBoards();
  const [team, setTeam] = useState<TeamSide>('home');
  const members = board.squad.filter((m) => m.team === team);
  const onBoard = new Set(board.pieces.map((pc) => pc.squadId).filter(Boolean));
  const dragStart = (id: string) => (e: DragEvent) => {
    e.dataTransfer.setData(DND_SQUAD, id);
    e.dataTransfer.effectAllowed = 'copy';
  };
  const placing = (id: string) => tool === 'place' && place?.kind === 'squad' && place.memberId === id;
  const starters = members.filter((m) => onBoard.has(m.id));
  const bench = members.filter((m) => !onBoard.has(m.id));

  const row = (m: (typeof members)[number]) => {
    const on = onBoard.has(m.id);
    return (
      <div key={m.id} className={`squad-row ${on ? 'on' : ''} ${placing(m.id) ? 'placing' : ''}`} draggable onDragStart={dragStart(m.id)} title="Drag onto the board">
        <span className="grip" aria-hidden>⋮⋮</span>
        <input className="num" type="text" value={m.number} onChange={(e) => updateMember(m.id, { number: e.target.value.slice(0, 3) })} aria-label="Shirt number" />
        <input type="text" value={m.name} placeholder={m.role} onChange={(e) => updateMember(m.id, { name: e.target.value })} aria-label="Player name" />
        {on ? (
          <button className="small ghost" onClick={() => benchMember(m.id)} title="Take off the board (back to the bench)">Bench</button>
        ) : (
          <button className={`small ${placing(m.id) ? 'active' : ''}`} onClick={() => setTool(placing(m.id) ? 'select' : 'place', { kind: 'squad', memberId: m.id })} title="Tap, then tap the board">
            Place
          </button>
        )}
        <button className="small ghost danger" onClick={() => removeMember(m.id)} aria-label={`Remove ${m.name || m.number}`} title="Remove from the squad">×</button>
      </div>
    );
  };

  return (
    <div>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <button className={team === 'home' ? 'active' : ''} onClick={() => setTeam('home')}>{board.homeName || 'Us'}</button>
        <button className={team === 'away' ? 'active' : ''} onClick={() => setTeam('away')}>{board.awayName || 'Opponent'}</button>
      </div>
      <p className="small muted" style={{ margin: '0 0 6px' }}>On the board ({starters.length})</p>
      {starters.map(row)}
      <p className="small muted" style={{ margin: '10px 0 6px' }}>Bench ({bench.length})</p>
      {bench.length === 0 && <p className="small muted">Everyone is on the board.</p>}
      {bench.map(row)}
      <button className="small" style={{ marginTop: 6 }} onClick={() => addMember(team)}>+ Add player</button>
    </div>
  );
}

export function BoardSidebar() {
  const { boards, currentId, openBoard, newBoard, duplicateBoard, deleteBoard } = useBoards();
  const [format, setFormat] = useState(11);
  return (
    <div>
      <h2>Boards</h2>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <select value={format} onChange={(e) => setFormat(parseInt(e.target.value, 10))} aria-label="Pitch for the new board" style={{ width: 'auto' }}>
          {FORMATS.map((f) => <option key={f} value={f}>{formatLabel(f)}</option>)}
        </select>
        <button
          className="primary"
          onClick={() => newBoard({ format, homeFormation: defaultFormation(format), awayFormation: FORMATIONS[format][1] ?? defaultFormation(format) })}
        >
          New board
        </button>
      </div>
      {boards.map((b) => (
        <div key={b.id} className={`card clickable ${b.id === currentId ? 'current' : ''}`} onClick={() => openBoard(b.id)}>
          <h3>{b.name || 'Untitled board'}</h3>
          <p>{formatLabel(b.format)} · {b.pieces.filter((pc) => pc.kind === 'player').length} players · {b.drawings.length} drawings</p>
          {b.id === currentId && (
            <div className="list-actions" onClick={(e) => e.stopPropagation()}>
              <button className="small" onClick={duplicateBoard}>Duplicate</button>
              <button className="small danger" onClick={() => confirm(`Delete "${b.name}"?`) && deleteBoard(b.id)}>Delete</button>
            </div>
          )}
        </div>
      ))}
      <h2>Squad</h2>
      <Squad />
    </div>
  );
}
