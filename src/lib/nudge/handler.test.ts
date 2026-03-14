import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/llm/generator', () => ({
  llmGenerateCharacterMessage: vi.fn(),
}));

import { llmGenerateCharacterMessage } from '@/lib/llm/generator';

import { handleNudgeRequest } from './handler';

describe('handleNudgeRequest', () => {
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.mocked(llmGenerateCharacterMessage).mockReset();
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns a 404-style error payload for unknown characters', async () => {
    const result = await handleNudgeRequest({
      characterId: 'missing',
      chatId: 'missing',
    });

    expect(result).toEqual({ error: 'Character not found', status: 404 });
  });

  it('skips generation when the goal is already achieved', async () => {
    const result = await handleNudgeRequest({
      characterId: 'char_boss',
      chatId: 'char_boss',
      characterState: { goalAchieved: true },
    });

    expect(result).toEqual({
      content: '',
      expressionKey: 'neutral',
      usedFallback: false,
      skipped: true,
    });
    expect(llmGenerateCharacterMessage).not.toHaveBeenCalled();
  });

  it('returns skipped=true with empty content for achieved goals', async () => {
    const result = await handleNudgeRequest({
      characterId: 'char_coworker',
      chatId: 'char_coworker',
      characterState: { goalAchieved: true },
    });

    expect(result).toMatchObject({
      skipped: true,
      content: '',
      usedFallback: false,
    });
  });

  it('generates a nudge using the resolved direction and dm location', async () => {
    vi.mocked(llmGenerateCharacterMessage).mockResolvedValue({
      messages: [{ content: '收到了嗎？', type: 'text' }],
      expressionKey: 'angry',
    });

    const result = await handleNudgeRequest({
      characterId: 'char_boss',
      chatId: 'char_boss',
      nudgeCount: 0,
      phaseGoal: '催進度',
    });

    expect(result).toEqual({
      content: '收到了嗎？',
      expressionKey: 'angry',
      usedFallback: false,
    });
    expect(llmGenerateCharacterMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        situation: expect.objectContaining({
          location: 'dm',
          triggerDirection: expect.stringContaining('稍微催促'),
        }),
      })
    );
  });

  it('uses fallback content when generation fails', async () => {
    vi.mocked(llmGenerateCharacterMessage).mockRejectedValue(new Error('boom'));

    const result = await handleNudgeRequest({
      characterId: 'char_coworker',
      chatId: 'char_coworker',
      nudgeCount: 1,
    });

    expect(result).toEqual({
      content: '欸？',
      expressionKey: 'neutral',
      usedFallback: true,
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});