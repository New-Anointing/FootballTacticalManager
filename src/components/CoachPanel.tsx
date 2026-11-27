import { useMemo, useRef, useState } from 'react';
import type { ChatTurn } from '../ai/config';
import { generateAttack, generatePress, suggestFormations, tipsFromReport } from '../engine/coach';
import { PRESET_TACTICS } from '../presets/tactics';
import { reportOf } from '../derived';
import { useStore } from '../store';

const QUICK_QUESTIONS = [
  'What is the biggest weakness of this tactic and how do I fix it?',
  'How will a good opponent try to stop this, and what is our counter?',
  'Explain this move to my players in simple coaching points.',
  'Suggest a variation of this move for when the first pass is blocked.',
];

export function CoachPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { current, setFormation, appendSteps, openTactic, settings, setStepIndex, setHighlight, reactOpponents, supportTeam } = useStore();
  const report = reportOf(current);
  const [goal, setGoal] = useState<'balanced' | 'attack' | 'defend'>('balanced');
  const [message, setMessage] = useState<string | null>(null);
  const formations = useMemo(() => suggestFormations(current.format, current.awayFormation, goal), [current.format, current.awayFormation, goal]);
  const tips = tipsFromReport(report);
  const related = PRESET_TACTICS.filter((p) => p.id !== current.id && (p.format === current.format || p.phase === current.phase)).slice(0, 4);

  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generate = (kind: 'attack' | 'press') => {
    const res = kind === 'attack' ? generateAttack(current) : generatePress(current);
    appendSteps(res.steps);
    setMessage(res.summary + (res.steps.length ? ' Check the Analysis tab and adjust the runs to taste.' : ''));
  };

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    if (!settings.apiKey) {
      onOpenSettings();
      return;
    }
    const history = chat;
    setChat([...history, { role: 'user', text: question }, { role: 'assistant', text: '' }]);
    setInput('');
    setBusy(true);
    setAiError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let AiCoachError: typeof import('../ai/claudeCoach').AiCoachError | undefined;
    try {
      // The SDK is only downloaded the first time someone asks the AI coach.
      const ai = await import('../ai/claudeCoach');
      AiCoachError = ai.AiCoachError;
      await ai.askClaudeCoach({
        apiKey: settings.apiKey,
        tactic: current,
        report,
        history,
        question,
        signal: ctrl.signal,
        onText: (d) =>
          setChat((c) => {
            const next = [...c];
            next[next.length - 1] = { role: 'assistant', text: next[next.length - 1].text + d };
            return next;
          }),
      });
    } catch (err) {
      setAiError(AiCoachError && err instanceof AiCoachError ? err.message : 'Something went wrong talking to the AI coach.');
      setChat((c) => (c[c.length - 1]?.text ? c : c.slice(0, -1)));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div>
      <h2>Assistant coach</h2>
      <div className="card">
        <h3>Generate movement</h3>
        <p>The coach builds steps from the end of your tactic using the rule engine: support runs, safe forward passes and a finish, or a coordinated press.</p>
        <div className="list-actions">
          <button className="primary" onClick={() => generate('attack')}>Generate attacking move</button>
          <button onClick={() => generate('press')} disabled={!current.showOpponents}>Generate press</button>
        </div>
        {message && <p className="small" style={{ color: 'var(--text)' }}>{message}</p>}
      </div>

      <div className="card">
        <h3>Realistic players</h3>
        <p>
          Bring the players without a run of their own to life. Opponents react like a well-drilled side: one player presses, one covers
          the most dangerous lane, the rest hold a compact zonal shape. Your free players move with the play: the back line pushes up
          behind the ball, midfielders support, and runners fill the box when the ball goes wide. Then check the Analysis tab.
        </p>
        <div className="list-actions">
          <button
            onClick={() => {
              reactOpponents();
              setMessage('Opponents now react to every step. Undo (Ctrl+Z) restores the previous movement.');
            }}
            disabled={!current.showOpponents || current.steps.length === 0}
          >
            Make opponents react
          </button>
          <button
            onClick={() => {
              supportTeam();
              setMessage('Your free players now move with the play. Undo (Ctrl+Z) restores the previous movement.');
            }}
            disabled={current.steps.length === 0}
          >
            Move my team with the play
          </button>
        </div>
      </div>

      <h2>Coaching points</h2>
      {tips.map((tip, i) => (
        <div
          key={i}
          className={`card ${tip.stepIndex >= 0 ? 'clickable' : ''}`}
          onClick={() => {
            if (tip.stepIndex < 0) return;
            setStepIndex(tip.stepIndex);
            const f = report.findings.find((x) => x.id === tip.findingId);
            setHighlight(f?.players ?? []);
          }}
        >
          <h3>{tip.title}{tip.stepIndex >= 0 ? <span className="muted small"> · step {tip.stepIndex + 1}</span> : null}</h3>
          <p>{tip.body}</p>
        </div>
      ))}

      <h2>Formation advice</h2>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <span className="small muted">vs their {current.awayFormation}, aiming to</span>
        <select value={goal} onChange={(e) => setGoal(e.target.value as typeof goal)} style={{ width: 'auto' }}>
          <option value="balanced">stay balanced</option>
          <option value="attack">attack</option>
          <option value="defend">defend</option>
        </select>
      </div>
      {formations.slice(0, 3).map((f) => (
        <div key={f.formation} className={`card ${f.formation === current.homeFormation ? 'current' : ''}`}>
          <div className="row">
            <h3>{f.formation}</h3>
            <button
              className="small"
              style={{ flex: '0 0 auto' }}
              disabled={f.formation === current.homeFormation}
              onClick={() => (current.steps.length === 0 || confirm('Switching formation resets starting positions. Continue?')) && setFormation('home', f.formation)}
            >
              {f.formation === current.homeFormation ? 'In use' : 'Use'}
            </button>
          </div>
          <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {f.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      ))}

      {related.length > 0 && (
        <>
          <h2>Try a library tactic</h2>
          {related.map((p) => (
            <div key={p.id} className="card clickable" onClick={() => openTactic(p.id)}>
              <h3>{p.name}</h3>
              <p>{p.format}v{p.format} · {p.description}</p>
            </div>
          ))}
        </>
      )}

      <h2>Ask the AI coach</h2>
      {!settings.apiKey ? (
        <div className="card">
          <p>
            Optional: connect Claude for written, in-depth coaching on this tactic. Add an Anthropic API key in Settings; it stays in this browser.
          </p>
          <button style={{ marginTop: 8 }} onClick={onOpenSettings}>Add API key</button>
        </div>
      ) : (
        <div className="chat">
          {chat.length === 0 &&
            QUICK_QUESTIONS.map((q) => (
              <button key={q} className="small" style={{ textAlign: 'left', whiteSpace: 'normal' }} onClick={() => ask(q)} disabled={busy}>
                {q}
              </button>
            ))}
          {chat.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text || (busy && i === chat.length - 1 ? 'Thinking…' : '')}
            </div>
          ))}
          {aiError && <div className="msg error">{aiError}</div>}
          <textarea
            value={input}
            placeholder="Ask about this tactic…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
          />
          <div className="list-actions">
            {busy ? (
              <button onClick={() => abortRef.current?.abort()}>Stop</button>
            ) : (
              <button className="primary" onClick={() => ask(input)} disabled={!input.trim()}>Ask</button>
            )}
            {chat.length > 0 && !busy && <button className="ghost" onClick={() => setChat([])}>New conversation</button>}
          </div>
        </div>
      )}
    </div>
  );
}
