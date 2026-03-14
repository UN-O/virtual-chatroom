import { llmGenerateCharacterMessage } from '@/lib/llm/generator';

import type { NudgeGenerationInput, NudgeSuccessResponse } from './types';

export async function generateNudgeMessage(input: NudgeGenerationInput): Promise<NudgeSuccessResponse> {
  const { character, state, chatId, chatHistory, phaseGoal, resolvedDirection } = input;

  try {
    const result = await llmGenerateCharacterMessage({
      character,
      state,
      situation: {
        phaseGoal,
        triggerDirection: resolvedDirection.direction,
        chatHistory,
        isOnline: true,
        location: chatId.startsWith('group_') ? 'group' : 'dm',
      },
    });

    const generatedContent = result.messages[0]?.content?.trim();

    return {
      content: generatedContent || resolvedDirection.fallback,
      expressionKey: result.expressionKey || 'neutral',
      usedFallback: !generatedContent,
    };
  } catch (error) {
    console.error(`[nudge] Error for ${character.id}:`, error);

    return {
      content: resolvedDirection.fallback,
      expressionKey: 'neutral',
      usedFallback: true,
    };
  }
}