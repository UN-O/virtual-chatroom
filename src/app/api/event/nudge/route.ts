import { handleNudgeRequest } from '@/lib/nudge/handler';
import { isNudgeErrorResponse } from '@/lib/nudge/types';

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
  const result = await handleNudgeRequest(await req.json());

  if (isNudgeErrorResponse(result)) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  return Response.json(result);
}
