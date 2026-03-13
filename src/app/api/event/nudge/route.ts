import { characters } from '@/lib/story-data';
import type { Message } from '@/lib/types';
import { llmGenerateCharacterMessage } from '@/lib/llm/generator';

/**
 * POST /api/event/nudge
 * 
 * Called when player hasn't responded for too long. Generates a "nudge"
 * message from a character to encourage player interaction.
 * 
 * Input:
 * - characterId: string
 * - chatId: string
 * - chatHistory: Message[]
 * - characterState: { pad, memory, goalAchieved }
 * - phaseGoal: string
 * - nudgeCount: number (how many times nudged already)
 * 
 * Output:
 * - content: string
 * - expressionKey: string
 */
export async function POST(req: Request) {
  const { 
    characterId,
    chatId,
    chatHistory = [],
    characterState = {},
    phaseGoal = '',
    nudgeCount = 0
  } = await req.json();

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const state = {
    pad: characterState.pad || character.initialPad,
    memory: characterState.memory || ''
  };

  // Adjust nudge direction based on count
  const nudgeDirections = getNudgeDirections(characterId, nudgeCount);

  try {
    const result = await llmGenerateCharacterMessage({
      character,
      state,
      situation: {
        phaseGoal,
        triggerDirection: nudgeDirections.direction,
        chatHistory,
        isOnline: true,
        location: chatId.startsWith('group_') ? 'group' : 'dm'
      }
    });

    return Response.json({
      content: result.content,
      expressionKey: result.expressionKey || 'neutral'
    });
  } catch (error) {
    console.error(`[nudge] Error for ${characterId}:`, error);
    return Response.json({
      content: nudgeDirections.fallback,
      expressionKey: 'neutral'
    });
  }
}

function getNudgeDirections(characterId: string, nudgeCount: number): { direction: string; fallback: string } {
  if (characterId === 'char_boss') {
    if (nudgeCount === 0) {
      return {
        direction: '稍微催促一下，但保持專業。詢問進度或確認是否收到。',
        fallback: '收到了嗎？'
      };
    }
    if (nudgeCount === 1) {
      return {
        direction: '更明確地催促，表達時間壓力。語氣可以更直接。',
        fallback: '我等你回覆。'
      };
    }
    return {
      direction: '最後催促，語氣冷淡但不失禮。暗示可能有後果。',
      fallback: '？'
    };
  }
  
  if (characterId === 'char_coworker') {
    if (nudgeCount === 0) {
      return {
        direction: '自然地繼續話題，可以加點抱怨或分享。',
        fallback: '你有沒有在聽啊～'
      };
    }
    return {
      direction: '稍微著急地問一下，但保持輕鬆。',
      fallback: '欸？'
    };
  }
  
  return {
    direction: '輕輕催促回覆。',
    fallback: '？'
  };
}
