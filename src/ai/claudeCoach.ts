import Anthropic from '@anthropic-ai/sdk';
import type { AnalysisReport } from '../engine/analysis';
import { pitchFor } from '../model/pitch';
import { activePlayers, boardStates, playerById, playerLabel } from '../model/tactic';
import type { Tactic, Vec } from '../model/types';

import { AI_MODEL, type ChatTurn } from './config';

export { AI_MODEL };
export type { ChatTurn };

const SYSTEM = `You are an experienced football (soccer) and futsal assistant coach inside a tactics board app.
The user is a coach or manager. They design scenarios with two teams, step-by-step player runs and ball actions, and the app's rule engine scores them.
You receive the current scenario as text plus the rule engine's findings.

How to answer:
- Be concrete: name players by number and role (e.g. "#6 DM"), name the step, and say where they should move (e.g. "5 m wider", "on the shoulder of the last defender").
- Prioritise the one or two changes that matter most, then optional refinements.
- Explain the football reasoning briefly (space, timing, numerical superiority, cover, rest defence) so players can learn from it.
- Respect the format: small-sided and futsal tactics differ from 11v11 (no offside in futsal, rotations, pivot play).
- If the rule engine flags something that is fine in context, say so and why.
- Keep answers short and skimmable: short paragraphs or bullet points, no long preambles.`;

const r = (v: number) => Math.round(v);

function describePos(t: Tactic, v: Vec): string {
  const p = pitchFor(t.format);
  return `(${r(v.x)}, ${r(v.y)})`.concat(
    v.x < p.length / 3 ? ' home third' : v.x > (2 * p.length) / 3 ? ' attacking third' : ' middle third',
  );
}

/** Compact, model-friendly description of the scenario. */
export function describeTactic(t: Tactic, report?: AnalysisReport): string {
  const p = pitchFor(t.format);
  const states = boardStates(t);
  const lines: string[] = [];
  lines.push(`Scenario: "${t.name}" (${t.format}v${t.format}, phase: ${t.phase}).`);
  if (t.description) lines.push(`Description: ${t.description}`);
  lines.push(
    `Pitch ${p.length} x ${p.width} m. Coordinates are metres: x = 0 is the home goal line, x = ${p.length} is the goal home attacks; y = 0 is the home team's left touchline.`,
  );
  lines.push(`Offside rule: ${t.rules.offside ? 'on' : 'off'}. Opponents shown: ${t.showOpponents ? 'yes' : 'no'}.`);
  lines.push(`Home (${t.homeName}) formation ${t.homeFormation}; away (${t.awayName}) formation ${t.awayFormation}.`);
  lines.push('Starting positions:');
  for (const pl of activePlayers(t)) {
    lines.push(`- ${pl.team === 'home' ? 'HOME' : 'AWAY'} ${playerLabel(pl)} at ${describePos(t, t.initial[pl.id])}`);
  }
  const owner = playerById(t, t.ballOwner);
  lines.push(`Ball starts with: ${owner ? `${owner.team.toUpperCase()} ${playerLabel(owner)}` : `nobody, at (${r(t.ballStart.x)}, ${r(t.ballStart.y)})`}.`);
  t.steps.forEach((s, i) => {
    lines.push(`Step ${i + 1} (${s.duration}s, intended outcome: ${s.expectedOutcome})${s.note ? ` - "${s.note}"` : ''}`);
    for (const [id, path] of Object.entries(s.moves)) {
      const pl = playerById(t, id);
      if (!pl || !path.length) continue;
      lines.push(`  run: ${pl.team.toUpperCase()} ${playerLabel(pl)} -> ${describePos(t, path[path.length - 1])}${path.length > 1 ? ` via ${path.length - 1} waypoint(s)` : ''}`);
    }
    if (s.ball) {
      const from = playerById(t, s.ball.from);
      const to = playerById(t, s.ball.to);
      lines.push(
        `  ball: ${s.ball.type} by ${from ? playerLabel(from) : s.ball.from}${to ? ` to ${to.team.toUpperCase()} ${playerLabel(to)}` : s.ball.target ? ` to (${r(s.ball.target.x)}, ${r(s.ball.target.y)})` : ''}, released at ${Math.round(s.ball.releaseAt * 100)}% of the step`,
      );
    }
    const after = states[i + 1];
    const holder = playerById(t, after.ballOwner);
    lines.push(`  after step: ball with ${holder ? `${holder.team.toUpperCase()} ${playerLabel(holder)}` : 'nobody'} at (${r(after.ball.x)}, ${r(after.ball.y)})`);
  });
  if (report) {
    lines.push(`Rule engine score: ${report.score}/100 (grade ${report.grade}). ${report.verdict}`);
    const top = report.findings.filter((f) => f.severity !== 'info').slice(0, 15);
    for (const f of top) {
      lines.push(`- [${f.severity}] ${f.stepIndex >= 0 ? `step ${f.stepIndex + 1}: ` : ''}${f.title}. ${f.detail}`);
    }
  }
  return lines.join('\n');
}

export class AiCoachError extends Error {}

/**
 * Ask Claude for coaching advice about the current scenario. Streams text via `onText`.
 * The API key stays in the user's browser and is sent only to the Anthropic API.
 */
export async function askClaudeCoach(opts: {
  apiKey: string;
  tactic: Tactic;
  report: AnalysisReport;
  history: ChatTurn[];
  question: string;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, dangerouslyAllowBrowser: true });
  const context = describeTactic(opts.tactic, opts.report);
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  opts.history.forEach((turn) => messages.push({ role: turn.role, content: turn.text }));
  messages.push({
    role: 'user',
    content: `<scenario>\n${context}\n</scenario>\n\n${opts.question}`,
  });

  try {
    const stream = client.beta.messages.stream(
      {
        model: AI_MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        output_config: { effort: 'medium' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      },
      { signal: opts.signal },
    );
    stream.on('text', (delta) => opts.onText(delta));
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new AiCoachError('The AI coach declined to answer this request. Try rephrasing the question.');
    }
    return final.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
  } catch (err) {
    if (err instanceof AiCoachError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiCoachError('Invalid API key. Check it in Settings.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiCoachError('This API key does not have access to the model.');
    if (err instanceof Anthropic.RateLimitError) throw new AiCoachError('Rate limited by the API. Wait a moment and try again.');
    if (err instanceof Anthropic.APIUserAbortError) throw new AiCoachError('Stopped.');
    if (err instanceof Anthropic.APIConnectionError) throw new AiCoachError('Could not reach the Anthropic API. Check your connection.');
    if (err instanceof Anthropic.APIError) throw new AiCoachError(`API error ${err.status ?? ''}: ${err.message}`);
    throw err;
  }
}
