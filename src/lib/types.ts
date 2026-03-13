// PAD Emotion Model
export interface PAD {
  p: number; // Pleasure: -1.0 ~ 1.0
  a: number; // Arousal: 0.0 ~ 1.0
  d: number; // Dominance: -1.0 ~ 1.0
}

// Character Profile
export interface CharacterProfile {
  name: string;
  age: number;
  gender: string;
  description: string;
  avatarUrl: string;
  avatarExpressions: Record<string, string>;
}

// Character Personality
export interface CharacterPersonality {
  bigFive: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
  };
  customTraits: string[];
  description: string;
}

// Character Speech Style
export interface SpeechStyle {
  tone: string;
  verbosity: number;
  catchphrases: string[];
  forbiddenWords: string[];
  ageAppropriate: string;
  description: string;
}

// Trauma definition
export interface Trauma {
  id: string;
  description: string;
  trigger: string;
  reaction: string;
}

// Character Psychology
export interface CharacterPsychology {
  coreMotivation: string;
  selfEfficacy: number;
  selfNarrative: string;
  traumas: Trauma[];
  emotionalTriggers: {
    positive: string[];
    negative: string[];
  };
}

// PAD Config
export interface PADConfig {
  initial: PAD;
  sensitivity: {
    pleasureSensitivity: number;
    arousalThreshold: number;
    dominanceSensitivity: number;
    responsivenessBase: number;
  };
  decayRate: {
    arousalDecay: number;
    pleasureDecayToBase: number;
  };
}

// Online Schedule
export interface OnlineSchedule {
  dawn: boolean;
  morning: boolean;
  noon: boolean;
  afternoon: boolean;
  evening: boolean;
  night: boolean;
}

// Sticker
export interface Sticker {
  id: string;
  path: string;
  emotion: string;
  padCondition: string;
}

// Relationship
export interface Relationship {
  name: string;
  relation: string;
  trust: number;
  description: string;
}

// Full Character Config
export interface Character {
  id: string;
  profile: CharacterProfile;
  personality: CharacterPersonality;
  speechStyle: SpeechStyle;
  psychology: CharacterPsychology;
  padConfig: PADConfig;
  onlineSchedule: OnlineSchedule;
  stickerPack: Sticker[];
  relationships: Record<string, Relationship>;
}

// Character Mission for a Phase
export interface CharacterPhaseMission {
  phaseId: string;
  goal: string;
  triggerDirection: string;
  completionHint: string;
  location: 'dm' | 'group' | 'both';
  responseDelaySeconds: number;
  failNudge: string | null;
}

// Character Missions Config
export interface CharacterMissions {
  storyId: string;
  characterId: string;
  playerInitialAttitude: string;
  phases: CharacterPhaseMission[];
  branchConditions: BranchCondition[];
}

// Group Definition
export interface Group {
  id: string;
  slug: string;
  name: string;
  description: string;
  avatarUrl: string;
  members: string[];
  playerAlwaysIn: boolean;
}

// Phase Character Mission (in plot.json)
export interface PhaseCharacterMission {
  characterId: string;
  goal: string;
  completionHint: string;
  triggerDirection: string;
  location: 'dm' | 'group' | 'both';
  responseDelaySeconds: number;
  failNudge: string | null;
}

// Branch Condition
export interface BranchCondition {
  condition: string;
  nextPhaseId: string;
  description: string;
}

// Phase Definition
export interface Phase {
  id: string;
  virtualTime: string;
  progressLabel: string;
  maxRealMinutes: number;
  characterMissions: PhaseCharacterMission[];
  branches: BranchCondition[];
}

// Story Plot
export interface StoryPlot {
  id: string;
  slug: string;
  title: string;
  description: string;
  estimatedMins: number;
  phases: Phase[];
}

// Message
export interface Message {
  id: string;
  chatId: string;
  senderType: 'player' | 'character';
  senderId: string | null;
  content: string;
  stickerId?: string;
  expressionKey?: string;
  virtualTimeLabel?: string; // 顯示用虛擬時間（如 "09:05"）
  createdAt: Date;
}

// Chat Room (DM or Group)
export interface ChatRoom {
  id: string;
  type: 'dm' | 'group';
  name: string;
  avatarUrl: string;
  characterId?: string; // for DM
  groupId?: string; // for group
  lastMessage?: string;
  lastMessageTime?: Date;
  unreadCount: number;
}

// Character State (runtime)
export interface CharacterState {
  characterId: string;
  pad: PAD;
  memory: string;
  goalAchieved: boolean;
}

// Game Session
export interface GameSession {
  id: string;
  storyId: string;
  userId: string;
  status: 'active' | 'completed';
  currentPhaseId: string;
  progressLabel: string;
  virtualTime: string;
  characterStates: Record<string, CharacterState>;
  messages: Message[];
  startedAt: Date;
  lastActiveAt: Date;
}

// Client Session (Storage optimized)
export interface ClientSession extends GameSession {
  version: number;
}

// Typing Indicator State
export interface TypingState {
  characterId: string;
  chatId: string;
  startedAt: Date;
}

// Scheduled Event (for virtual time engine)
export interface ScheduledEvent {
  id: string;
  characterId: string;
  chatId: string;
  type: 'response' | 'nudge' | 'phase-message';
  scheduledFor: Date;
  timeoutId?: ReturnType<typeof setTimeout>;
}

// PAD Delta from analysis
export interface PADDelta {
  p: number;
  a: number;
  d: number;
}

// API Response types
export interface GenerateResponseResult {
  content: string;
  padDelta: PADDelta;
  goalAchieved: boolean;
  expressionKey?: string;
}

export interface AnalyzeResult {
  padDelta: PADDelta;
  emotionTag: string;
}

// Game State for UI
export interface GameState {
  session: GameSession;
  story: StoryPlot;
  characters: Record<string, Character>;
  characterMissions: Record<string, CharacterMissions>;
  groups: Group[];
  chatRooms: ChatRoom[];
  activeChatId: string | null;
  isLoading: boolean;
  canFastForward: boolean; // Computed: Check if phase goals are met
  typingStates: TypingState[];
  pendingEvents: ScheduledEvent[];
  debugMode: boolean;
}

// Export initial types needed for Context that might be missing
export interface TypingCharacter {
  characterId: string;
  chatId: string;
}
