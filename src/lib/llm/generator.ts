import { generateText } from 'ai';
import type { Character, PAD, Message } from '../types';
import { describePADState } from '../engine/pad';
import { getModel, getLLMProvider, LLM_CONFIG } from './config';

/**
 * F1: llmGenerateCharacterMessage
 * Type: Generator
 * Usage: Character proactive messages (phase start), DM replies to player
 * Trigger: /api/event/phase-start, /api/chat/send (DM)
 */
export async function llmGenerateCharacterMessage(input: {
  character: Character;
  state: { pad: PAD; memory: string };
  situation: {
    phaseGoal: string;
    triggerDirection: string;
    chatHistory: Message[];
    isOnline: boolean;
    location: 'dm' | 'group';
  };
}): Promise<{ content: string; expressionKey?: string }> {
  const { character, state, situation } = input;
  
  const systemPrompt = buildGeneratorPrompt(character, state, situation);
  
  // Build messages from recent chat history (last 10 messages)
  const recentHistory = situation.chatHistory.slice(-10);
  const messages = recentHistory.map(msg => ({
    role: msg.senderType === 'player' ? 'user' as const : 'assistant' as const,
    content: msg.content
  }));

  try {
    const result = await generateText({
      model: getModel(),
      system: systemPrompt,
      messages: messages.length > 0 ? messages : undefined,
      prompt: messages.length === 0 ? `根據情境，主動發送訊息。方向提示：${situation.triggerDirection}` : undefined,
      maxOutputTokens: LLM_CONFIG.maxOutputTokens,
      temperature: LLM_CONFIG.temperature,
    });

    return {
      content: result.text.trim(),
      expressionKey: getExpressionKey(state.pad),
    };
  } catch (error) {
    console.error('[F1] Error generating character message:', error);
    return getFallbackMessage(character, situation);
  }
}

/**
 * F2: llmGenerateGroupResponse
 * Type: Generator
 * Usage: Character responds in group (after F6 decides shouldRespond=true)
 * Trigger: /api/event/char-respond
 */
export async function llmGenerateGroupResponse(input: {
  character: Character;
  state: { pad: PAD; memory: string };
  situation: {
    phaseGoal: string;
    groupHistory: Message[];
    isOnline: boolean;
    urgency: 'low' | 'medium' | 'high';
  };
}): Promise<{ content: string; expressionKey?: string }> {
  const { character, state, situation } = input;
  
  const urgencyHint = {
    low: '不急，可以隨意回應',
    medium: '正常回應',
    high: '需要盡快回應，可能有重要的事'
  }[situation.urgency];

  const systemPrompt = `${buildGeneratorPrompt(character, state, {
    phaseGoal: situation.phaseGoal,
    triggerDirection: '',
    chatHistory: situation.groupHistory,
    isOnline: situation.isOnline,
    location: 'group'
  })}

## 緊迫程度
${urgencyHint}`;

  const recentHistory = situation.groupHistory.slice(-15);
  const messages = recentHistory.map(msg => ({
    role: msg.senderType === 'player' ? 'user' as const : 'assistant' as const,
    content: msg.senderId === character.id ? msg.content : `[${msg.senderId ? '其他人' : '玩家'}]: ${msg.content}`
  }));

  try {
    const result = await generateText({
      model: getModel(),
      system: systemPrompt,
      messages,
      maxOutputTokens: LLM_CONFIG.maxOutputTokens,
      temperature: LLM_CONFIG.temperature,
    });

    return {
      content: result.text.trim(),
      expressionKey: getExpressionKey(state.pad),
    };
  } catch (error) {
    console.error('[F2] Error generating group response:', error);
    return { content: getSimpleFallback(character) };
  }
}

/**
 * Build the Generator system prompt
 */
function buildGeneratorPrompt(
  character: Character,
  state: { pad: PAD; memory: string },
  situation: {
    phaseGoal: string;
    triggerDirection: string;
    chatHistory: Message[];
    isOnline: boolean;
    location: 'dm' | 'group';
  }
): string {
  return `## 你是誰
${character.profile.name}，${character.profile.age} 歲。
${character.profile.description}

## 你的個性
${character.personality.description}
說話風格：${character.speechStyle.description}
口頭禪：${character.speechStyle.catchphrases.join('、')}
絕對不說：${character.speechStyle.forbiddenWords.join('、')}

## 你的心理動機
核心動機：${character.psychology.coreMotivation}
創傷 / 敏感點：${character.psychology.traumas.map(t => t.description).join('；')}

## 你目前的情緒狀態
${describePADState(state.pad)}
（根據 PAD 調整語氣：P 低時更冷漠、A 高時更簡短、D 高時更強勢）

## 你目前對玩家的理解（你的主觀記憶）
${state.memory || '還沒有特別的印象'}

## 你在這個時間段的目的
${situation.phaseGoal}

## 目前情境
場景：${situation.location === 'dm' ? '私訊對話' : '群組對話'}
${situation.triggerDirection ? `方向提示：${situation.triggerDirection}` : ''}

## 規則
- 完全以角色身份說話，不要跳出角色
- 回覆要簡短自然，像真實聊天（通常 1-3 句話）
- 不要使用表情符號，除非角色真的會用
- 用繁體中文回覆`;
}

function getExpressionKey(pad: PAD): string {
  if (pad.p > 0.4) return 'happy';
  if (pad.p < -0.3 && pad.a > 0.5) return 'angry';
  if (pad.p < -0.2) return 'sad';
  if (pad.a > 0.6) return 'surprised';
  return 'neutral';
}

function getFallbackMessage(
  character: Character,
  situation: { location: 'dm' | 'group'; triggerDirection: string }
): { content: string; expressionKey: string } {
  // Hardcoded fallbacks based on character and situation
  if (character.id === 'char_boss') {
    if (situation.triggerDirection.includes('Q3')) {
      return { content: '今天下午開會需要 Q3 業績摘要，下班前給我。', expressionKey: 'neutral' };
    }
    if (situation.triggerDirection.includes('進度')) {
      return { content: '報告進度？', expressionKey: 'neutral' };
    }
    return { content: '收到。', expressionKey: 'neutral' };
  }
  
  if (character.id === 'char_coworker') {
    if (situation.triggerDirection.includes('忙')) {
      return { content: '我今天真的超忙的，下午還有兩個 call...', expressionKey: 'neutral' };
    }
    return { content: '嗯嗯～', expressionKey: 'neutral' };
  }
  
  return { content: '好。', expressionKey: 'neutral' };
}

function getSimpleFallback(character: Character): string {
  if (character.id === 'char_boss') return '嗯。';
  if (character.id === 'char_coworker') return '嗯嗯～';
  return '好。';
}
