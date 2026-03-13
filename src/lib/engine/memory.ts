import { generateText } from 'ai';
import type { Character } from '@/lib/types';
import { getModel } from '@/lib/llm/config';

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
根據新發生的事件，更新角色對Andy的主觀記憶。
記憶應該是角色的第一人稱視角，表達對Andy的理解和感受。
保持簡短（2-3 句話），用繁體中文。`,
      prompt: `上次記憶：${previousMemory || '(還沒有特別印象)'}

這輪發生的事：
- Andy說：「${newEvents.playerMessage}」
- 我回覆：「${newEvents.characterResponse}」
- 情緒變化：${newEvents.emotionTag}
- 情緒數值變化：P ${newEvents.padDelta.p > 0 ? '+' : ''}${newEvents.padDelta.p.toFixed(2)}

請更新我對Andy的記憶摘要：`,
    });

    console.log(`[F4] Updated memory:`, result.text.trim());

    return { memory: result.text.trim() };
  } catch (error) {
    console.error('[F4] Error updating memory:', error);
    // Keep previous memory on error
    return { memory: previousMemory || '' };
  }
}
