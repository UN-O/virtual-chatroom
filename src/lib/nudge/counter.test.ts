import { describe, expect, it } from 'vitest';

import { NudgeCounter } from './counter';

describe('NudgeCounter', () => {
  it('returns zero-based escalation levels while tracking total nudges internally', () => {
    const counter = new NudgeCounter();

    expect(counter.advance('char_boss')).toBe(0);
    expect(counter.get('char_boss')).toBe(1);
    expect(counter.advance('char_boss')).toBe(1);
    expect(counter.get('char_boss')).toBe(2);
  });

  it('resets per-chat state without affecting other chats', () => {
    const counter = new NudgeCounter();

    counter.advance('char_boss');
    counter.advance('char_coworker');
    counter.reset('char_boss');

    expect(counter.get('char_boss')).toBe(0);
    expect(counter.get('char_coworker')).toBe(1);
  });
});