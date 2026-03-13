import { characters } from '@/lib/story-data';
import type { Message } from '@/lib/types';
import { 
  llmGenerateCharacterMessage, 
  llmGenerateGroupResponse 
} from '@/lib/llm/generator';
import { 
  llmAnalyzePlayerMessage, 
  llmUpdateMemory,
  llmCheckGoalAchieved,
  llmDecideGroupRespond 
} from '@/lib/llm/analyzer';

/**
 * Main chat endpoint that orchestrates LLM functions
 * All LLM calls are non-streaming per the architecture spec
 * 
 * Actions:
 * - 'respond': F1 - Generate character DM response
 * - 'analyze': F3 - Analyze player message for PAD delta
 * - 'checkGoal': F5 - Check if goal is achieved
 * - 'groupRespond': F2 - Generate group response (after F6)
 * - 'decideGroup': F6 - Decide if should respond to group
 * - 'updateMemory': F4 - Update character memory
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { action = 'respond' } = body;

  try {
    switch (action) {
      case 'analyze':
        return handleAnalyze(body);
      
      case 'checkGoal':
        return handleCheckGoal(body);
      
      case 'groupRespond':
        return handleGroupRespond(body);
      
      case 'decideGroup':
        return handleDecideGroup(body);
      
      case 'updateMemory':
        return handleUpdateMemory(body);
      
      case 'respond':
      default:
        return handleRespond(body);
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * F1: Generate character DM response
 */
async function handleRespond(body: {
  characterId: string;
  playerMessage?: string;
  chatHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  triggerDirection?: string;
  location?: 'dm' | 'group';
}) {
  const { 
    characterId, 
    playerMessage, 
    chatHistory = [], 
    currentPad = { p: 0, a: 0.5, d: 0.5 },
    memory = '',
    phaseGoal = '',
    triggerDirection = '',
    location = 'dm'
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  // Add player message to history if provided
  const fullHistory = playerMessage 
    ? [...chatHistory, { 
        id: `temp_${Date.now()}`,
        chatId: '',
        senderId: 'player',
        senderType: 'player' as const,
        content: playerMessage,
        createdAt: new Date()
      }]
    : chatHistory;

  // Parallel execution: Generate response and analyze emotion (if player message exists)
  const [generationResult, analysisResult] = await Promise.all([
    llmGenerateCharacterMessage({
      character,
      state: { pad: currentPad, memory },
      situation: {
        phaseGoal,
        triggerDirection,
        chatHistory: fullHistory,
        isOnline: true,
        location
      }
    }),
    playerMessage 
      ? llmAnalyzePlayerMessage({
          character,
          currentPad,
          playerMessage,
          chatHistory,
          traumaTriggers: character.psychology.traumas
        })
      : Promise.resolve({ 
          padDelta: { p: 0, a: 0, d: 0 }, 
          emotionTag: 'neutral', 
          traumaTriggered: undefined 
        })
  ]);

  return Response.json({
    content: generationResult.content,
    expressionKey: generationResult.expressionKey || 'neutral',
    padDelta: analysisResult.padDelta,
    emotionTag: analysisResult.emotionTag,
    goalAchieved: false
  });
}

/**
 * F3: Analyze player message for PAD delta
 */
async function handleAnalyze(body: {
  characterId: string;
  playerMessage: string;
  chatHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
}) {
  const { 
    characterId, 
    playerMessage, 
    chatHistory = [],
    currentPad = { p: 0, a: 0.5, d: 0.5 }
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmAnalyzePlayerMessage({
    character,
    currentPad,
    playerMessage,
    chatHistory,
    traumaTriggers: character.psychology.traumas
  });

  return Response.json({
    padDelta: result.padDelta,
    emotionTag: result.emotionTag,
    traumaTriggered: result.traumaTriggered
  });
}

/**
 * F5: Check if goal is achieved
 */
async function handleCheckGoal(body: {
  goal: string;
  completionHint?: string;
  chatHistory?: Message[];
  currentlyAchieved?: boolean;
}) {
  const { 
    goal, 
    completionHint = '',
    chatHistory = [],
    currentlyAchieved = false
  } = body;

  const result = await llmCheckGoalAchieved({
    goal,
    completionHint,
    chatHistory,
    currentlyAchieved
  });

  return Response.json(result);
}

/**
 * F2: Generate group response (called after F6 decides to respond)
 */
async function handleGroupRespond(body: {
  characterId: string;
  groupHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  urgency?: 'low' | 'medium' | 'high';
}) {
  const { 
    characterId, 
    groupHistory = [],
    currentPad = { p: 0, a: 0.5, d: 0.5 },
    memory = '',
    phaseGoal = '',
    urgency = 'medium'
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmGenerateGroupResponse({
    character,
    state: { pad: currentPad, memory },
    situation: {
      phaseGoal,
      groupHistory,
      isOnline: true,
      urgency
    }
  });

  return Response.json({
    content: result.content,
    expressionKey: result.expressionKey || 'neutral'
  });
}

/**
 * F6: Decide if character should respond to group message
 */
async function handleDecideGroup(body: {
  characterId: string;
  groupHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  arousalProbability?: number;
}) {
  const { 
    characterId, 
    groupHistory = [],
    currentPad = { p: 0, a: 0.5, d: 0.5 },
    memory = '',
    phaseGoal = '',
    arousalProbability = 0.5
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmDecideGroupRespond({
    character,
    state: { pad: currentPad, memory },
    phaseGoal,
    groupHistory,
    arousalProbability
  });

  return Response.json(result);
}

/**
 * F4: Update character memory
 */
async function handleUpdateMemory(body: {
  characterId: string;
  previousMemory?: string;
  playerMessage: string;
  characterResponse: string;
  padDelta: { p: number; a: number; d: number };
  emotionTag: string;
}) {
  const { 
    characterId, 
    previousMemory = '',
    playerMessage,
    characterResponse,
    padDelta,
    emotionTag
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmUpdateMemory({
    character,
    previousMemory,
    newEvents: {
      playerMessage,
      characterResponse,
      padDelta,
      emotionTag
    }
  });

  return Response.json(result);
}
