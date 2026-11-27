import { useState } from 'react';
import type { Finding, Severity } from '../engine/analysis';
import { playerById, playerLabel } from '../model/tactic';
import { reportOf } from '../derived';
import { useStore } from '../store';

const SEV_LABEL: Record<Severity, string> = { error: 'Problem', warning: 'Risk', good: 'Strength', info: 'Note' };
const GRADE_COLOR: Record<string, string> = { A: 'var(--good)', B: '#9be15d', C: 'var(--warn)', D: '#ff8a4c', F: 'var(--error)' };

function ScoreRing({ score, grade }: { score: number; grade: string }) {
  const c = 2 * Math.PI * 30;
  return (
    <svg className="ring" viewBox="0 0 74 74" aria-label={`Score ${score} of 100, grade ${grade}`}>
      <circle cx={37} cy={37} r={30} fill="none" stroke="var(--border)" strokeWidth={7} />
      <circle
        cx={37} cy={37} r={30} fill="none" stroke={GRADE_COLOR[grade]} strokeWidth={7} strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 37 37)"
      />
      <text x={37} y={35} textAnchor="middle" fontSize={20} fontWeight={700} fill="var(--text)">{score}</text>
      <text x={37} y={51} textAnchor="middle" fontSize={11} fill="var(--muted)">grade {grade}</text>
    </svg>
  );
}

export function AnalysisPanel() {
  const { current, setStepIndex, setHighlight, applyFix } = useStore();
  const report = reportOf(current);
  const [filter, setFilter] = useState<Severity | 'all'>('all');
  const [stepFilter, setStepFilter] = useState<number | 'all'>('all');
  const shown = report.findings.filter(
    (f) => (filter === 'all' || f.severity === filter) && (stepFilter === 'all' || f.stepIndex === stepFilter),
  );

  const focus = (f: Finding) => {
    setStepIndex(f.stepIndex);
    setHighlight(f.players);
  };

  const fixLabel = (f: Finding): string | null => {
    if (!f.fix) return null;
    if (f.fix.kind === 'reroute-pass') {
      const pl = playerById(current, f.fix.to);
      return pl ? `Pass to ${playerLabel(pl)} instead` : null;
    }
    if (f.fix.kind === 'extend-duration') return `Make step ${f.fix.stepIndex + 1} last ${f.fix.duration}s`;
    if (f.fix.kind === 'react-defence') return `Make opponents react in step ${f.fix.stepIndex + 1}`;
    if (f.fix.kind === 'support-shape') return `Move the team with the play in step ${f.fix.stepIndex + 1}`;
    return `Release at ${Math.round(f.fix.releaseAt * 100)}%`;
  };

  return (
    <div>
      <h2>Analysis</h2>
      <div className="score">
        <ScoreRing score={report.score} grade={report.grade} />
        <div>
          <div className="verdict">{report.verdict}</div>
          <div className="counts">
            {(['error', 'warning', 'good', 'info'] as Severity[]).map((s) => (
              <button
                key={s}
                className={`sev ${s}`}
                style={{ border: filter === s ? '1px solid currentColor' : '1px solid transparent', padding: '1px 7px' }}
                onClick={() => setFilter(filter === s ? 'all' : s)}
              >
                {report.counts[s]} {SEV_LABEL[s].toLowerCase()}{report.counts[s] === 1 ? '' : 's'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <p className="muted small">
        The analysis replays every step: it checks running speeds, passing lanes against moving defenders, offside, pressure on receivers,
        shot quality (xG), shape and rest defence, and whether each step reaches its expected outcome. It updates as you edit.
      </p>
      <select value={stepFilter} onChange={(e) => setStepFilter(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))} aria-label="Filter by step">
        <option value="all">All steps</option>
        <option value={-1}>Setup / whole tactic</option>
        {current.steps.map((_, i) => <option key={i} value={i}>Step {i + 1}</option>)}
      </select>
      <div style={{ marginTop: 10 }} onMouseLeave={() => setHighlight([])}>
        {shown.length === 0 && <p className="muted small">Nothing to show for this filter.</p>}
        {shown.map((f) => (
          <div key={f.id} className={`finding ${f.severity}`} onClick={() => focus(f)} onMouseEnter={() => setHighlight(f.players)}>
            <div className="head">
              <span>{f.title}</span>
              <span className="step">{f.stepIndex >= 0 ? `Step ${f.stepIndex + 1}` : 'Setup'}</span>
            </div>
            <div className="detail">{f.detail}</div>
            {fixLabel(f) && (
              <button
                className="small"
                style={{ marginTop: 6 }}
                onClick={(e) => {
                  e.stopPropagation();
                  applyFix(f.fix!);
                }}
              >
                Fix: {fixLabel(f)}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
