import { characters, storyPlot } from '@/lib/story-data';
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

  const messages: Array<{
    characterId: string;
    chatId: string;
    content: string;
    expressionKey: string;
  }> = [];

  // Process each character's trigger for this phase
  for (const trigger of phase.triggerOnStart) {
    const character = characters[trigger.characterId];
    if (!character) continue;

    const charState = characterStates[trigger.characterId] || {
      pad: character.initialPad,
      memory: '',
      goalAchieved: false
    };

    // Find the character's goal for this phase
    const mission = storyPlot.characterMissions[trigger.characterId];
    const phaseGoal = mission?.phases[phaseId]?.goal || '';

    // Get chat history for this chat
    const chatHistory: Message[] = chatHistories[trigger.chatId] || [];

    try {
      const result = await llmGenerateCharacterMessage({
        character,
        state: { pad: charState.pad, memory: charState.memory },
        situation: {
          phaseGoal,
          triggerDirection: trigger.direction,
          chatHistory,
          isOnline: true,
          location: trigger.chatId.startsWith('group_') ? 'group' : 'dm'
        }
      });

      messages.push({
        characterId: trigger.characterId,
        chatId: trigger.chatId,
        content: result.content,
        expressionKey: result.expressionKey || 'neutral'
      });
    } catch (error) {
      console.error(`[phase-start] Error generating message for ${trigger.characterId}:`, error);
      // Use fallback message
      messages.push({
        characterId: trigger.characterId,
        chatId: trigger.chatId,
        content: getFallbackMessage(trigger.characterId, trigger.direction),
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
