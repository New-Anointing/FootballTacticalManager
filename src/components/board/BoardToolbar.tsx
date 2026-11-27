import type { DragEvent, ReactNode } from 'react';
import { useBoards, type BoardTool, type PlaceItem } from '../../boardStore';
import { DRAW_COLORS, type ArrowStyle } from '../../model/board';
import { useStore } from '../../store';
import { DND_PIECE } from './BoardCanvas';

const TOOLS: { tool: BoardTool; label: string; key: string; title: string }[] = [
  { tool: 'select', label: 'Move', key: 'V', title: 'Move pieces, drag a box to select a group' },
  { tool: 'pen', label: 'Pen', key: 'P', title: 'Draw freehand' },
  { tool: 'line', label: 'Line', key: 'L', title: 'Straight line' },
  { tool: 'rect', label: 'Zone ▭', key: 'R', title: 'Shade a rectangular zone' },
  { tool: 'ellipse', label: 'Zone ◯', key: 'E', title: 'Shade a round zone' },
  { tool: 'text', label: 'Text', key: 'T', title: 'Write a note on the board' },
  { tool: 'erase', label: 'Eraser', key: 'X', title: 'Tap or scrub over drawings and pieces to remove them' },
];

const ARROWS: { style: ArrowStyle; label: string; title: string }[] = [
  { style: 'run', label: 'Run', title: 'Run without the ball (dashed arrow)' },
  { style: 'pass', label: 'Pass', title: 'Pass (solid arrow)' },
  { style: 'dribble', label: 'Dribble', title: 'Dribble (wavy arrow)' },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="-10 -10 20 20" width={16} height={16} aria-hidden style={{ verticalAlign: '-3px', marginRight: 4 }}>
      {children}
    </svg>
  );
}

export function BoardToolbar({ onExport, compact = false }: { onExport?: () => void; compact?: boolean }) {
  const { tool, place, arrowStyle, color, setTool, setArrowStyle, setColor, undo, redo, past, future, setPresenting, presenting } = useBoards();
  const settings = useStore((s) => s.settings);
  const pieces: { item: PlaceItem; label: string; icon: ReactNode; title: string }[] = [
    { item: { kind: 'player', team: 'home' }, label: 'Us', title: 'Add one of our players', icon: <circle r={8} fill={settings.homeColor} stroke="#000" strokeWidth={1.5} /> },
    { item: { kind: 'player', team: 'away' }, label: 'Opp', title: 'Add an opponent', icon: <circle r={8} fill={settings.awayColor} stroke="#000" strokeWidth={1.5} /> },
    { item: { kind: 'player', team: 'home', gk: true }, label: 'GK', title: 'Add a goalkeeper', icon: <circle r={8} fill="#3fb950" stroke="#000" strokeWidth={1.5} /> },
    { item: { kind: 'ball' }, label: 'Ball', title: 'Add a ball', icon: <circle r={7} fill="#fff" stroke="#000" strokeWidth={1.5} /> },
    { item: { kind: 'cone' }, label: 'Cone', title: 'Add a cone', icon: <polygon points="0,-8 7,6 -7,6" fill="#ff8c1a" stroke="#000" strokeWidth={1} /> },
    { item: { kind: 'pole' }, label: 'Pole', title: 'Add a pole / flag', icon: <g><line x1={-3} y1={8} x2={-3} y2={-8} stroke="#ddd" strokeWidth={2} /><polygon points="-3,-8 6,-4 -3,0" fill="#ffd54a" /></g> },
    { item: { kind: 'goal' }, label: 'Goal', title: 'Add a mini goal', icon: <rect x={-8} y={-4} width={16} height={8} fill="none" stroke="#fff" strokeWidth={2} /> },
    { item: { kind: 'mannequin' }, label: 'Dummy', title: 'Add a mannequin / wall dummy', icon: <rect x={-8} y={-3} width={16} height={6} rx={3} fill="#4dabf7" stroke="#000" strokeWidth={1} /> },
  ];
  const isPlacing = (item: PlaceItem) => tool === 'place' && place && JSON.stringify(place) === JSON.stringify(item);
  const dragStart = (item: PlaceItem) => (e: DragEvent) => {
    e.dataTransfer.setData(DND_PIECE, JSON.stringify(item));
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="toolbar board-toolbar" data-tour="board-tools">
      {TOOLS.slice(0, 1).map((t) => (
        <button key={t.tool} className={tool === t.tool ? 'active' : ''} onClick={() => setTool(t.tool)} title={`${t.title} (${t.key})`}>{t.label}</button>
      ))}
      <span className="seg" role="group" aria-label="Arrows" data-tour="board-arrows">
        {ARROWS.map((a) => (
          <button key={a.style} className={tool === 'arrow' && arrowStyle === a.style ? 'active' : ''} onClick={() => setArrowStyle(a.style)} title={`${a.title}. Drag from a player; curve it by drawing a curve (A)`}>
            {a.label}
          </button>
        ))}
      </span>
      {TOOLS.slice(1).map((t) => (
        <button key={t.tool} className={tool === t.tool ? 'active' : ''} onClick={() => setTool(t.tool)} title={`${t.title} (${t.key})`}>{t.label}</button>
      ))}
      <span className="sep" />
      {!compact && (
        <>
          <span className="piece-group" data-tour="board-pieces">
          {pieces.map((pc) => (
            <button
              key={pc.label}
              className={isPlacing(pc.item) ? 'active' : ''}
              draggable
              onDragStart={dragStart(pc.item)}
              onClick={() => (isPlacing(pc.item) ? setTool('select') : setTool('place', pc.item))}
              title={`${pc.title}: tap the board to place (or drag it on)`}
            >
              <Icon>{pc.icon}</Icon>{pc.label}
            </button>
          ))}
          </span>
          <span className="sep" />
        </>
      )}
      <span className="swatches" role="group" aria-label="Drawing colour">
        {DRAW_COLORS.map((c) => (
          <button key={c} className={`swatch ${color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} title="Drawing colour" />
        ))}
      </span>
      <span className="sep" />
      <button onClick={undo} disabled={!past.length} title="Undo (Ctrl+Z)">Undo</button>
      <button onClick={redo} disabled={!future.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
      {!compact && onExport && <button onClick={onExport} title="Save the board as an image to share" data-tour="board-export">Export PNG</button>}
      {!presenting && <button onClick={() => setPresenting(true)} title="Full-screen board for the dressing room">Present</button>}
    </div>
  );
}
