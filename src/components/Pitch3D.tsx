import { useEffect, useMemo, useRef, useState } from 'react';
import { ballFlight, type Frame } from '../engine/animation';
import { dist } from '../engine/geometry';
import { carryFor } from '../engine/motion';
import { activePlayers, type BoardState } from '../model/tactic';
import type { Tactic, Vec } from '../model/types';
import { useStore } from '../store';
import { Scene3D, type Arrow3D, type Snapshot3D } from '../three/Scene3D';
import { actionPhase, type ActionKind, type PlayerAction } from '../three/body';
import { CAMERA_PRESETS, type CameraPreset } from '../three/views';

interface Props {
  tactic: Tactic;
  states: BoardState[];
  frame?: Frame;
  stepIndex: number;
}

/** Player view: whose eyes ('carrier' follows whoever has the ball), first person or over the shoulder. */
interface PovPrefs {
  player: string;
  shoulder: boolean;
}

interface Prefs {
  camera: CameraPreset;
  names: boolean;
  arrows: boolean;
  pov: PovPrefs;
}

export const BALL_CARRIER = 'carrier';

const PREFS_KEY = 'ftm-3d-v1';

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const pov = { player: typeof v.pov?.player === 'string' ? v.pov.player : BALL_CARRIER, shoulder: v.pov?.shoulder === true };
    const camera = CAMERA_PRESETS.some((c) => c.id === v.camera) || v.camera === 'free' ? v.camera : 'broadcast';
    return { camera, names: v.names ?? true, arrows: v.arrows ?? true, pov };
  } catch {
    return { camera: 'broadcast', names: true, arrows: true, pov: { player: BALL_CARRIER, shoulder: false } };
  }
}

/** How long the ball takes to settle at a foot after a touch, or to leave it after a kick (s). */
const ATTACH_TIME = 0.15;

interface BallEvent {
  player: string;
  kind: ActionKind;
  /** Seconds from the start of the step being played (negative: an earlier step). */
  at: number;
  face: Vec;
}

/** Kicks and first touches of the steps round the one being played, timed in seconds. */
function ballEvents(t: Tactic, states: BoardState[], i: number): BallEvent[] {
  const out: BallEvent[] = [];
  let offset = 0;
  for (let j = i - 1; j >= 0 && j > i - 2; j--) offset -= Math.max(0.1, t.steps[j].duration);
  for (let j = Math.max(0, i - 1); j <= Math.min(t.steps.length - 1, i + 1); j++) {
    const step = t.steps[j];
    const D = Math.max(0.1, step.duration);
    const a = step.ball;
    if (a && a.type !== 'dribble' && states[j] && states[j + 1]) {
      const f = ballFlight(t, step, states[j], states[j + 1], carryFor(t, states, j));
      if (f) {
        out.push({ player: a.from, kind: a.type, at: offset + f.release * D, face: f.dest });
        if (f.receiver) out.push({ player: f.receiver, kind: 'receive', at: offset + f.arrive * D, face: f.origin });
      }
    }
    offset += D;
  }
  return out;
}

/**
 * Who has the ball at their feet during playback, and how firmly (0..1); and whose ball
 * it is for the "ball carrier" camera, which hands over to the receiver halfway through
 * a pass so the viewer sees it leave and then arrive.
 */
export function ballOwner(t: Tactic, states: BoardState[], i: number, stepT: number): { owner?: string; attach: number; carrier?: string } {
  const step = t.steps[i];
  const before = states[i];
  const a = step?.ball;
  if (!step || !before) return { attach: 0 };
  if (!a || !before.positions[a.from]) return { owner: before.ballOwner, attach: 1, carrier: before.ballOwner };
  if (a.type === 'dribble') return { owner: a.from, attach: 1, carrier: a.from };
  const f = ballFlight(t, step, before, states[i + 1], carryFor(t, states, i));
  if (!f) return { attach: 0, carrier: a.from };
  const carrier = f.receiver && stepT >= (f.release + f.arrive) / 2 ? f.receiver : a.from;
  const D = Math.max(0.1, step.duration);
  const sinceKick = (stepT - f.release) * D;
  if (sinceKick <= ATTACH_TIME) return { owner: a.from, attach: Math.min(1, Math.max(0, 1 - sinceKick / ATTACH_TIME)), carrier };
  const toArrival = (f.arrive - stepT) * D;
  if (f.receiver && toArrival <= ATTACH_TIME) return { owner: f.receiver, attach: Math.min(1, Math.max(0, 1 - toArrival / ATTACH_TIME)), carrier };
  return { attach: 0, carrier };
}

/**
 * Whose eyes the player view uses: the chosen player, or for "ball carrier" whoever has
 * the ball (keeping the last one while nobody does, e.g. after a shot).
 */
export function povSubject(choice: string, snapshot: Snapshot3D, last?: string): string | undefined {
  const here = (id?: string) => (id && snapshot.players.some((p) => p.id === id) ? id : undefined);
  if (choice !== BALL_CARRIER && here(choice)) return choice;
  return here(snapshot.ball?.carrier) ?? here(last) ?? here(snapshot.ball?.owner);
}

/**
 * Ball actions in progress at a playback moment: the kicker winds up and strikes so the
 * foot meets the ball at the release, the receiver shapes to control it as it arrives,
 * a dribbler takes touches. Nothing while paused (players stand in a neutral pose).
 */
export function actionsAt(t: Tactic, states: BoardState[], frame: Frame | undefined): Record<string, { action: PlayerAction; face?: Vec }> {
  const out: Record<string, { action: PlayerAction; face?: Vec }> = {};
  if (!frame || frame.stepIndex < 0 || frame.stepIndex >= t.steps.length) return out;
  const i = frame.stepIndex;
  const step = t.steps[i];
  const now = frame.stepT * Math.max(0.1, step.duration);
  const best: Record<string, number> = {};
  for (const e of ballEvents(t, states, i)) {
    const phase = actionPhase(e.kind, now - e.at);
    if (phase === null) continue;
    // One-touch play: the kick wins over the touch that set it up.
    const score = Math.abs(phase - 0.5) * (e.kind === 'receive' ? 1.5 : 1);
    if (best[e.player] !== undefined && best[e.player] <= score) continue;
    best[e.player] = score;
    out[e.player] = { action: { kind: e.kind, phase }, face: e.face };
  }
  if (step.ball?.type === 'dribble' && !out[step.ball.from]) out[step.ball.from] = { action: { kind: 'dribble', phase: frame.stepT } };
  return out;
}

/** What the 3D scene should show: the playback frame, or the end of the step being viewed. */
export function snapshotFor(t: Tactic, states: BoardState[], frame: Frame | undefined, stepIndex: number): Snapshot3D {
  const shown = frame ? frame.stepIndex : stepIndex;
  const after = states[Math.min(states.length - 1, shown + 1)] ?? states[0];
  const positions = frame ? frame.positions : after.positions;
  const actions = actionsAt(t, states, frame);
  const players = activePlayers(t)
    .filter((pl) => positions[pl.id])
    .map((pl) => ({
      id: pl.id, team: pl.team, gk: pl.line === 'GK', number: String(pl.number), label: pl.name || pl.role,
      x: positions[pl.id].x, y: positions[pl.id].y,
      ...(actions[pl.id] ?? {}),
    }));
  const held = frame ? ballOwner(t, states, frame.stepIndex, frame.stepT) : { owner: after.ballOwner, attach: 1, carrier: after.ballOwner };
  const ball = frame
    ? { x: frame.ball.x, y: frame.ball.y, height: frame.ballHeight, ...held }
    : { x: after.ball.x, y: after.ball.y, height: 0, ...held };
  const arrows: Arrow3D[] = [];
  const step = shown >= 0 ? t.steps[shown] : undefined;
  const before = shown >= 0 ? states[shown] : undefined;
  if (step && before) {
    const visible = new Set(activePlayers(t).map((pl) => pl.id));
    for (const [id, path] of Object.entries(step.moves)) {
      const start = before.positions[id];
      if (!start || !path.length || !visible.has(id)) continue;
      const pl = t.players.find((x) => x.id === id);
      const dribbling = step.ball?.type === 'dribble' && step.ball.from === id;
      arrows.push({ points: [start, ...path], kind: dribbling ? 'dribble' : 'run', team: pl?.team });
    }
    const a = step.ball;
    if (a && a.type !== 'dribble' && before.positions[a.from]) {
      const flight = ballFlight(t, step, before, states[shown + 1], carryFor(t, states, shown));
      if (flight) {
        arrows.push({
          points: [flight.origin, flight.dest],
          kind: a.type,
          peak: flight.lofted ? Math.min(8, dist(flight.origin, flight.dest) * 0.18) : undefined,
        });
      }
    }
  }
  return { players, ball, playing: !!frame, arrows };
}

/** The tactic in 3D: same frames as the 2D view, seen from a choice of cameras. */
export default function Pitch3D({ tactic, states, frame, stepIndex }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engine = useRef<Scene3D | null>(null);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs]);

  useEffect(() => {
    if (!hostRef.current) return;
    try {
      const e = new Scene3D(hostRef.current);
      e.onUserCamera = () => setPrefs((p) => ({ ...p, camera: 'free' }));
      e.onPickPlayer = (id) => setPrefs((p) => ({ ...p, pov: { ...p.pov, player: id } }));
      engine.current = e;
    } catch {
      setError('The 3D view needs WebGL, which this browser or device has switched off.');
    }
    return () => {
      engine.current?.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    engine.current?.setLook({ format: tactic.format, homeColor: settings.homeColor, awayColor: settings.awayColor, names: prefs.names, arrows: prefs.arrows });
  }, [tactic.format, settings.homeColor, settings.awayColor, prefs.names, prefs.arrows]);

  useEffect(() => {
    engine.current?.setCamera(prefs.camera);
  }, [prefs.camera]);

  const snapshot = useMemo(() => snapshotFor(tactic, states, frame, stepIndex), [tactic, states, frame, stepIndex]);
  useEffect(() => {
    engine.current?.setSnapshot(snapshot);
  }, [snapshot]);

  // Player view: resolve "ball carrier" to a player for this moment.
  const lastCarrier = useRef<string | undefined>(undefined);
  const subject = povSubject(prefs.pov.player, snapshot, lastCarrier.current);
  useEffect(() => {
    lastCarrier.current = subject;
    engine.current?.setPov({ player: subject, mode: prefs.pov.shoulder ? 'shoulder' : 'eyes' });
  }, [subject, prefs.pov.shoulder]);
  const people = activePlayers(tactic);
  const seen = prefs.camera === 'player' ? people.find((pl) => pl.id === subject) : undefined;
  const setPov = (pov: Partial<PovPrefs>) => setPrefs((p) => ({ ...p, pov: { ...p.pov, ...pov } }));

  return (
    <div className="pitch3d">
      <div ref={hostRef} className="pitch3d-canvas" aria-label={`${tactic.name} in 3D`} role="img" />
      <div className="pitch3d-bar" role="toolbar" aria-label="Camera">
        {seen && (
          <div className="pitch3d-pov" aria-live="polite">
            Seeing as <b>#{seen.number} {seen.role}</b>{seen.name ? ` ${seen.name}` : ''}
            {prefs.pov.player === BALL_CARRIER && <span className="muted"> · ball carrier</span>}
          </div>
        )}
        {CAMERA_PRESETS.map((c) => (
          <button key={c.id} className={prefs.camera === c.id ? 'active' : ''} onClick={() => setPrefs({ ...prefs, camera: c.id })} title={c.title}>
            {c.label}
          </button>
        ))}
        {prefs.camera === 'player' && (
          <>
            <select
              className="pitch3d-who"
              value={prefs.pov.player === BALL_CARRIER || people.some((pl) => pl.id === prefs.pov.player) ? prefs.pov.player : BALL_CARRIER}
              onChange={(e) => setPov({ player: e.target.value })}
              title="Whose eyes to see through (or tap a player)"
              aria-label="Whose eyes to see through"
            >
              <option value={BALL_CARRIER}>Ball carrier</option>
              {(['home', 'away'] as const).map((team) => (
                <optgroup key={team} label={team === 'home' ? tactic.homeName || 'Home' : tactic.awayName || 'Away'}>
                  {people.filter((pl) => pl.team === team).map((pl) => (
                    <option key={pl.id} value={pl.id}>#{pl.number} {pl.role}{pl.name ? ` · ${pl.name}` : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button className={prefs.pov.shoulder ? 'active' : ''} onClick={() => setPov({ shoulder: !prefs.pov.shoulder })} title="Over the shoulder: from just behind and above the player, instead of through their eyes">
              Shoulder
            </button>
          </>
        )}
        <span className="sep" />
        <button className={prefs.names ? 'active' : ''} onClick={() => setPrefs({ ...prefs, names: !prefs.names })} title="Show names under the shirt numbers">Names</button>
        <button className={prefs.arrows ? 'active' : ''} onClick={() => setPrefs({ ...prefs, arrows: !prefs.arrows })} title="Show this step's runs and passes on the grass">Arrows</button>
      </div>
      {error && (
        <div className="pitch3d-error">
          <p>{error}</p>
          <button onClick={() => setSettings({ view3d: false })}>Back to 2D</button>
        </div>
      )}
    </div>
  );
}
