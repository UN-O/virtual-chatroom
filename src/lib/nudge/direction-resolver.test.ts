import { describe, expect, it } from 'vitest';

import { resolveNudgeDirection } from './direction-resolver';

describe('resolveNudgeDirection', () => {
  it('uses the first boss direction for the first actual nudge', () => {
    const result = resolveNudgeDirection('char_boss', 0);

    expect(result.level).toBe(0);
    expect(result.fallback).toBe('收到了嗎？');
  });

  it('caps escalation at the final configured level', () => {
    const result = resolveNudgeDirection('char_boss', 99);

    expect(result.level).toBe(2);
    expect(result.direction).toContain('最後催促');
  });

  it('falls back to the default strategy for unknown characters', () => {
    const result = resolveNudgeDirection('char_unknown', 3);

    expect(result.fallback).toBe('？');
    expect(result.level).toBe(3);
  });
});