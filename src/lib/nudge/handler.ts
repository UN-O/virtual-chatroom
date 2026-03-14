import { characters } from '@/lib/story-data';

import { resolveNudgeDirection } from './direction-resolver';
import { generateNudgeMessage } from './generator';
import { resolveNudgeState } from './types';

import type {
  NudgeErrorResponse,
  NudgeRequest,
  NudgeSuccessResponse,
} from './types';

export async function handleNudgeRequest(
  input: NudgeRequest
): Promise<NudgeSuccessResponse | NudgeErrorResponse> {
  const {
    characterId,
    chatId,
    chatHistory = [],
    characterState,
    phaseGoal = '',
    nudgeCount = 0,
  } = input;

  const character = characters[characterId];
  if (!character) {
    return { error: 'Character not found', status: 404 };
  }

  const state = resolveNudgeState(character, characterState);
  if (state.goalAchieved) {
    return {
      content: '',
      expressionKey: 'neutral',
      usedFallback: false,
      skipped: true,
    };
  }

  const resolvedDirection = resolveNudgeDirection(characterId, nudgeCount);
  const result = await generateNudgeMessage({
    character,
    state,
    chatId,
    chatHistory,
    phaseGoal,
    resolvedDirection,
  });

  return result;
}