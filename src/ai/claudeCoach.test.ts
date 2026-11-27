import { describe, expect, it } from 'vitest';
import { analyseTactic } from '../engine/analysis';
import { PRESET_TACTICS } from '../presets/tactics';
import { describeTactic } from './claudeCoach';

describe('AI coach context', () => {
  it('describes players, steps and analysis findings for the model', () => {
    const t = PRESET_TACTICS.find((x) => x.id === 'preset_11v11-buildup')!;
    const text = describeTactic(t, analyseTactic(t));
    expect(text).toContain('11v11');
    expect(text).toContain('HOME #6 CM');
    expect(text).toContain('Step 1');
    expect(text).toContain('ball: pass by #1 GK');
    expect(text).toContain('Rule engine score');
  });
});
