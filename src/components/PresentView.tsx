import { lazy, Suspense, useEffect } from 'react';
import { frameAtTime } from '../engine/animation';
import { totalDuration } from '../model/tactic';
import { statesOf } from '../derived';
import { useStore } from '../store';
import { Pitch } from './Pitch';

const Pitch3D = lazy(() => import('./Pitch3D'));

/** Full-screen playback for showing a tactic to players. */
export function PresentView() {
  const { current, time, setTime, playing, setPlaying, setPresenting, speed, setSpeed, settings, setSettings } = useStore();
  const states = statesOf(current);
  const frame = frameAtTime(current, time, states);
  const step = current.steps[frame.stepIndex];
  const total = totalDuration(current);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPresenting(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPresenting]);

  return (
    <div className="present">
      <div className="bar">
        <span className="name">{current.name}</span>
        <button className="primary" onClick={() => { if (time >= total) setTime(0); setPlaying(!playing); }}>{playing ? 'Pause' : 'Play'}</button>
        <button onClick={() => { setTime(0); setPlaying(true); }}>Restart</button>
        <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} style={{ width: 'auto' }} aria-label="Speed">
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>
        <span className="seg" role="group" aria-label="2D or 3D">
          <button className={!settings.view3d ? 'active' : ''} onClick={() => setSettings({ view3d: false })}>2D</button>
          <button className={settings.view3d ? 'active' : ''} onClick={() => setSettings({ view3d: true })}>3D</button>
        </span>
        <button onClick={() => setPresenting(false)}>Close</button>
      </div>
      <div className="pitch-wrap">
        {settings.view3d ? (
          <Suspense fallback={<div className="pitch3d-loading">Loading the 3D view…</div>}>
            <Pitch3D tactic={current} states={states} frame={frame} stepIndex={frame.stepIndex} />
          </Suspense>
        ) : (
          <Pitch tactic={current} states={states} frame={frame} stepIndex={frame.stepIndex} interactive={false} />
        )}
        {step && (step.note || frame.stepIndex >= 0) && (
          <div className="caption">
            <b>Step {frame.stepIndex + 1}/{current.steps.length}</b>
            {step.note}
          </div>
        )}
      </div>
    </div>
  );
}
