import { useEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { useBoards, type PlaceItem } from '../../boardStore';
import { dist } from '../../engine/geometry';
import { boardViewBox, pieceRadius, playerText, type Board, type BoardDrawing, type BoardPiece } from '../../model/board';
import { pitchFor } from '../../model/pitch';
import type { Vec } from '../../model/types';
import { useStore } from '../../store';
import { contrastInk, Field } from '../Pitch';

export const DND_SQUAD = 'application/x-ftm-squad';
export const DND_PIECE = 'application/x-ftm-piece';

type Interaction =
  | { kind: 'pieces'; start: Vec; origin: Record<string, Vec>; offset: Vec; moved: boolean; hit: string; additive: boolean }
  | { kind: 'drawing'; id: string; start: Vec; offset: Vec; moved: boolean }
  | { kind: 'band'; start: Vec; end: Vec; additive: boolean }
  | { kind: 'stroke'; points: Vec[] }
  | { kind: 'shape'; start: Vec; end: Vec };

const GK_COLORS = { home: '#3fb950', away: '#a371f7' };

function pathD(points: Vec[]): string {
  return points.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ');
}

/** Smooth freehand path through the sampled points. */
function smoothD(points: Vec[]): string {
  if (points.length < 3) return pathD(points);
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${mx.toFixed(2)} ${my.toFixed(2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`;
}

/** A wavy line along the points, for dribbles. */
function wavyD(points: Vec[], amp: number, wave: number): string {
  const out: Vec[] = [];
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const steps = Math.max(2, Math.ceil(len / (wave / 8)));
    for (let k = 0; k <= steps; k++) {
      const s = (k / steps) * len;
      // Fade the wave out at both ends so the arrow starts and finishes on the line.
      const total = travelled + s;
      const off = Math.sin((total / wave) * Math.PI * 2) * amp * Math.min(1, s / wave, (len - s) / wave + (i < points.length - 1 ? 1 : 0));
      out.push({ x: a.x + ux * s - uy * off, y: a.y + uy * s + ux * off });
    }
    travelled += len;
  }
  return pathD(out);
}

/** Shorten the start / end of a line when it begins or finishes on a piece. */
function trimmed(points: Vec[], pieces: BoardPiece[], r: number): Vec[] {
  if (points.length < 2) return points;
  const out = points.map((p) => ({ ...p }));
  const onPiece = (pt: Vec) => pieces.find((pc) => Math.hypot(pc.x - pt.x, pc.y - pt.y) < 0.3);
  const cut = (i: number, j: number, by: number) => {
    const a = out[i];
    const b = out[j];
    const d = dist(a, b);
    if (d > by * 1.5) out[i] = { x: a.x + ((b.x - a.x) / d) * by, y: a.y + ((b.y - a.y) / d) * by };
  };
  if (onPiece(out[0])) cut(0, 1, r * 1.1);
  if (onPiece(out[out.length - 1])) cut(out.length - 1, out.length - 2, r * 1.15);
  return out;
}

function arrowHead(points: Vec[], size: number, color: string): ReactNode {
  if (points.length < 2) return null;
  const b = points[points.length - 1];
  let a = points[points.length - 2];
  for (let k = points.length - 2; k >= 0 && dist(a, b) < size * 0.5; k--) a = points[k];
  const d = dist(a, b) || 1;
  const ux = (b.x - a.x) / d;
  const uy = (b.y - a.y) / d;
  const base = { x: b.x - ux * size, y: b.y - uy * size };
  const w = size * 0.55;
  const pts = [b, { x: base.x - uy * w, y: base.y + ux * w }, { x: base.x + uy * w, y: base.y - ux * w }];
  return <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={color} />;
}

function DrawingView({
  d, board, r, selected, upright, onPointerDown,
}: {
  d: BoardDrawing; board: Board; r: number; selected: boolean; upright: string;
  onPointerDown?: (e: RPointerEvent) => void;
}) {
  const sw = r * 0.24;
  const halo = selected ? <g opacity={0.55}>{shapeOf(d, board, r, sw * 2.6, '#ffffff', true)}</g> : null;
  return (
    <g onPointerDown={onPointerDown} style={{ cursor: onPointerDown ? 'pointer' : undefined }}>
      {halo}
      {shapeOf(d, board, r, sw, d.color, false, upright)}
      {/* Wide invisible stroke so thin lines are easy to pick up. */}
      {(d.kind === 'arrow' || d.kind === 'line' || d.kind === 'pen') && (
        <path d={pathD(d.points)} fill="none" stroke="transparent" strokeWidth={r * 1.4} strokeLinecap="round" />
      )}
    </g>
  );
}

function shapeOf(d: BoardDrawing, board: Board, r: number, sw: number, color: string, halo: boolean, upright = ''): ReactNode {
  const pts = d.kind === 'arrow' || d.kind === 'line' ? trimmed(d.points, board.pieces, r) : d.points;
  switch (d.kind) {
    case 'arrow': {
      const style = d.style ?? 'run';
      const body = style === 'dribble' ? wavyD(pts, r * 0.32, r * 1.5) : pts.length > 2 ? smoothD(pts) : pathD(pts);
      return (
        <g>
          <path
            d={body} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
            strokeDasharray={style === 'run' && !halo ? `${sw * 3.2} ${sw * 2.2}` : undefined}
          />
          {arrowHead(pts, r * 0.95 + (halo ? sw * 0.4 : 0), color)}
        </g>
      );
    }
    case 'line':
      return <path d={pathD(pts)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />;
    case 'pen':
      return (
        <g>
          <path d={smoothD(pts)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
          {d.head && arrowHead(pts, r * 0.95, color)}
        </g>
      );
    case 'rect': {
      const [a, b] = pts;
      if (!a || !b) return null;
      return (
        <rect
          x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} rx={r * 0.3}
          fill={halo ? 'none' : color} fillOpacity={0.18} stroke={color} strokeWidth={sw * 0.8} strokeDasharray={halo ? undefined : `${sw * 2} ${sw * 1.4}`}
        />
      );
    }
    case 'ellipse': {
      const [a, b] = pts;
      if (!a || !b) return null;
      return (
        <ellipse
          cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} rx={Math.abs(b.x - a.x) / 2} ry={Math.abs(b.y - a.y) / 2}
          fill={halo ? 'none' : color} fillOpacity={0.18} stroke={color} strokeWidth={sw * 0.8} strokeDasharray={halo ? undefined : `${sw * 2} ${sw * 1.4}`}
        />
      );
    }
    case 'text': {
      const at = pts[0];
      if (!at) return null;
      return (
        <g transform={`translate(${at.x} ${at.y}) ${upright}`}>
          <text
            textAnchor="middle" dominantBaseline="central" fontSize={r * 1.25} fontWeight={700}
            fill={halo ? 'none' : color} stroke={halo ? color : 'rgba(0,0,0,0.7)'} strokeWidth={halo ? r * 0.5 : r * 0.22} paintOrder="stroke"
          >
            {d.text || 'Text'}
          </text>
        </g>
      );
    }
  }
}

function PieceView({
  pc, board, r, selected, upright, colors, onPointerDown,
}: {
  pc: BoardPiece; board: Board; r: number; selected: boolean; upright: string; colors: { home: string; away: string };
  onPointerDown?: (e: RPointerEvent) => void;
}) {
  const ring = selected ? <circle r={r * 1.5} fill="none" stroke="#ffffff" strokeWidth={r * 0.16} strokeDasharray={`${r * 0.45} ${r * 0.25}`} /> : null;
  let body: ReactNode = null;
  if (pc.kind === 'player') {
    const team = pc.team ?? 'home';
    const fill = pc.gk ? GK_COLORS[team] : colors[team];
    const { number, label } = playerText(board, pc);
    body = (
      <g transform={upright}>
        <circle r={r} fill={fill} stroke="rgba(0,0,0,0.55)" strokeWidth={r * 0.12} />
        <text textAnchor="middle" dominantBaseline="central" fontSize={r * (number.length > 2 ? 0.8 : 1.05)} fontWeight={700} fill={contrastInk(fill)}>{number}</text>
        {label && (
          <text y={r * 2.05} textAnchor="middle" fontSize={r * 0.8} fontWeight={600} fill="#fff" stroke="rgba(0,0,0,0.65)" strokeWidth={r * 0.2} paintOrder="stroke">
            {label}
          </text>
        )}
      </g>
    );
  } else if (pc.kind === 'ball') {
    const br = r * 0.5;
    body = (
      <g>
        <circle r={br} fill="#ffffff" stroke="#111" strokeWidth={br * 0.14} />
        <polygon
          points={Array.from({ length: 5 }, (_, k) => {
            const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
            return `${Math.cos(a) * br * 0.42},${Math.sin(a) * br * 0.42}`;
          }).join(' ')}
          fill="#111"
        />
      </g>
    );
  } else if (pc.kind === 'cone') {
    const s = r * 0.55;
    body = (
      <g transform={upright}>
        <polygon points={`0,${-s} ${s * 0.9},${s * 0.75} ${-s * 0.9},${s * 0.75}`} fill={pc.color ?? '#ff8c1a'} stroke="rgba(0,0,0,0.6)" strokeWidth={s * 0.12} strokeLinejoin="round" />
      </g>
    );
  } else if (pc.kind === 'pole') {
    const s = r * 0.6;
    body = (
      <g transform={upright}>
        <line x1={0} y1={s} x2={0} y2={-s} stroke="#e6e6e6" strokeWidth={s * 0.16} strokeLinecap="round" />
        <polygon points={`0,${-s} ${s * 0.85},${-s * 0.62} 0,${-s * 0.25}`} fill={pc.color ?? '#ffd54a'} stroke="rgba(0,0,0,0.5)" strokeWidth={s * 0.06} />
        <circle cy={s} r={s * 0.2} fill="rgba(0,0,0,0.45)" />
      </g>
    );
  } else if (pc.kind === 'goal') {
    const w = r * 3.2;
    const dpt = r * 1.1;
    body = (
      <g transform={`rotate(${pc.angle ?? 0})`}>
        <rect x={-w / 2} y={-dpt / 2} width={w} height={dpt} fill="rgba(255,255,255,0.18)" stroke="#ffffff" strokeWidth={r * 0.16} rx={r * 0.1} />
        <line x1={-w / 2} y1={dpt / 2} x2={w / 2} y2={dpt / 2} stroke="#ffffff" strokeWidth={r * 0.32} strokeLinecap="round" />
      </g>
    );
  } else if (pc.kind === 'mannequin') {
    const w = r * 1.7;
    body = (
      <g transform={`rotate(${pc.angle ?? 0})`}>
        <rect x={-w / 2} y={-r * 0.38} width={w} height={r * 0.76} rx={r * 0.38} fill={pc.color ?? '#4dabf7'} stroke="rgba(0,0,0,0.6)" strokeWidth={r * 0.1} />
        <circle r={r * 0.34} fill="rgba(0,0,0,0.25)" />
      </g>
    );
  }
  return (
    <g transform={`translate(${pc.x} ${pc.y})`} onPointerDown={onPointerDown} style={{ cursor: onPointerDown ? 'grab' : undefined }}>
      {ring}
      {body}
    </g>
  );
}

/** Rough distance from a point to a drawing, for the eraser and selection. */
function nearDrawing(d: BoardDrawing, pt: Vec, tol: number): boolean {
  if (d.kind === 'rect' || d.kind === 'ellipse') {
    const [a, b] = d.points;
    return pt.x >= Math.min(a.x, b.x) - tol && pt.x <= Math.max(a.x, b.x) + tol && pt.y >= Math.min(a.y, b.y) - tol && pt.y <= Math.max(a.y, b.y) + tol;
  }
  if (d.kind === 'text') return dist(d.points[0], pt) < tol * 2;
  for (let i = 1; i < d.points.length; i++) {
    const a = d.points[i - 1];
    const b = d.points[i];
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / len2));
    if (dist(pt, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }) < tol) return true;
  }
  return false;
}

/** Simplify a freehand stroke; a nearly straight stroke becomes a straight line. */
function simplifyStroke(points: Vec[], r: number): Vec[] {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  const chord = dist(a, b) || 1;
  const dev = Math.max(...points.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / chord));
  if (dev < Math.max(1, r * 0.7)) return [a, b];
  const out = [a];
  for (const p of points.slice(1, -1)) if (dist(p, out[out.length - 1]) > r * 0.6) out.push(p);
  out.push(b);
  return out;
}

/** Is the space the board is shown in taller than it is wide (a phone held upright)? */
function usePortrait(ref: React.RefObject<SVGSVGElement>): boolean {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const check = () => setPortrait(el.clientHeight > el.clientWidth * 1.05);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return portrait;
}

export function BoardCanvas({ board, svgRef }: { board: Board; svgRef?: React.RefObject<SVGSVGElement> }) {
  const p = pitchFor(board.format);
  const small = board.format <= 5;
  const r = pieceRadius(board);
  const ownRef = useRef<SVGSVGElement>(null);
  const ref = svgRef ?? ownRef;
  const portrait = usePortrait(ref);
  const orientation = board.orientation ?? 'auto';
  const vertical = orientation === 'vertical' || (orientation === 'auto' && portrait);
  const vb = boardViewBox(board, vertical);
  const contentRef = useRef<SVGGElement>(null);
  const settings = useStore((s) => s.settings);
  const colors = { home: settings.homeColor, away: settings.awayColor };
  const {
    tool, place, arrowStyle, color, selection, select, movePieces, addPiece, addDrawing, moveDrawing, removeItems, setTool, benchMember,
  } = useBoards();
  const [act, setAct] = useState<Interaction | null>(null);
  const selected = new Set(selection);
  const upright = vertical ? 'rotate(90)' : '';
  const content = vertical ? `matrix(0 -1 1 0 0 ${p.length})` : undefined;

  const toPitch = (e: { clientX: number; clientY: number }): Vec => {
    const g = contentRef.current;
    const m = g?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: pt.x, y: pt.y };
  };
  const capture = (e: RPointerEvent) => {
    try {
      ref.current?.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };
  const snap = (pt: Vec): Vec => {
    const hit = board.pieces.find((pc) => dist(pc, pt) < r * 1.3);
    return hit ? { x: hit.x, y: hit.y } : pt;
  };
  const inView = (pt: Vec) => {
    const m = 0.5;
    const pts = vertical ? { x: pt.y, y: p.length - pt.x } : pt;
    return pts.x >= vb.x - m && pts.x <= vb.x + vb.w + m && pts.y >= vb.y - m && pts.y <= vb.y + vb.h + m;
  };

  const startDrawing = (pt: Vec, e: RPointerEvent) => {
    if (tool === 'pen' || tool === 'arrow') setAct({ kind: 'stroke', points: [pt] });
    else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') setAct({ kind: 'shape', start: pt, end: pt });
    capture(e);
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const pt = toPitch(e);
    if (tool === 'place' && place) {
      addPiece(place, pt);
      if (place.kind === 'squad') setTool('select');
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Text on the board', '');
      if (text && text.trim()) addDrawing({ kind: 'text', points: [pt], color, text: text.trim() });
      return;
    }
    if (tool === 'select') {
      setAct({ kind: 'band', start: pt, end: pt, additive: e.shiftKey });
      if (!e.shiftKey) select([]);
      capture(e);
      return;
    }
    if (tool === 'erase') return;
    startDrawing(pt, e);
  };

  const onPieceDown = (pc: BoardPiece) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (tool === 'erase') {
      removeItems([pc.id]);
      return;
    }
    if (tool === 'place') return onBackgroundDown(e);
    if (tool !== 'select') {
      if (tool === 'arrow' || tool === 'line' || tool === 'pen') startDrawing({ x: pc.x, y: pc.y }, e);
      return;
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let ids = selection;
    if (!selected.has(pc.id)) {
      ids = additive ? [...selection, pc.id] : [pc.id];
      select(ids);
    }
    const origin: Record<string, Vec> = {};
    for (const q of board.pieces) if (ids.includes(q.id)) origin[q.id] = { x: q.x, y: q.y };
    setAct({ kind: 'pieces', start: toPitch(e), origin, offset: { x: 0, y: 0 }, moved: false, hit: pc.id, additive });
    capture(e);
  };

  const onDrawingDown = (d: BoardDrawing) => (e: RPointerEvent) => {
    if (e.button !== 0) return;
    if (tool === 'erase') {
      e.stopPropagation();
      removeItems([d.id]);
      return;
    }
    if (tool !== 'select') return; // drawing on top of a drawing: let the background start it
    e.stopPropagation();
    select(e.shiftKey ? [...selection, d.id] : [d.id]);
    setAct({ kind: 'drawing', id: d.id, start: toPitch(e), offset: { x: 0, y: 0 }, moved: false });
    capture(e);
  };

  const onMove = (e: RPointerEvent) => {
    if (!act) {
      if (tool === 'erase' && e.buttons === 1) {
        // Scrub over drawings with the eraser held down.
        const pt = toPitch(e);
        const hit = board.drawings.find((d) => nearDrawing(d, pt, r * 0.8));
        if (hit) removeItems([hit.id]);
      }
      return;
    }
    const pt = toPitch(e);
    if (act.kind === 'pieces' || act.kind === 'drawing') {
      const offset = { x: pt.x - act.start.x, y: pt.y - act.start.y };
      setAct({ ...act, offset, moved: act.moved || Math.hypot(offset.x, offset.y) > r * 0.15 });
    } else if (act.kind === 'band') setAct({ ...act, end: pt });
    else if (act.kind === 'stroke') {
      const last = act.points[act.points.length - 1];
      if (dist(last, pt) > r * 0.25) setAct({ ...act, points: [...act.points, pt] });
    } else if (act.kind === 'shape') setAct({ ...act, end: pt });
  };

  const onUp = (e: RPointerEvent) => {
    if (!act) return;
    const pt = toPitch(e);
    if (act.kind === 'pieces') {
      if (act.moved) {
        const moves: Record<string, Vec> = {};
        const off: string[] = [];
        for (const [id, o] of Object.entries(act.origin)) {
          const to = { x: o.x + act.offset.x, y: o.y + act.offset.y };
          if (inView(to)) moves[id] = to;
          else off.push(id);
        }
        if (Object.keys(moves).length) movePieces(moves);
        // Dragged off the board: squad players go back to the bench, anything else is removed.
        for (const id of off) {
          const pc = board.pieces.find((q) => q.id === id);
          if (pc?.squadId) benchMember(pc.squadId);
          else if (pc) removeItems([pc.id]);
        }
      } else if (!act.additive) select([act.hit]);
    } else if (act.kind === 'drawing') {
      if (act.moved) moveDrawing(act.id, act.offset);
    } else if (act.kind === 'band') {
      const x0 = Math.min(act.start.x, act.end.x);
      const x1 = Math.max(act.start.x, act.end.x);
      const y0 = Math.min(act.start.y, act.end.y);
      const y1 = Math.max(act.start.y, act.end.y);
      if (x1 - x0 > 0.3 || y1 - y0 > 0.3) {
        const inside = board.pieces.filter((pc) => pc.x >= x0 && pc.x <= x1 && pc.y >= y0 && pc.y <= y1).map((pc) => pc.id);
        select(act.additive ? [...new Set([...selection, ...inside])] : inside);
      }
    } else if (act.kind === 'stroke') {
      const pts = [...act.points, pt];
      const len = pts.reduce((s, q, i) => (i ? s + dist(pts[i - 1], q) : 0), 0);
      if (len > r * 0.8) {
        if (tool === 'arrow') {
          const simple = simplifyStroke(pts, r);
          simple[simple.length - 1] = snap(simple[simple.length - 1]);
          addDrawing({ kind: 'arrow', points: simple, color: arrowStyle === 'pass' && color === '#ffd54a' ? '#ffffff' : color, style: arrowStyle });
        } else {
          const out = [pts[0]];
          for (const q of pts.slice(1)) if (dist(q, out[out.length - 1]) > r * 0.3) out.push(q);
          addDrawing({ kind: 'pen', points: out, color });
        }
      }
    } else if (act.kind === 'shape') {
      const end = tool === 'line' ? snap(pt) : pt;
      if (dist(act.start, end) > r * 0.6) addDrawing({ kind: tool === 'line' ? 'line' : tool === 'rect' ? 'rect' : 'ellipse', points: [act.start, end], color });
    }
    setAct(null);
  };

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DND_SQUAD) || e.dataTransfer.types.includes(DND_PIECE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };
  const onDrop = (e: DragEvent) => {
    const pt = toPitch(e);
    const member = e.dataTransfer.getData(DND_SQUAD);
    const piece = e.dataTransfer.getData(DND_PIECE);
    if (member) {
      e.preventDefault();
      addPiece({ kind: 'squad', memberId: member }, pt);
    } else if (piece) {
      e.preventDefault();
      try {
        addPiece(JSON.parse(piece) as PlaceItem, pt);
      } catch {
        /* not ours */
      }
    }
  };

  // Live positions while dragging.
  const shown = (pc: BoardPiece): BoardPiece =>
    act?.kind === 'pieces' && act.origin[pc.id] ? { ...pc, x: act.origin[pc.id].x + act.offset.x, y: act.origin[pc.id].y + act.offset.y } : pc;
  const shownDrawing = (d: BoardDrawing): BoardDrawing =>
    act?.kind === 'drawing' && act.id === d.id ? { ...d, points: d.points.map((q) => ({ x: q.x + act.offset.x, y: q.y + act.offset.y })) } : d;
  const zones = board.drawings.filter((d) => d.kind === 'rect' || d.kind === 'ellipse');
  const lines = board.drawings.filter((d) => d.kind !== 'rect' && d.kind !== 'ellipse');
  // Pieces stack: equipment first, then players, the ball on top.
  const order: Record<string, number> = { goal: 0, mannequin: 1, cone: 2, pole: 3, player: 4, ball: 5 };
  const pieces = [...board.pieces].sort((a, b) => order[a.kind] - order[b.kind]);
  const drawingEvents = tool === 'select' || tool === 'erase';
  const preview: BoardDrawing | null =
    act?.kind === 'stroke'
      ? { id: 'preview', kind: tool === 'arrow' ? 'arrow' : 'pen', points: act.points, color, style: arrowStyle }
      : act?.kind === 'shape'
        ? { id: 'preview', kind: tool === 'line' ? 'line' : tool === 'rect' ? 'rect' : 'ellipse', points: [act.start, act.end], color }
        : null;

  return (
    <svg
      ref={ref}
      className={`board-svg tool-${tool}`}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => setAct(null)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="img"
      aria-label={`${board.name}: tactics board`}
    >
      <g ref={contentRef} transform={content}>
        <Field p={p} small={small} />
        <g pointerEvents={drawingEvents ? undefined : 'none'}>
          {zones.map((d) => (
            <DrawingView key={d.id} d={shownDrawing(d)} board={board} r={r} selected={selected.has(d.id)} upright={upright} onPointerDown={onDrawingDown(d)} />
          ))}
        </g>
        <g pointerEvents={drawingEvents ? undefined : 'none'}>
          {lines.map((d) => (
            <DrawingView key={d.id} d={shownDrawing(d)} board={board} r={r} selected={selected.has(d.id)} upright={upright} onPointerDown={onDrawingDown(d)} />
          ))}
        </g>
        {pieces.map((pc) => (
          <PieceView key={pc.id} pc={shown(pc)} board={board} r={r} selected={selected.has(pc.id)} upright={upright} colors={colors} onPointerDown={onPieceDown(pc)} />
        ))}
        {preview && (
          <g pointerEvents="none" opacity={0.85}>
            <DrawingView d={preview} board={board} r={r} selected={false} upright={upright} />
          </g>
        )}
        {act?.kind === 'band' && (
          <rect
            x={Math.min(act.start.x, act.end.x)} y={Math.min(act.start.y, act.end.y)}
            width={Math.abs(act.end.x - act.start.x)} height={Math.abs(act.end.y - act.start.y)}
            fill="rgba(255,255,255,0.12)" stroke="#ffffff" strokeWidth={r * 0.08} strokeDasharray={`${r * 0.4} ${r * 0.3}`} pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}
