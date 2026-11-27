import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ballFlight, playerAt, type Frame } from '../engine/animation';
import { clamp, dist } from '../engine/geometry';
import { carryFor, type StepCarry } from '../engine/motion';
import { attackingGoal, discRadius, pitchFor, type PitchSpec } from '../model/pitch';
import { activePlayers, playerById, type BoardState } from '../model/tactic';
import type { Player, Step, Tactic, Vec } from '../model/types';
import { useStore } from '../store';

interface Props {
  tactic: Tactic;
  states: BoardState[];
  /** When set, the board shows this animation frame instead of the edit view. */
  frame?: Frame;
  stepIndex: number;
  interactive: boolean;
}

const MARGIN = 3;

export function Field({ p, small }: { p: PitchSpec; small: boolean }) {
  const stripes = 10;
  const sw = p.length / stripes;
  const c1 = small ? 'var(--court-1)' : 'var(--grass-1)';
  const c2 = small ? 'var(--court-2)' : 'var(--grass-2)';
  const lw = Math.max(0.12, p.length / 600);
  const boxTop = (p.width - p.boxWidth) / 2;
  const sixTop = (p.width - p.sixWidth) / 2;
  const goalTop = (p.width - p.goalWidth) / 2;
  const goalDepth = Math.max(1, p.length / 70);
  const arcR = p.centreRadius;
  return (
    <g>
      <rect x={-MARGIN} y={-MARGIN} width={p.length + 2 * MARGIN} height={p.width + 2 * MARGIN} fill={c2} rx={1.5} />
      {Array.from({ length: stripes }, (_, i) => (
        <rect key={i} x={i * sw} y={0} width={sw} height={p.width} fill={i % 2 ? c1 : c2} />
      ))}
      <g fill="none" stroke="var(--line)" strokeWidth={lw}>
        <rect x={0} y={0} width={p.length} height={p.width} />
        <line x1={p.length / 2} y1={0} x2={p.length / 2} y2={p.width} />
        <circle cx={p.length / 2} cy={p.width / 2} r={arcR} />
        {/* Penalty areas */}
        <rect x={0} y={boxTop} width={p.boxDepth} height={p.boxWidth} />
        <rect x={p.length - p.boxDepth} y={boxTop} width={p.boxDepth} height={p.boxWidth} />
        {p.sixDepth > 0 && (
          <>
            <rect x={0} y={sixTop} width={p.sixDepth} height={p.sixWidth} />
            <rect x={p.length - p.sixDepth} y={sixTop} width={p.sixDepth} height={p.sixWidth} />
          </>
        )}
        {!small && (
          <>
            <path d={arcPath(p.penaltySpot, p.width / 2, arcR, p.boxDepth, false)} />
            <path d={arcPath(p.length - p.penaltySpot, p.width / 2, arcR, p.length - p.boxDepth, true)} />
          </>
        )}
        {/* Goals */}
        <rect x={-goalDepth} y={goalTop} width={goalDepth} height={p.goalWidth} fill="rgba(255,255,255,0.18)" />
        <rect x={p.length} y={goalTop} width={goalDepth} height={p.goalWidth} fill="rgba(255,255,255,0.18)" />
      </g>
      <g fill="var(--line)">
        <circle cx={p.length / 2} cy={p.width / 2} r={lw * 2.5} />
        <circle cx={p.penaltySpot} cy={p.width / 2} r={lw * 2.5} />
        <circle cx={p.length - p.penaltySpot} cy={p.width / 2} r={lw * 2.5} />
      </g>
    </g>
  );
}

/** The "D" outside the penalty area: part of a circle around the spot that lies beyond the box line. */
function arcPath(cx: number, cy: number, r: number, boxX: number, right: boolean): string {
  const dx = Math.abs(boxX - cx);
  if (dx >= r) return '';
  const dy = Math.sqrt(r * r - dx * dx);
  return `M ${boxX} ${cy - dy} A ${r} ${r} 0 0 ${right ? 0 : 1} ${boxX} ${cy + dy}`;
}

function pathD(points: Vec[]): string {
  return points.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(' ');
}

/** Shorten a line so arrowheads don't sit under the player disc. */
function trimEnd(points: Vec[], by: number): Vec[] {
  if (points.length < 2) return points;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const d = dist(a, b);
  if (d <= by * 1.2) return points;
  const t = (d - by) / d;
  return [...points.slice(0, -1), { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }];
}

interface ArrowsProps {
  tactic: Tactic;
  step: Step;
  before: BoardState;
  after: BoardState;
  r: number;
  colors: { home: string; away: string };
  faded?: boolean;
  /** Overrides the layer opacity (used for the previous-step shadow). */
  opacity?: number;
  /** Prefix for marker ids so a layer can use its own (dimmer) arrowheads. */
  marker?: string;
  /** Speeds the players carry into and out of this step (where the ball is released from). */
  carry?: StepCarry;
}

function StepArrows({ tactic, step, before, after, r, colors, faded, opacity: layerOpacity, marker = 'arrow', carry = {} }: ArrowsProps) {
  const p = pitchFor(tactic.format);
  const sw = Math.max(0.18, p.length / 320);
  const opacity = layerOpacity ?? (faded ? 0.35 : 0.95);
  const visible = new Set(activePlayers(tactic).map((x) => x.id));
  const a = step.ball;
  let ballLine: Vec[] | null = null;
  let ballKind: 'pass' | 'shot' | 'dribble' | 'cross' = 'pass';
  if (a && before.positions[a.from]) {
    const origin = playerAt(step, a.from, before.positions[a.from], a.releaseAt, carry[a.from]);
    const flight = ballFlight(tactic, step, before, after, carry);
    if ((a.type === 'pass' || a.type === 'cross') && a.to && after.positions[a.to] && flight) {
      // Arrow to where the ball meets the receiver (they may carry it on from there).
      ballLine = [flight.origin, flight.dest];
      ballKind = a.type;
    } else if (a.type === 'shot') {
      const team = playerById(tactic, a.from)?.team ?? 'home';
      ballLine = [origin, a.target ?? attackingGoal(team, p)];
      ballKind = 'shot';
    } else if (a.type === 'dribble') {
      ballKind = 'dribble';
    } else if (a.target) {
      ballLine = [origin, a.target];
      ballKind = a.type === 'clearance' ? 'cross' : 'pass';
    }
  }
  return (
    <g opacity={opacity} pointerEvents="none">
      {Object.entries(step.moves).map(([id, path]) => {
        const pl = playerById(tactic, id);
        const start = before.positions[id];
        if (!pl || !start || !path.length || !visible.has(id)) return null;
        const pts = trimEnd([start, ...path], r * 1.1);
        const dribbling = a?.type === 'dribble' && a.from === id;
        return (
          <path
            key={id}
            d={pathD(pts)}
            fill="none"
            stroke={dribbling ? '#ffffff' : pl.team === 'home' ? colors.home : colors.away}
            strokeWidth={sw}
            strokeDasharray={dribbling ? `${sw * 0.6} ${sw * 2}` : `${sw * 4} ${sw * 2.5}`}
            strokeLinecap="round"
            markerEnd={`url(#${marker}-${dribbling ? 'ball' : pl.team})`}
          />
        );
      })}
      {ballLine && (
        <path
          d={ballKind === 'cross' ? curvedD(ballLine[0], ballLine[1]) : pathD(trimEnd(ballLine, r * 1.2))}
          fill="none"
          stroke={ballKind === 'shot' ? '#ff6b6b' : '#ffffff'}
          strokeWidth={sw * 1.15}
          strokeLinecap="round"
          markerEnd={`url(#${marker}-${ballKind === 'shot' ? 'shot' : 'ball'})`}
        />
      )}
    </g>
  );
}

function curvedD(a: Vec, b: Vec): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = 0.18;
  return `M ${a.x} ${a.y} Q ${mx - dy * k} ${my + dx * k} ${b.x} ${b.y}`;
}

function PlayerDisc({
  pl, pos, r, color, selected, highlighted, ghost, shadow, hasBall, showLabel, onPointerDown,
}: {
  pl: Player; pos: Vec; r: number; color: string; selected: boolean; highlighted: boolean; ghost?: boolean;
  /** Blurred "shadow" of where the player was at the start of the previous step. */
  shadow?: boolean;
  hasBall?: boolean; showLabel: boolean; onPointerDown?: (e: RPointerEvent) => void;
}) {
  const gk = pl.line === 'GK';
  const fill = gk ? (pl.team === 'home' ? '#3fb950' : '#a371f7') : color;
  const ink = contrastInk(fill);
  return (
    <g
      transform={`translate(${pos.x} ${pos.y})`}
      opacity={shadow ? 0.28 : ghost ? 0.3 : 1}
      filter={shadow ? 'url(#prev-shadow)' : undefined}
      style={{ cursor: onPointerDown ? 'grab' : 'default' }}
      onPointerDown={onPointerDown}
      pointerEvents={ghost ? 'none' : undefined}
    >
      {(selected || highlighted) && !ghost && (
        <circle r={r * 1.55} fill="none" stroke={highlighted ? '#ffd54a' : '#ffffff'} strokeWidth={r * 0.18} strokeDasharray={highlighted ? `${r * 0.4} ${r * 0.25}` : undefined} />
      )}
      <circle r={r} fill={fill} stroke="rgba(0,0,0,0.55)" strokeWidth={r * 0.12} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={r * 1.05} fontWeight={700} fill={ink}>{pl.number}</text>
      {showLabel && !ghost && (
        <text y={r * 2.05} textAnchor="middle" fontSize={r * 0.78} fontWeight={600} fill="#fff" stroke="rgba(0,0,0,0.65)" strokeWidth={r * 0.18} paintOrder="stroke">
          {pl.name || pl.role}
        </text>
      )}
      {hasBall && !ghost && <circle r={r * 0.28} cx={r * 0.85} cy={-r * 0.85} fill="#fff" stroke="#000" strokeWidth={r * 0.06} />}
    </g>
  );
}

export function contrastInk(hex: string): string {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return '#000';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

export function Pitch({ tactic, states, frame, stepIndex, interactive }: Props) {
  const p = pitchFor(tactic.format);
  const small = tactic.format <= 5;
  const r = discRadius(p);
  const svgRef = useRef<SVGSVGElement>(null);
  const {
    tool, toolSource, selectedPlayer, highlight, settings,
    setPlayerPosition, addWaypoint, setBallAction, setBallStart, selectPlayer, setToolSource,
  } = useStore();
  const [drag, setDrag] = useState<{ id: string; pos: Vec; moved: boolean } | null>(null);
  const [ballDrag, setBallDrag] = useState<Vec | null>(null);
  const [cursor, setCursor] = useState<Vec | null>(null);
  const colors = { home: settings.homeColor, away: settings.awayColor };
  const players = activePlayers(tactic);

  const editing = !frame;
  const before = stepIndex >= 0 ? states[stepIndex] : undefined;
  const after = states[Math.min(states.length - 1, stepIndex + 1)] ?? states[0];
  const positions = frame ? frame.positions : after.positions;
  const ball = frame ? frame.ball : after.ball;
  const ballHeight = frame?.ballHeight ?? 0;
  const owner = frame ? undefined : after.ballOwner;
  const stepForArrows = frame ? tactic.steps[frame.stepIndex] : stepIndex >= 0 ? tactic.steps[stepIndex] : undefined;
  const arrowsBefore = frame ? states[frame.stepIndex] : before;
  const arrowsAfter = frame ? states[frame.stepIndex + 1] : after;
  /** Who has the ball when the current step starts: the default passer / shooter. */
  const holder = (stepIndex >= 0 ? states[stepIndex] : states[0])?.ballOwner;
  const startPositions = (stepIndex >= 0 ? states[stepIndex] : states[0]).positions;

  const toPitch = (e: { clientX: number; clientY: number }): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const res = pt.matrixTransform(ctm.inverse());
    return { x: clamp(res.x, -1, p.length + 1), y: clamp(res.y, -1, p.width + 1) };
  };

  const nearestPlayer = (pos: Vec, within = r * 1.4): Player | undefined => {
    let best: Player | undefined;
    let bd = within;
    for (const pl of players) {
      const pp = positions[pl.id];
      if (!pp) continue;
      const d = dist(pp, pos);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return best;
  };

  const releaseFor: Record<string, number> = { pass: 0.4, cross: 0.35, shot: 0.3, clearance: 0.3, dribble: 0 };

  /** Apply the active drawing tool to a click on the pitch (optionally on a player). */
  const applyTool = (pos: Vec, target?: Player) => {
    if (tool === 'run') {
      if (target && (!toolSource || target.id !== toolSource)) {
        setToolSource(target.id);
        selectPlayer(target.id);
        return;
      }
      if (toolSource) addWaypoint(toolSource, pos);
      return;
    }
    const from = holder;
    if (!from) {
      alert('Nobody has the ball at the start of this step. In Setup, drag the ball onto a player first.');
      return;
    }
    if (tool === 'pass' || tool === 'cross') {
      if (target && target.id === from) return;
      setBallAction(
        target
          ? { type: tool, from, to: target.id, releaseAt: releaseFor[tool] }
          : { type: tool, from, target: pos, releaseAt: releaseFor[tool] },
      );
    } else if (tool === 'shot') {
      const team = playerById(tactic, from)?.team ?? 'home';
      const goal = attackingGoal(team, p);
      const aimed = Math.abs(pos.x - goal.x) < p.length * 0.08 ? { x: goal.x, y: clamp(pos.y, goal.y - p.goalWidth / 2 + 0.3, goal.y + p.goalWidth / 2 - 0.3) } : undefined;
      setBallAction({ type: 'shot', from, target: aimed, releaseAt: releaseFor.shot });
    } else if (tool === 'clearance') {
      setBallAction({ type: 'clearance', from, target: pos, releaseAt: releaseFor.clearance });
    } else if (tool === 'dribble') {
      setBallAction({ type: 'dribble', from, releaseAt: 0 });
      setPlayerPosition(from, pos);
    }
  };

  const onBackgroundDown = (e: RPointerEvent) => {
    if (!interactive || !editing) return;
    const pos = toPitch(e);
    if (tool === 'select') {
      selectPlayer(undefined);
      return;
    }
    applyTool(pos, nearestPlayer(pos));
  };

  const onPlayerDown = (pl: Player) => (e: RPointerEvent) => {
    if (!interactive || !editing) return;
    e.stopPropagation();
    const pos = toPitch(e);
    if (tool !== 'select') {
      applyTool(pos, pl);
      return;
    }
    selectPlayer(pl.id);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id: pl.id, pos: positions[pl.id], moved: false });
  };

  const onBallDown = (e: RPointerEvent) => {
    if (!interactive || !editing || stepIndex >= 0 || tool !== 'select') return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setBallDrag(toPitch(e));
  };

  const onMove = (e: RPointerEvent) => {
    if (!interactive) return;
    const pos = toPitch(e);
    if (drag) setDrag({ ...drag, pos, moved: drag.moved || dist(pos, positions[drag.id]) > 0.3 });
    else if (ballDrag) setBallDrag(pos);
    if (tool !== 'select') setCursor(pos);
  };

  const onUp = () => {
    if (drag) {
      if (drag.moved) setPlayerPosition(drag.id, { x: round1(drag.pos.x), y: round1(drag.pos.y) });
      setDrag(null);
    }
    if (ballDrag) {
      const onto = nearestPlayer(ballDrag, r * 1.8);
      if (onto) setBallStart(positions[onto.id], onto.id);
      else setBallStart({ x: round1(ballDrag.x), y: round1(ballDrag.y) }, undefined);
      setBallDrag(null);
    }
  };

  // Preview line for the drawing tools.
  const preview = useMemo(() => {
    if (!cursor || !editing || tool === 'select') return null;
    if (tool === 'run') {
      if (!toolSource) return null;
      const step = stepIndex >= 0 ? tactic.steps[stepIndex] : undefined;
      const path = step?.moves[toolSource];
      const from = path?.length ? path[path.length - 1] : (stepIndex >= 0 ? states[stepIndex] : states[0]).positions[toolSource];
      return from ? [from, cursor] : null;
    }
    const from = holder ? startPositions[holder] : undefined;
    return from ? [from, cursor] : null;
  }, [cursor, editing, tool, toolSource, stepIndex, tactic, states, holder, startPositions]);

  const viewBox = `${-MARGIN} ${-MARGIN} ${p.length + 2 * MARGIN} ${p.width + 2 * MARGIN}`;
  const ballR = Math.max(0.35, r * 0.42);
  let shownBall = ballDrag ?? ball;
  if (frame && ballHeight < 0.3) {
    // Keep the ball at the carrier's feet rather than on top of the shirt number.
    const carrier = players.find((pl) => positions[pl.id] && dist(positions[pl.id], ball) < r * 0.6);
    if (carrier) {
      const goal = attackingGoal(carrier.team, p);
      const dir = goal.x > ball.x ? 1 : -1;
      shownBall = { x: ball.x + dir * r * 1.05, y: ball.y + r * 0.45 };
    }
  }
  const showGhosts = editing && settings.showGhosts && before;
  // Previous step: where players were before it and the runs/passes that brought
  // them to the start of this step, drawn as a blurred shadow layer.
  const showPrev = editing && settings.showPrevStep !== false && stepIndex >= 1;
  const prevStep = showPrev ? tactic.steps[stepIndex - 1] : undefined;
  const prevBefore = showPrev ? states[stepIndex - 1] : undefined;
  const prevAfter = showPrev ? states[stepIndex] : undefined;

  return (
    <svg
      ref={svgRef}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onBackgroundDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => setCursor(null)}
      role="img"
      aria-label={`${tactic.format}v${tactic.format} tactics board`}
    >
      <defs>
        <filter id="prev-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={r * 0.18} />
        </filter>
        {(['home', 'away', 'ball', 'shot'] as const).map((k) => (
          <marker key={`p-${k}`} id={`prev-${k}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={k === 'home' ? colors.home : k === 'away' ? colors.away : k === 'shot' ? '#ff6b6b' : '#ffffff'} />
          </marker>
        ))}
        {(['home', 'away', 'ball', 'shot'] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={k === 'home' ? colors.home : k === 'away' ? colors.away : k === 'shot' ? '#ff6b6b' : '#ffffff'} />
          </marker>
        ))}
      </defs>
      <Field p={p} small={small} />

      {prevStep && prevBefore && prevAfter && (
        <g aria-label="Previous step">
          {players.map((pl) =>
            prevStep.moves[pl.id] && prevBefore.positions[pl.id] ? (
              <PlayerDisc key={`ps-${pl.id}`} pl={pl} pos={prevBefore.positions[pl.id]} r={r} color={pl.team === 'home' ? colors.home : colors.away} selected={false} highlighted={false} shadow showLabel={false} />
            ) : null,
          )}
          <StepArrows tactic={tactic} step={prevStep} before={prevBefore} after={prevAfter} r={r} colors={colors} opacity={0.3} marker="prev" carry={carryFor(tactic, states, stepIndex - 1)} />
        </g>
      )}

      {stepForArrows && arrowsBefore && arrowsAfter && (
        <StepArrows
          tactic={tactic} step={stepForArrows} before={arrowsBefore} after={arrowsAfter} r={r} colors={colors} faded={!!frame}
          carry={carryFor(tactic, states, frame ? frame.stepIndex : stepIndex)}
        />
      )}

      {showGhosts &&
        players.map((pl) =>
          tactic.steps[stepIndex]?.moves[pl.id] ? (
            <PlayerDisc key={`g-${pl.id}`} pl={pl} pos={before!.positions[pl.id]} r={r} color={pl.team === 'home' ? colors.home : colors.away} selected={false} highlighted={false} ghost showLabel={false} />
          ) : null,
        )}

      {preview && (
        <line x1={preview[0].x} y1={preview[0].y} x2={preview[1].x} y2={preview[1].y} stroke="#fff" strokeOpacity={0.7} strokeWidth={Math.max(0.15, p.length / 400)} strokeDasharray="0.8 0.6" pointerEvents="none" />
      )}

      {players.map((pl) => {
        const pos = drag?.id === pl.id ? drag.pos : positions[pl.id];
        if (!pos) return null;
        return (
          <PlayerDisc
            key={pl.id}
            pl={pl}
            pos={pos}
            r={r}
            color={pl.team === 'home' ? colors.home : colors.away}
            selected={selectedPlayer === pl.id || toolSource === pl.id}
            highlighted={highlight.includes(pl.id)}
            hasBall={editing && owner === pl.id}
            showLabel={settings.showLabels}
            onPointerDown={interactive && editing ? onPlayerDown(pl) : undefined}
          />
        );
      })}

      {(!owner || ballDrag || frame) && (
        <g pointerEvents={editing && stepIndex < 0 ? undefined : 'none'} onPointerDown={onBallDown} style={{ cursor: editing && stepIndex < 0 ? 'grab' : 'default' }}>
          {ballHeight > 0.2 && <ellipse cx={shownBall.x} cy={shownBall.y} rx={ballR} ry={ballR * 0.6} fill="rgba(0,0,0,0.35)" />}
          <circle cx={shownBall.x} cy={shownBall.y - ballHeight * 0.35} r={ballR * (1 + ballHeight * 0.04)} fill="#fff" stroke="#111" strokeWidth={ballR * 0.18} />
        </g>
      )}
      {editing && owner && stepIndex < 0 && interactive && tool === 'select' && !ballDrag && (
        // Invisible handle so the ball can be dragged off its owner in Setup.
        <circle cx={positions[owner].x + r * 0.85} cy={positions[owner].y - r * 0.85} r={r * 0.5} fill="transparent" onPointerDown={onBallDown} style={{ cursor: 'grab' }} />
      )}
    </svg>
  );
}

const round1 = (v: number) => Math.round(v * 10) / 10;
