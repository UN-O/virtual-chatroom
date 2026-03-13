import { Output, generateText } from 'ai';
import { z } from 'zod';
import type { Character, PAD, Message, CharacterMessageBurst, MessageBubble } from '@/lib/types';
import { describePADState } from '@/lib/engine/pad';
import { getModel } from './config';
import { GoogleLanguageModelOptions } from '@ai-sdk/google';

// ── Zod schema for F1 structured output ──────────────────────────────────────

const messageBurstSchema = z.object({
    messages: z.array(
        z.object({
            content: z.string().describe('一則訊息泡泡的文字內容，通常 5–25 字'),
            type: z.enum(['text', 'sticker']).describe('訊息類型，通常為 text'),
        })
    ).min(1).max(4).describe('角色這次要傳的 1–4 則訊息泡泡，模擬 LINE 分則傳送的節奏'),
});

// ── F1 ────────────────────────────────────────────────────────────────────────

/**
 * F1: llmGenerateCharacterMessage
 * Type: Generator (Scriptwriter framing)
 * Usage: Character proactive messages (phase start), DM replies to player
 * Trigger: /api/event/phase-start, /api/chat (action: respond)
 *
 * Returns a burst of 1–4 short message bubbles, simulating LINE-style
 * multi-message sending patterns. Uses generateObject() for structured output.
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
}): Promise<CharacterMessageBurst> {
    const { character, state, situation } = input;

    const systemPrompt = buildScriptwriterPrompt(character, state, situation);

    try {
        const { output } = await generateText({
            model: getModel(),
            output: Output.object({
                schema: messageBurstSchema,
            }),
            system: systemPrompt,
            prompt: '請設計接下來的訊息泡泡。',
            providerOptions: {
                google: {
                    thinkingConfig: { thinkingBudget: 0 },
                } satisfies GoogleLanguageModelOptions,
            },
        });

        console.log(`[F1] ${character.profile.name} burst:`, output.messages);

        return {
            messages: output.messages,
            expressionKey: getExpressionKey(state.pad),
        };
    } catch (error) {
        console.error('[F1] Error generating character message:', error);
        return getFallbackBurst(character, situation);
    }
}

// ── F2 ────────────────────────────────────────────────────────────────────────

/**
 * F2: llmGenerateGroupResponse
 * Type: Generator
 * Usage: Character responds in group chat
 * Trigger: /api/chat (action: groupRespond)
 *
 * Group responses stay as a single message (simpler context).
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
        high: '需要盡快回應，可能有重要的事',
    }[situation.urgency];

    const systemPrompt = `${buildScriptwriterPrompt(character, state, {
        phaseGoal: situation.phaseGoal,
        triggerDirection: '',
        chatHistory: situation.groupHistory,
        isOnline: situation.isOnline,
        location: 'group',
    })}

## 緊迫程度
${urgencyHint}

（群組回應只需一則訊息即可）`;

    try {
        const result = await generateText({
            model: getModel(),
            system: systemPrompt,
            prompt: `請以 ${character.profile.name} 的身分，設計一則群組回應訊息泡泡。只輸出訊息內容本身，不要其他說明。`,
        });

        console.log(`[F2] ${character.profile.name} group:`, result.text.trim());
        return {
            content: result.text.trim(),
            expressionKey: getExpressionKey(state.pad),
        };
    } catch (error) {
        console.error('[F2] Error generating group response:', error);
        return { content: getSimpleFallback(character) };
    }
}

// ── Scriptwriter System Prompt ────────────────────────────────────────────────

function buildScriptwriterPrompt(
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
    const catchphrases = character.speechStyle.catchphrases.length > 0
        ? character.speechStyle.catchphrases.join('、')
        : '（無特定口頭禪）';
    const forbidden = character.speechStyle.forbiddenWords.length > 0
        ? character.speechStyle.forbiddenWords.join('、')
        : '（無）';
    const traumas = character.psychology.traumas.length > 0
        ? character.psychology.traumas.map(t => t.description).join('；')
        : '（無）';

    const locationLabel = situation.location === 'dm' ? '私訊（一對一）' : '群組（多人）';

    return `# 角色設定卡 — ${character.profile.name}

## 基本資料
${character.profile.name}，${character.profile.age} 歲。
${character.profile.description}

## 個性
${character.personality.description}

## 說話風格
${character.speechStyle.description}
口頭禪：${catchphrases}
絕對不說：${forbidden}

## 心理底層
核心動機：${character.psychology.coreMotivation}
創傷 / 敏感點：${traumas}

---

# 情緒狀態（PAD）
${describePADState(state.pad)}
（P 低 → 語氣更冷漠；A 高 → 訊息更短促；D 高 → 語氣更強勢）

# 對 Andy 的印象
${state.memory || '還沒有特別的印象。'}

---

# 當前場景
場景：${locationLabel}
本幕目標：${situation.phaseGoal}
${situation.triggerDirection ? `發訊方向：${situation.triggerDirection}` : ''}

# 對話紀錄
${formatChatHistory(situation.chatHistory, character)}

---

# 你的工作
你是一位互動敘事劇本設計師，正在設計一款模擬 LINE 聊天室的遊戲。
請根據以上「角色設定卡」，幫這個角色設計「接下來要傳的訊息泡泡」。

## LINE 台詞設計規則
1. **分則傳送**：可以分成 1–4 則短訊息，模擬角色分次打字的節奏
2. **每則要短**：每則訊息通常 5–25 字，就像真實 LINE 泡泡
3. **節奏判斷**：根據角色個性決定幾則（話少的角色偏向 1 則，話多的可 2–3 則）
4. **情緒克制**：不用每句都爆發，有時候一句簡短的回應更有力道
5. **嚴守角色**：口頭禪要自然出現，禁用詞絕對不能出現
6. **繁體中文**：不要括號動作描述，不要旁白說明
7. **不重複**：不重複對話紀錄中已說過的內容`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatChatHistory(messages: Message[], character: Character): string {
    const recent = messages.slice(-20);
    if (recent.length === 0) return '（無對話紀錄）';

    // Show chat context tag when history contains both DM and group messages
    const chatIds = [...new Set(recent.map(m => m.chatId))];
    const hasMixedChats = chatIds.length > 1;

    return recent.map(msg => {
        let roleLabel = 'Andy';
        if (msg.senderType === 'character') {
            roleLabel = msg.senderId === character.id
                ? character.profile.name
                : '（其他角色）';
        }
        const chatTag = hasMixedChats
            ? (msg.chatId === character.id ? '[私訊] ' : '[群組] ')
            : '';
        return `${chatTag}${roleLabel}：${msg.content}`;
    }).join('\n');
}

function getExpressionKey(pad: PAD): string {
    if (pad.p > 0.4) return 'happy';
    if (pad.p < -0.3 && pad.a > 0.5) return 'angry';
    if (pad.p < -0.2) return 'sad';
    if (pad.a > 0.6) return 'surprised';
    return 'neutral';
}

function getFallbackBurst(
    character: Character,
    situation: { location: 'dm' | 'group'; triggerDirection: string }
): CharacterMessageBurst {
    const bubbles: MessageBubble[] = [];

    if (character.id === 'char_boss') {
        if (situation.triggerDirection.includes('Q3')) {
            bubbles.push({ content: '今天下午開會需要 Q3 業績摘要', type: 'text' });
            bubbles.push({ content: '下班前給我', type: 'text' });
        } else if (situation.triggerDirection.includes('進度')) {
            bubbles.push({ content: '報告進度？', type: 'text' });
        } else {
            bubbles.push({ content: '收到。', type: 'text' });
        }
    } else if (character.id === 'char_coworker') {
        if (situation.triggerDirection.includes('忙') || situation.triggerDirection.includes('行程')) {
            bubbles.push({ content: '欸我跟你說', type: 'text' });
            bubbles.push({ content: '我今天真的超忙的啦', type: 'text' });
            bubbles.push({ content: '下午還有兩個 call...', type: 'text' });
        } else {
            bubbles.push({ content: '嗯嗯～', type: 'text' });
        }
    } else {
        bubbles.push({ content: '好。', type: 'text' });
    }

    return { messages: bubbles, expressionKey: 'neutral' };
}

function getSimpleFallback(character: Character): string {
    if (character.id === 'char_boss') return '嗯。';
    if (character.id === 'char_coworker') return '嗯嗯～';
    return '好。';
}
