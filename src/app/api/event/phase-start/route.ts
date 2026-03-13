import { characters, storyPlot, groups } from '@/lib/story-data';
import type { Message } from '@/lib/types';
import { llmGenerateCharacterMessage } from '@/lib/llm/generator';

/**
 * POST /api/event/phase-start
 *
 * Called when entering a new phase. Generates proactive messages from
 * all characters who have a trigger direction for this phase.
 *
 * Input:
 * - phaseId: string - The phase to start
 * - characterStates: Record<string, { pad, memory, goalAchieved }> - Current states
 * - chatHistories: Record<string, Message[]> - Chat histories per chatId
 *
 * Output:
 * - messages: Array<{ characterId, chatId, content, expressionKey }>
 */
export async function POST(req: Request) {
  const {
    phaseId,
    characterStates = {},
    chatHistories = {}
  } = await req.json();

  const phase = storyPlot.phases.find(p => p.id === phaseId);
  if (!phase) {
    return Response.json({ error: 'Phase not found' }, { status: 404 });
  }

  // Default group ID for this story
  const defaultGroupId = groups[0]?.id || 'group_office';

  const messages: Array<{
    characterId: string;
    chatId: string;
    content: string;
    expressionKey?: string;
  }> = [];

  for (const mission of phase.characterMissions) {
    const character = characters[mission.characterId];
    if (!character) continue;

    // Only generate message if there is a specific trigger direction for this phase
    if (!mission.triggerDirection) continue;

    const charState = characterStates[mission.characterId] || {
      pad: character.padConfig.initial,
      memory: '',
      goalAchieved: false
    };

    // Determine target chatId: DM → characterId, group/both → group ID
    const targetChatId = mission.location === 'dm'
      ? mission.characterId
      : defaultGroupId;

    try {
      const result = await llmGenerateCharacterMessage({
        character,
        state: {
          pad: charState.pad,
          memory: charState.memory
        },
        situation: {
          phaseGoal: mission.goal,
          triggerDirection: mission.triggerDirection,
          chatHistory: (chatHistories[targetChatId] || []) as Message[],
          isOnline: true,
          location: mission.location === 'dm' ? 'dm' : 'group'
        }
      });

      messages.push({
        characterId: mission.characterId,
        chatId: targetChatId,
        content: result.content,
        expressionKey: result.expressionKey || 'neutral'
      });
    } catch (error) {
      console.error(`[phase-start] Error generating message for ${mission.characterId}:`, error);
      messages.push({
        characterId: mission.characterId,
        chatId: targetChatId,
        content: getFallbackMessage(mission.characterId, mission.triggerDirection),
        expressionKey: 'neutral'
      });
    }
  }

  return Response.json({ messages });
}

function getFallbackMessage(characterId: string, triggerDirection: string): string {
  if (characterId === 'char_boss') {
    if (triggerDirection.includes('Q3')) {
      return '今天下午開會需要 Q3 業績摘要，下班前給我。';
    }
    if (triggerDirection.includes('進度')) {
      return '報告進度？';
    }
    return '收到。';
  }

  if (characterId === 'char_coworker') {
    if (triggerDirection.includes('忙') || triggerDirection.includes('行程')) {
      return '欸我跟你說，我今天真的超忙的啦...';
    }
    return '嗯嗯～';
  }

  return '好。';
}
