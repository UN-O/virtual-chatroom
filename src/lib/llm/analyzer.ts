import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { Character, PAD, Message, Trauma } from '@/lib/types';
import { describePADState } from '@/lib/engine/pad';
import { getModel, getLLMProvider, LLM_CONFIG } from './config';

/**
 * F3: llmAnalyzePlayerMessage
 * Type: Analyzer
 * Usage: Analyze player message, output PAD delta and emotion tag
 * Trigger: After every player message (parallel with F5, F4 depends on F3)
 */
export async function llmAnalyzePlayerMessage(input: {
  character: Character;
  currentPad: PAD;
  playerMessage: string;
  chatHistory: Message[];
  traumaTriggers: Trauma[];
}): Promise<{
  padDelta: { p: number; a: number; d: number };
  traumaTriggered?: string;
  emotionTag: string;
}> {
  const { character, currentPad, playerMessage, chatHistory, traumaTriggers } = input;

  const systemPrompt = `你是一個情感分析器，分析玩家訊息對角色 ${character.profile.name} 的影響。

## 角色資訊
${character.profile.description}
核心動機：${character.psychology.coreMotivation}
正面觸發點：${character.psychology.emotionalTriggers.positive.join('、')}
負面觸發點：${character.psychology.emotionalTriggers.negative.join('、')}

## 創傷敏感點
${traumaTriggers.map(t => `- ${t.id}: ${t.trigger}`).join('\n')}

## 當前情緒狀態
${describePADState(currentPad)}

## 分析規則
- padDelta 範圍：p (-0.3 ~ +0.3), a (-0.2 ~ +0.2), d (-0.2 ~ +0.2)
- 若觸發創傷，p 應該下降 0.2-0.3
- emotionTag 選擇：warm, cold, hurt, amused, annoyed, neutral, anxious, relieved`;

  const recentContext = chatHistory.slice(-5).map(m => 
    `${m.senderType === 'player' ? '玩家' : character.profile.name}: ${m.content}`
  ).join('\n');

  try {
    const { output } = await generateText({
      model: getModel(),
      system: systemPrompt,
      prompt: `最近對話：
${recentContext}

玩家最新訊息：「${playerMessage}」

分析此訊息對角色的情緒影響。`,
      output: Output.object({
        schema: z.object({
          padDelta: z.object({
            p: z.number().min(-0.3).max(0.3),
            a: z.number().min(-0.2).max(0.2),
            d: z.number().min(-0.2).max(0.2),
          }),
          traumaTriggered: z.string().nullable(),
          emotionTag: z.string(),
        }),
      }),
    });
    console.log(`[F3] Analysis result for "${playerMessage}":`, output);

    return {
      padDelta: output.padDelta,
      traumaTriggered: output.traumaTriggered || undefined,
      emotionTag: output.emotionTag,
    };
  } catch (error) {
    console.error('[F3] Error analyzing player message:', error);
    return analyzePlayerMessageFallback(character, playerMessage, currentPad);
  }
}

/**
 * F4: llmUpdateMemory
 * Type: Analyzer
 * Usage: Update character's mid-term memory summary
 * Trigger: After F3 completes (needs F3's emotionTag)
 */
export async function llmUpdateMemory(input: {
  character: Character;
  previousMemory: string;
  newEvents: {
    playerMessage: string;
    characterResponse: string;
    padDelta: { p: number; a: number; d: number };
    emotionTag: string;
  };
}): Promise<{ memory: string }> {
  const { character, previousMemory, newEvents } = input;

  try {
    const result = await generateText({
      model: getModel(),
      system: `你是 ${character.profile.name} 的內心記憶更新器。
根據新發生的事件，更新角色對玩家的主觀記憶。
記憶應該是角色的第一人稱視角，表達對玩家的理解和感受。
保持簡短（2-3 句話），用繁體中文。`,
      prompt: `上次記憶：${previousMemory || '(還沒有特別印象)'}

這輪發生的事：
- 玩家說：「${newEvents.playerMessage}」
- 我回覆：「${newEvents.characterResponse}」
- 情緒變化：${newEvents.emotionTag}
- 情緒數值變化：P ${newEvents.padDelta.p > 0 ? '+' : ''}${newEvents.padDelta.p.toFixed(2)}

請更新我對玩家的記憶摘要：`,
    });

    console.log(`[F4] Updated memory:`, result.text.trim());

    return { memory: result.text.trim() };
  } catch (error) {
    console.error('[F4] Error updating memory:', error);
    // Keep previous memory on error
    return { memory: previousMemory || '' };
  }
}

/**
 * F5: llmCheckGoalAchieved
 * Type: Analyzer
 * Usage: Check if character's phase goal is achieved
 * Trigger: After every player message (parallel with F3), until achieved
 */
export async function llmCheckGoalAchieved(input: {
  goal: string;
  completionHint: string;
  chatHistory: Message[];
  currentlyAchieved: boolean;
}): Promise<{ achieved: boolean; reason: string }> {
  if (input.currentlyAchieved) {
    return { achieved: true, reason: '已達成' };
  }

  const recentMessages = input.chatHistory.slice(-8).map(m =>
    `${m.senderType === 'player' ? '玩家' : '角色'}: ${m.content}`
  ).join('\n');

  try {
    const result = await generateText({
      model: getModel(),
      system: `你是目的達成判斷器。判斷對話是否達成了指定目的。`,
      prompt: `目的：${input.goal}
達成提示：${input.completionHint}

最近對話：
${recentMessages}

這個目的是否已達成？`,
      output: Output.object({
        schema: z.object({
          achieved: z.boolean(),
          reason: z.string(),
        }),
      }),
    });

    console.log(`[F5] Goal check result for "${input.goal}":`, result.output);

    return result.output;
  } catch (error) {
    console.error('[F5] Error checking goal:', error);
    return checkGoalFallback(input);
  }
}

/**
 * F6: llmDecideGroupRespond
 * Type: Analyzer
 * Usage: Decide if character should respond to group message, and urgency
 * Trigger: Group new message, after shouldRespond() probability passes
 */
export async function llmDecideGroupRespond(input: {
  character: Character;
  state: { pad: PAD; memory: string };
  phaseGoal: string;
  groupHistory: Message[];
  arousalProbability: number;
}): Promise<{
  shouldRespond: boolean;
  urgency?: 'low' | 'medium' | 'high';
  reason?: string;
}> {
  const { character, state, phaseGoal, groupHistory } = input;

  const recentMessages = groupHistory.slice(-10).map(m => {
    const sender = m.senderType === 'player' ? '玩家' : 
      (m.senderId === character.id ? '我' : '其他人');
    return `${sender}: ${m.content}`;
  }).join('\n');

  try {
    const result = await generateText({
      model: getModel(),
      system: `你是 ${character.profile.name} 的群組回覆決策器。
決定是否要回覆這則群組訊息，以及緊迫程度。

角色個性：${character.personality.description}
當前目的：${phaseGoal}
當前情緒：${describePADState(state.pad)}`,
      prompt: `群組最近訊息：
${recentMessages}

我應該回覆嗎？緊迫程度如何？`,
      output: Output.object({
        schema: z.object({
          shouldRespond: z.boolean(),
          urgency: z.enum(['low', 'medium', 'high']).nullable(),
          reason: z.string().nullable(),
        }),
      }),
    });

    return {
      shouldRespond: result.output.shouldRespond,
      urgency: result.output.urgency || undefined,
      reason: result.output.reason || undefined,
    };
  } catch (error) {
    console.error('[F6] Error deciding group respond:', error);
    // Default to not responding on error to avoid spam
    return { shouldRespond: false };
  }
}

// Fallback functions for when LLM fails

function analyzePlayerMessageFallback(
  character: Character,
  playerMessage: string,
  currentPad: PAD
): { padDelta: { p: number; a: number; d: number }; emotionTag: string } {
  const lowerMsg = playerMessage.toLowerCase();
  let delta = { p: 0, a: 0.05, d: 0 };
  let emotionTag = 'neutral';

  // Check positive triggers
  for (const trigger of character.psychology.emotionalTriggers.positive) {
    if (lowerMsg.includes(trigger.substring(0, 4))) {
      delta.p += 0.1;
      emotionTag = 'warm';
      break;
    }
  }

  // Check negative triggers
  for (const trigger of character.psychology.emotionalTriggers.negative) {
    if (lowerMsg.includes(trigger.substring(0, 4))) {
      delta.p -= 0.1;
      emotionTag = 'annoyed';
      break;
    }
  }

  // Character-specific checks
  if (character.id === 'char_boss') {
    if (lowerMsg.includes('應該') || lowerMsg.includes('試') || lowerMsg.includes('盡量')) {
      delta.p -= 0.2;
      emotionTag = 'cold';
    }
    if (/\d+點|\d+:|\d+時/.test(playerMessage)) {
      delta.p += 0.15;
      emotionTag = 'neutral';
    }
    if (lowerMsg.includes('好') || lowerMsg.includes('沒問題')) {
      delta.p += 0.1;
    }
  }

  if (character.id === 'char_coworker') {
    if (lowerMsg.includes('幫') && lowerMsg.includes('做')) {
      delta.p -= 0.15;
      emotionTag = 'anxious';
    }
    if (lowerMsg.includes('理解') || lowerMsg.includes('辛苦')) {
      delta.p += 0.15;
      emotionTag = 'relieved';
    }
  }

  return { padDelta: delta, emotionTag };
}

function checkGoalFallback(input: {
  goal: string;
  completionHint: string;
  chatHistory: Message[];
}): { achieved: boolean; reason: string } {
  const recentPlayerMessages = input.chatHistory
    .filter(m => m.senderType === 'player')
    .slice(-3)
    .map(m => m.content.toLowerCase())
    .join(' ');

  // Simple keyword matching
  if (input.goal.includes('接下報告')) {
    const agreed = recentPlayerMessages.includes('好') || 
                   recentPlayerMessages.includes('可以') ||
                   recentPlayerMessages.includes('沒問題');
    const hasTime = /\d|點|時|前/.test(recentPlayerMessages);
    return {
      achieved: agreed && hasTime,
      reason: agreed && hasTime ? '玩家同意並給出時間' : '等待明確承諾',
    };
  }

  if (input.goal.includes('進度')) {
    const reported = recentPlayerMessages.includes('進度') ||
                     recentPlayerMessages.includes('完成') ||
                     recentPlayerMessages.includes('做') ||
                     /\d+%/.test(recentPlayerMessages);
    return {
      achieved: reported,
      reason: reported ? '玩家回報了進度' : '等待進度回報',
    };
  }

  // Default: achieved if player has responded
  return {
    achieved: recentPlayerMessages.length > 5,
    reason: '有互動',
  };
}
