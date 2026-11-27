import { stepStartTime } from '../engine/animation';
import { totalDuration } from '../model/tactic';
import { useStore } from '../store';

export function Timeline() {
  const {
    current, stepIndex, setStepIndex, addStep, playing, setPlaying, time, setTime, speed, setSpeed,
    loop, setLoop, playbackView, setPlaybackView, setPresenting,
  } = useStore();
  const total = totalDuration(current);
  const hasSteps = current.steps.length > 0;

  const play = () => {
    if (!hasSteps) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    // Start from the selected step when not already mid-playback.
    if (!playbackView || time >= total) setTime(stepIndex > 0 ? stepStartTime(current, stepIndex) : 0);
    setPlaying(true);
  };

  return (
    <div className="timeline">
      <div className="steps" data-tour="steps">
        <button className={`step-chip ${stepIndex === -1 && !playbackView ? 'active' : ''}`} onClick={() => setStepIndex(-1)}>
          Setup<small>start</small>
        </button>
        {current.steps.map((s, i) => (
          <button
            key={s.id}
            className={`step-chip ${stepIndex === i && !playbackView ? 'active' : ''}`}
            onClick={() => setStepIndex(i)}
            title={s.note || `Step ${i + 1}`}
          >
            Step {i + 1}
            <small>{s.duration}s{s.ball ? ` · ${s.ball.type}` : ''}</small>
          </button>
        ))}
        <button onClick={addStep} title="Add a step after the selected one" data-tour="add-step">+ Step</button>
      </div>
      <div className="playback" data-tour="playback">
        <button className="primary" onClick={play} disabled={!hasSteps} aria-label={playing ? 'Pause' : 'Play'} data-tour="play">
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={() => {
            setTime(0);
            setPlaybackView(true);
          }}
          disabled={!hasSteps}
          title="Back to the start"
        >
          ⟲
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0.1, total)}
          step={0.01}
          value={playbackView ? Math.min(time, total) : stepIndex >= 0 ? stepStartTime(current, stepIndex + 1) : 0}
          disabled={!hasSteps}
          onChange={(e) => {
            setPlaying(false);
            setTime(parseFloat(e.target.value));
            setPlaybackView(true);
          }}
          aria-label="Playback position"
        />
        <span className="time">{(playbackView ? time : 0).toFixed(1)} / {total.toFixed(1)}s</span>
        <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} style={{ width: 'auto' }} aria-label="Playback speed">
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
        </select>
        <label className="check" style={{ margin: 0 }}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop
        </label>
        <button onClick={() => setPresenting(true)} disabled={!hasSteps} title="Full-screen view for players">Present</button>
      </div>
    </div>
  );
}
