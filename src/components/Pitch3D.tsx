import { useEffect, useMemo, useRef, useState } from 'react';
import { ballFlight, type Frame } from '../engine/animation';
import { dist } from '../engine/geometry';
import { carryFor } from '../engine/motion';
import { activePlayers, type BoardState } from '../model/tactic';
import type { Tactic } from '../model/types';
import { useStore } from '../store';
import { Scene3D, type Arrow3D, type Snapshot3D } from '../three/Scene3D';
import { CAMERA_PRESETS, type CameraPreset } from '../three/views';

interface Props {
  tactic: Tactic;
  states: BoardState[];
  frame?: Frame;
  stepIndex: number;
}

interface Prefs {
  camera: CameraPreset;
  names: boolean;
  arrows: boolean;
}

const PREFS_KEY = 'ftm-3d-v1';

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { camera: v.camera ?? 'broadcast', names: v.names ?? true, arrows: v.arrows ?? true };
  } catch {
    return { camera: 'broadcast', names: true, arrows: true };
  }
}

/** What the 3D scene should show: the playback frame, or the end of the step being viewed. */
export function snapshotFor(t: Tactic, states: BoardState[], frame: Frame | undefined, stepIndex: number): Snapshot3D {
  const shown = frame ? frame.stepIndex : stepIndex;
  const after = states[Math.min(states.length - 1, shown + 1)] ?? states[0];
  const positions = frame ? frame.positions : after.positions;
  const players = activePlayers(t)
    .filter((pl) => positions[pl.id])
    .map((pl) => ({
      id: pl.id, team: pl.team, gk: pl.line === 'GK', number: String(pl.number), label: pl.name || pl.role,
      x: positions[pl.id].x, y: positions[pl.id].y,
    }));
  const ball = frame ? { x: frame.ball.x, y: frame.ball.y, height: frame.ballHeight } : { x: after.ball.x, y: after.ball.y, height: 0 };
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

  return (
    <div className="pitch3d">
      <div ref={hostRef} className="pitch3d-canvas" aria-label={`${tactic.name} in 3D`} role="img" />
      <div className="pitch3d-bar" role="toolbar" aria-label="Camera">
        {CAMERA_PRESETS.map((c) => (
          <button key={c.id} className={prefs.camera === c.id ? 'active' : ''} onClick={() => setPrefs({ ...prefs, camera: c.id })} title={c.title}>
            {c.label}
          </button>
        ))}
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
