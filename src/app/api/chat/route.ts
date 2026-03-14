import { characters } from '@/lib/story-data';
import type { Message } from '@/lib/types';
import { 
  llmGenerateCharacterMessage, 
  llmGenerateGroupResponse,
  llmDecideAutonomousMessage,
  llmGenerateAutonomousPrompt
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
 * - 'autonomousMessage': New action for autonomous message handling
 * - 'autonomousPrompt': Generate first/second follow-up prompt after silence
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
      
      case 'autonomousMessage':
        return handleAutonomousMessage(body);

      case 'autonomousPrompt':
        return handleAutonomousPrompt(body);

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
  focusChatId?: string;
  focusContext?: Message[];
  backgroundContext?: Message[];
  chatHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  triggerDirection?: string;
  location?: 'dm' | 'group';
  isOnline?: boolean;
}) {
  const {
    characterId,
    playerMessage,
    focusChatId,
    focusContext = [],
    backgroundContext = [],
    chatHistory = [],
    currentPad = { p: 0, a: 0.5, d: 0.5 },
    memory = '',
    phaseGoal = '',
    triggerDirection = '',
    location = 'dm',
    isOnline = true
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const fullHistory = ensureLatestPlayerMessage(chatHistory, playerMessage, focusChatId ?? characterId);
  const resolvedFocusContext = focusContext.length > 0
    ? ensureLatestPlayerMessage(focusContext, playerMessage, focusChatId ?? characterId)
    : fullHistory;
  const resolvedBackgroundContext = backgroundContext;

  // Parallel execution: Generate response and analyze emotion (if player message exists)
  const [generationResult, analysisResult] = await Promise.all([
    llmGenerateCharacterMessage({
      character,
      state: { pad: currentPad, memory },
      situation: {
        phaseGoal,
        triggerDirection,
        chatHistory: fullHistory,
        focusChatId: focusChatId ?? characterId,
        focusContext: resolvedFocusContext,
        backgroundContext: resolvedBackgroundContext,
        isOnline,
        location
      }
    }),
    playerMessage 
      ? llmAnalyzePlayerMessage({
          character,
          currentPad,
          playerMessage,
          focusChatId: focusChatId ?? characterId,
          focusContext: resolvedFocusContext,
          backgroundContext: resolvedBackgroundContext,
          chatHistory: fullHistory,
          traumaTriggers: character.psychology.traumas
        })
      : Promise.resolve({ 
          padDelta: { p: 0, a: 0, d: 0 }, 
          emotionTag: 'neutral', 
          traumaTriggered: undefined 
        })
  ]);

  return Response.json({
    messages: generationResult.messages,
    expressionKey: generationResult.expressionKey || 'neutral',
    padDelta: analysisResult.padDelta,
    emotionTag: analysisResult.emotionTag,
    goalAchieved: false
  });
}

function ensureLatestPlayerMessage(
  history: Message[],
  playerMessage: string | undefined,
  chatId: string
): Message[] {
  if (!playerMessage) return history;
  const last = history[history.length - 1];
  if (last && last.senderType === 'player' && last.content === playerMessage) {
    return history;
  }
  return [...history, {
    id: `temp_${Date.now()}`,
    chatId,
    senderId: 'player',
    senderType: 'player' as const,
    content: playerMessage,
    createdAt: new Date()
  }];
}

/**
 * F3: Analyze player message for PAD delta
 */
async function handleAnalyze(body: {
  characterId: string;
  playerMessage: string;
  focusChatId?: string;
  focusContext?: Message[];
  backgroundContext?: Message[];
  chatHistory?: Message[];
  currentPad?: { p: number; a: number; d: number };
  location?: 'dm' | 'group';
  groupName?: string;
  participantIds?: string[];
  participantNames?: Record<string, string>;
}) {
  const { 
    characterId, 
    playerMessage, 
    focusChatId,
    focusContext = [],
    backgroundContext = [],
    chatHistory = [],
    currentPad = { p: 0, a: 0.5, d: 0.5 },
    location = 'dm',
    groupName,
    participantNames = {}
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const resolvedHistory = ensureLatestPlayerMessage(chatHistory, playerMessage, focusChatId ?? characterId);
  const resolvedFocusContext = focusContext.length > 0
    ? ensureLatestPlayerMessage(focusContext, playerMessage, focusChatId ?? characterId)
    : resolvedHistory;

  const result = await llmAnalyzePlayerMessage({
    character,
    currentPad,
    playerMessage,
    focusChatId,
    focusContext: resolvedFocusContext,
    backgroundContext,
    chatHistory: resolvedHistory,
    location,
    groupName,
    participantNames,
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
  focusChatId?: string;
  focusContext?: Message[];
  backgroundContext?: Message[];
  groupHistory?: Message[];
  groupName?: string;
  participantIds?: string[];
  participantNames?: Record<string, string>;
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  urgency?: 'low' | 'medium' | 'high';
}) {
  const { 
    characterId, 
    focusChatId,
    focusContext = [],
    backgroundContext = [],
    groupHistory = [],
    groupName,
    participantNames = {},
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
      focusChatId,
      focusContext,
      backgroundContext,
      groupHistory,
      groupName,
      participantNames,
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

/**
 * Autonomous message decision:
 * Character decides whether/where/what to send when player has been silent.
 */
async function handleAutonomousMessage(body: {
  characterId: string;
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  dmHistory?: Message[];
  groupHistories?: { groupId: string; groupName: string; messages: Message[] }[];
}) {
  const {
    characterId,
    currentPad = { p: 0, a: 0.5, d: 0 },
    memory = '',
    phaseGoal = '',
    dmHistory = [],
    groupHistories = [],
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmDecideAutonomousMessage({
    character,
    state: { pad: currentPad, memory },
    phaseGoal,
    dmChatId: characterId,
    dmHistory,
    groupHistories,
  });

  return Response.json(result);
}

async function handleAutonomousPrompt(body: {
  characterId: string;
  currentPad?: { p: number; a: number; d: number };
  memory?: string;
  phaseGoal?: string;
  promptLevel: 1 | 2;
  dmHistory?: Message[];
  groupHistories?: { groupId: string; groupName: string; messages: Message[] }[];
}) {
  const {
    characterId,
    currentPad = { p: 0, a: 0.5, d: 0 },
    memory = '',
    phaseGoal = '',
    promptLevel,
    dmHistory = [],
    groupHistories = [],
  } = body;

  const character = characters[characterId];
  if (!character) {
    return Response.json({ error: 'Character not found' }, { status: 404 });
  }

  const result = await llmGenerateAutonomousPrompt({
    character,
    state: { pad: currentPad, memory },
    phaseGoal,
    promptLevel,
    dmChatId: characterId,
    dmHistory,
    groupHistories,
  });

  return Response.json(result);
}
