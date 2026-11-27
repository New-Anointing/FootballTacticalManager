import { useEffect, useRef, useState } from 'react';
import { useBoards, useCurrentBoard, type BoardTool } from '../../boardStore';
import { BoardCanvas } from './BoardCanvas';
import { BoardPanel } from './BoardPanel';
import { BoardSidebar } from './BoardSidebar';
import { BoardToolbar } from './BoardToolbar';
import { exportSvgPng } from './exportPng';

const KEYS: Record<string, BoardTool> = { v: 'select', p: 'pen', l: 'line', r: 'rect', e: 'ellipse', t: 'text', x: 'erase' };

function useBoardShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      const s = useBoards.getState();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'y')) {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === 'a') {
        e.preventDefault();
        const b = s.boards.find((x) => x.id === s.currentId);
        if (b) s.select(b.pieces.map((pc) => pc.id));
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.length) {
          e.preventDefault();
          s.removeSelected();
        }
      } else if (e.key === 'Escape') {
        if (s.presenting && s.tool === 'select' && !s.selection.length) s.setPresenting(false);
        s.setTool('select');
        s.select([]);
      } else if (k === 'a') s.setArrowStyle(s.arrowStyle);
      else if (KEYS[k]) s.setTool(KEYS[k]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function BoardPresent({ svgRef }: { svgRef: React.RefObject<SVGSVGElement> }) {
  const board = useCurrentBoard();
  const { setPresenting, clear } = useBoards();
  return (
    <div className="present">
      <div className="bar">
        <span className="name">{board.name}</span>
        <button onClick={() => clear('drawings')} disabled={!board.drawings.length}>Clear drawings</button>
        <button onClick={() => setPresenting(false)}>Close</button>
      </div>
      <BoardToolbar compact />
      <div className="pitch-wrap">
        <BoardCanvas board={board} svgRef={svgRef} />
      </div>
    </div>
  );
}

/** The free tactics board: no steps, no animation; just the board. */
export function BoardMode({ mobile }: { mobile: 'library' | 'board' | 'panel' }) {
  const board = useCurrentBoard();
  const presenting = useBoards((s) => s.presenting);
  const svgRef = useRef<SVGSVGElement>(null);
  const presentRef = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);
  useBoardShortcuts();

  const exportPng = () => {
    const svg = svgRef.current;
    if (!svg) return;
    setError(null);
    exportSvgPng(svg, board.name).catch(() => setError('Could not export the board on this browser.'));
  };

  return (
    <main className="main" data-mobile={mobile}>
      <aside className="sidebar">
        <BoardSidebar />
      </aside>
      <section className="center">
        <BoardToolbar onExport={exportPng} />
        <div className="pitch-wrap board-wrap" data-tour="board-pitch">
          <BoardCanvas board={board} svgRef={svgRef} />
          {error && <div className="caption">{error}</div>}
        </div>
        {board.notes && <div className="board-notes">{board.notes}</div>}
      </section>
      <aside className="panel">
        <BoardPanel onExport={exportPng} />
      </aside>
      {presenting && <BoardPresent svgRef={presentRef} />}
    </main>
  );
}
