import { characters } from '@/lib/story-data';
import type { Message } from '@/lib/types';
import { llmGenerateGroupResponse } from '@/lib/llm/generator';
import { llmDecideGroupRespond } from '@/lib/llm/analyzer';

/**
 * POST /api/event/char-respond
 * 
 * Called when a character's response timer fires. Decides if character
 * should respond (F6) and generates the response (F2) if yes.
 * 
 * Input:
 * - characterId: string
 * - chatId: string
 * - groupHistory: Message[]
 * - characterState: { pad, memory, goalAchieved }
 * - phaseGoal: string
 * - arousalProbability: number (0-1)
 * 
 * Output:
 * - shouldRespond: boolean
 * - content?: string
 * - expressionKey?: string
 * - urgency?: 'low' | 'medium' | 'high'
 * - reason?: string
 */
export async function POST(req: Request) {
  const { 
    characterId,
    chatId,
    groupHistory = [],
    characterState = {},
    phaseGoal = '',
    arousalProbability = 0.5
  } = await req.json();

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const state = {
    pad: characterState.pad || character.padConfig.initial,
    memory: characterState.memory || ''
  };

  try {
    // F6: Decide if should respond
    const decision = await llmDecideGroupRespond({
      character,
      state,
      phaseGoal,
      groupHistory,
      arousalProbability
    });

    if (!decision.shouldRespond) {
      return Response.json({
        shouldRespond: false,
        reason: decision.reason || 'Decided not to respond'
      });
    }

    // F2: Generate group response
    const response = await llmGenerateGroupResponse({
      character,
      state,
      situation: {
        phaseGoal,
        groupHistory,
        isOnline: true,
        urgency: decision.urgency || 'medium'
      }
    });

    return Response.json({
      shouldRespond: true,
      content: response.content,
      expressionKey: response.expressionKey || 'neutral',
      urgency: decision.urgency,
      reason: decision.reason
    });
  } catch (error) {
    console.error(`[char-respond] Error for ${characterId}:`, error);
    return Response.json({
      shouldRespond: false,
      reason: 'Error occurred'
    });
  }
}
