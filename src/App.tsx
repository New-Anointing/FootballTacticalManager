import { useEffect, useRef, useState } from 'react';
import { useBoards, useCurrentBoard } from './boardStore';
import { AnalysisPanel } from './components/AnalysisPanel';
import { BoardMode } from './components/board/BoardMode';
import { CoachPanel } from './components/CoachPanel';
import { EditPanel } from './components/EditPanel';
import { Library } from './components/Library';
import { NewTacticDialog } from './components/NewTacticDialog';
import { Pitch } from './components/Pitch';
import { PresentView } from './components/PresentView';
import { SettingsDialog } from './components/SettingsDialog';
import { Timeline } from './components/Timeline';
import { Toolbar } from './components/Toolbar';
import { frameAtTime } from './engine/animation';
import { totalDuration } from './model/tactic';
import { reportOf, statesOf } from './derived';
import { useStore, type Tool } from './store';

/** Advances playback time with requestAnimationFrame while playing. */
function usePlayback() {
  const playing = useStore((s) => s.playing);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) {
      last.current = null;
      return;
    }
    let raf = 0;
    const tick = (now: number) => {
      const s = useStore.getState();
      const dt = last.current == null ? 0 : (now - last.current) / 1000;
      last.current = now;
      const total = totalDuration(s.current);
      let t = s.time + dt * s.speed;
      if (t >= total) {
        if (s.loop) t = 0;
        else {
          s.setTime(total);
          s.setPlaying(false);
          return;
        }
      }
      s.setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'run', p: 'pass', c: 'cross', d: 'dribble', s: 'shot', l: 'clearance' };

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      // The tactics board has its own shortcuts.
      if (useBoards.getState().mode === 'board') return;
      const s = useStore.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!s.current.steps.length) return;
        if (!s.playing && s.time >= totalDuration(s.current)) s.setTime(0);
        s.setPlaying(!s.playing);
      } else if (e.key === 'ArrowRight') s.setStepIndex(s.stepIndex + 1);
      else if (e.key === 'ArrowLeft') s.setStepIndex(s.stepIndex - 1);
      else if (e.key === 'Escape') {
        s.setToolSource(undefined);
        s.selectPlayer(undefined);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedPlayer && s.stepIndex >= 0) {
        s.clearMove(s.selectedPlayer);
      } else if (e.key.toLowerCase() === 'h') {
        s.setSettings({ showPrevStep: s.settings.showPrevStep === false });
      } else if (TOOL_KEYS[e.key.toLowerCase()]) s.setTool(TOOL_KEYS[e.key.toLowerCase()]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export default function App() {
  const { current, stepIndex, playbackView, time, tab, setTab, update, presenting, setPlaying } = useStore();
  const mode = useBoards((s) => s.mode);
  const setMode = useBoards((s) => s.setMode);
  const board = useCurrentBoard();
  const changeBoard = useBoards((s) => s.change);
  const [showNew, setShowNew] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [mobile, setMobile] = useState<'library' | 'board' | 'panel'>('board');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('ftm-theme') as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });
  usePlayback();
  useShortcuts();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ftm-theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const states = statesOf(current);
  const report = reportOf(current);
  const frame = playbackView && current.steps.length ? frameAtTime(current, time, states) : undefined;
  const playingStep = frame ? current.steps[frame.stepIndex] : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><span className="logo">⚽</span><span className="wide-brand">Tactical Manager</span></div>
        <div className="mode-switch" role="tablist" aria-label="Mode">
          <button role="tab" aria-selected={mode === 'tactics'} className={mode === 'tactics' ? 'active' : ''} onClick={() => setMode('tactics')} title="Animated tactics, step by step, with analysis">
            Tactics
          </button>
          <button
            role="tab" aria-selected={mode === 'board'} className={mode === 'board' ? 'active' : ''}
            onClick={() => { setPlaying(false); setMode('board'); }} title="Free tactics board: move players and draw, no steps"
          >
            Board
          </button>
        </div>
        <div className="title">
          {mode === 'board' ? (
            <input type="text" value={board.name} onChange={(e) => changeBoard((b) => void (b.name = e.target.value))} aria-label="Board name" />
          ) : (
            <input type="text" value={current.name} onChange={(e) => update((t) => void (t.name = e.target.value))} aria-label="Tactic name" />
          )}
        </div>
        <div className="actions">
          {mode === 'tactics' && (
            <span className={`sev ${report.counts.error ? 'error' : report.counts.warning > 2 ? 'warning' : 'good'} wide`} style={{ alignSelf: 'center' }} title={report.verdict}>
              {report.score} · {report.grade}
            </span>
          )}
          <button className="ghost" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle light / dark">{theme === 'dark' ? '☀' : '☾'}</button>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>
      <nav className="mobile-tabs">
        <button className={mobile === 'library' ? 'active' : ''} onClick={() => setMobile('library')}>{mode === 'board' ? 'Boards & squad' : 'Library'}</button>
        <button className={mobile === 'board' ? 'active' : ''} onClick={() => setMobile('board')}>Pitch</button>
        <button className={mobile === 'panel' ? 'active' : ''} onClick={() => setMobile('panel')}>Details</button>
      </nav>
      {mode === 'board' ? (
        <BoardMode mobile={mobile} />
      ) : (
      <main className="main" data-mobile={mobile}>
        <aside className="sidebar">
          <Library onNew={() => setShowNew(true)} />
        </aside>
        <section className="center">
          <Toolbar />
          <div className="pitch-wrap">
            <Pitch tactic={current} states={states} frame={frame} stepIndex={frame ? frame.stepIndex : stepIndex} interactive={!frame} />
            {frame && playingStep?.note && (
              <div className="caption"><b>Step {frame.stepIndex + 1}</b>{playingStep.note}</div>
            )}
          </div>
          <Timeline />
        </section>
        <aside className="panel">
          <div className="tabs">
            <button className={tab === 'edit' ? 'active' : ''} onClick={() => setTab('edit')}>Edit</button>
            <button className={tab === 'analysis' ? 'active' : ''} onClick={() => setTab('analysis')}>
              Analysis {report.counts.error ? `(${report.counts.error})` : ''}
            </button>
            <button className={tab === 'coach' ? 'active' : ''} onClick={() => setTab('coach')}>Coach</button>
          </div>
          {tab === 'edit' && <EditPanel />}
          {tab === 'analysis' && <AnalysisPanel />}
          {tab === 'coach' && <CoachPanel onOpenSettings={() => setShowSettings(true)} />}
        </aside>
      </main>
      )}
      {showNew && <NewTacticDialog onClose={() => { setShowNew(false); setMobile('board'); }} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {presenting && mode === 'tactics' && <PresentView />}
    </div>
  );
}
