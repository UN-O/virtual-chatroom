import type { Character, CharacterState, Message, PAD } from '@/lib/types';

export interface NudgeRequest {
  characterId: string;
  chatId: string;
  chatHistory?: Message[];
  characterState?: Partial<Pick<CharacterState, 'pad' | 'memory' | 'goalAchieved'>>;
  phaseGoal?: string;
  nudgeCount?: number;
}

export interface ResolvedNudgeState {
  pad: PAD;
  memory: string;
  goalAchieved: boolean;
}

export interface NudgeDirection {
  direction: string;
  fallback: string;
  level: number;
}

export interface NudgeGenerationInput {
  character: Character;
  state: Pick<ResolvedNudgeState, 'pad' | 'memory'>;
  chatId: string;
  chatHistory: Message[];
  phaseGoal: string;
  resolvedDirection: NudgeDirection;
}

export interface NudgeSuccessResponse {
  content: string;
  expressionKey: string;
  usedFallback: boolean;
  skipped?: boolean;
}

export interface NudgeErrorResponse {
  error: string;
  status: number;
}

export function resolveNudgeState(
  character: Character,
  characterState?: NudgeRequest['characterState']
): ResolvedNudgeState {
  return {
    pad: characterState?.pad || character.padConfig.initial,
    memory: characterState?.memory || '',
    goalAchieved: Boolean(characterState?.goalAchieved),
  };
}

export function isNudgeErrorResponse(
  value: NudgeSuccessResponse | NudgeErrorResponse
): value is NudgeErrorResponse {
  return 'status' in value;
}