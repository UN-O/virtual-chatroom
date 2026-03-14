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
            content: z.string().describe('一則訊息泡泡的文字內容，通常 5–25 字；type=sticker 時填入 emoji 字符本身，例如 😅'),
            type: z.enum(['text', 'sticker']).describe('訊息類型；text 為一般文字，sticker 為單一 emoji 貼圖'),
            emojiContent: z.string().optional().describe('emoji字符，type=sticker時使用，例如 😅；type=text時不填'),
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
        focusChatId?: string;
        focusContext?: Message[];
        backgroundContext?: Message[];
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
        focusChatId?: string;
        focusContext?: Message[];
        backgroundContext?: Message[];
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
${!situation.isOnline ? `⚠️ 目前離線（休息中）：Andy 在你非上班/休息時傳訊給你，回應時語氣帶不悅或不情願，簡短冷淡即可。` : ''}

# 對話脈絡
${formatConversationContexts({
    character,
    location: situation.location,
    focusChatId: situation.focusChatId,
    focusContext: situation.focusContext,
    backgroundContext: situation.backgroundContext,
    fallbackHistory: situation.chatHistory,
})}

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
7. **不重複**：不重複對話紀錄中已說過的內容
8. **聚焦主脈絡**：若「主要脈絡」與「背景脈絡」衝突，一律以主要脈絡為準
9. **回覆目標限定**：本輪回覆必須直接對應主要脈絡裡 Andy 的最新訊息
10. **背景僅參考**：不得把背景脈絡中的他人話題當成本輪主要回覆目標`;
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

function formatConversationContexts(input: {
    character: Character;
    location: 'dm' | 'group';
    focusChatId?: string;
    focusContext?: Message[];
    backgroundContext?: Message[];
    fallbackHistory: Message[];
}): string {
    const { character, location, focusChatId, focusContext = [], backgroundContext = [], fallbackHistory } = input;

    const hasScopedContext = focusContext.length > 0 || backgroundContext.length > 0;
    if (!hasScopedContext) {
        return formatChatHistory(fallbackHistory, character);
    }

    const focusLabel = location === 'dm'
        ? `私訊主脈絡（chat: ${focusChatId ?? character.id}）`
        : `群組主脈絡（chat: ${focusChatId ?? 'group'}）`;

    const focusText = formatChatHistory(focusContext, character);
    const backgroundText = backgroundContext.length > 0
        ? formatChatHistory(backgroundContext, character)
        : '（無背景脈絡）';

    return `## 主要脈絡（必須優先回應）\n${focusLabel}\n${focusText}\n\n## 背景脈絡（僅參考，不可覆寫主要脈絡）\n${backgroundText}`;
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

// ── Autonomous Message Decision ───────────────────────────────────────────────

const autonomousDecisionSchema = z.object({
    shouldSend: z.boolean().describe('是否決定主動傳訊息'),
    reason: z.string().describe('決策理由，25 字以內'),
    targetChatId: z.string().describe('傳送目標：DM 填入角色 ID（如 char_boss），群組填入群組 ID（如 group_office）'),
    targetType: z.enum(['dm', 'group']).describe('傳送通道類型'),
    content: z.string().describe('訊息內容，10–30 字；shouldSend=false 時填空字串'),
    expressionKey: z.string().describe('表情鍵值：neutral / happy / sad / angry / surprised'),
});

export type AutonomousDecision = z.infer<typeof autonomousDecisionSchema>;

/**
 * llmDecideAutonomousMessage
 * 角色主動發訊息決策器。
 * 玩家一段時間未回覆時，由 LLM 決定角色是否要主動傳訊、傳到哪、傳什麼。
 * 使用 generateText + Output.object（結構化輸出）。
 */
export async function llmDecideAutonomousMessage(input: {
    character: Character;
    state: { pad: PAD; memory: string };
    phaseGoal: string;
    dmChatId: string;
    dmHistory: Message[];
    groupHistories: { groupId: string; groupName: string; messages: Message[] }[];
}): Promise<AutonomousDecision> {
    const { character, state, phaseGoal, dmChatId, dmHistory, groupHistories } = input;

    const dmLines = dmHistory.length > 0
        ? dmHistory.slice(-8).map(m =>
            `${m.senderType === 'player' ? 'Andy' : character.profile.name}：${m.content}`
          ).join('\n')
        : '（無對話）';

    const groupSections = groupHistories.map(g => {
        const lines = g.messages.slice(-8).map(m => {
            const label = m.senderType === 'player' ? 'Andy'
                : (m.senderId === character.id ? character.profile.name : '（其他人）');
            return `${label}：${m.content}`;
        }).join('\n') || '（無對話）';
        return `### ${g.groupName}\n${lines}`;
    }).join('\n\n');

    const availableTargets = [
        `- dm (chatId: ${dmChatId})：私訊 Andy`,
        ...groupHistories.map(g => `- group (chatId: ${g.groupId})：群組「${g.groupName}」`),
    ].join('\n');

    const systemPrompt = `# 角色設定 — ${character.profile.name}
${character.profile.description}
個性：${character.personality.description}
核心動機：${character.psychology.coreMotivation}
說話風格：${character.speechStyle.description}
口頭禪：${character.speechStyle.catchphrases.join('、') || '（無）'}
絕對不說：${character.speechStyle.forbiddenWords.join('、') || '（無）'}

# 當前狀態
${describePADState(state.pad)}
記憶：${state.memory || '無特別印象'}
本幕目標：${phaseGoal}

# 你是否要主動傳訊息？
Andy 已有一段時間沒有傳訊息給你。根據你目前的情緒狀態、對話歷史、與本幕尚未達成的目標，判斷你是否要主動傳訊息給 Andy。

## 可傳送頻道
${availableTargets}

## 規則
- 只有在你真的有話想說（有情緒張力、或有推進目標的理由）時才傳
- 不一定要傳，沒有必要請回傳 shouldSend=false
- 訊息內容要符合你的說話風格，簡短自然，繁體中文
- 長度：10–30 字，不加括號動作描述`;

    const prompt = `# 私訊對話紀錄\n${dmLines}\n\n# 群組對話紀錄\n${groupSections || '（無群組）'}`;

    try {
        const { output } = await generateText({
            model: getModel(),
            output: Output.object({ schema: autonomousDecisionSchema }),
            system: systemPrompt,
            prompt,
            providerOptions: {
                google: {
                    thinkingConfig: { thinkingBudget: 0 },
                } satisfies GoogleLanguageModelOptions,
            },
        });

        console.log(`[Autonomous] ${character.profile.name} decision:`, output);
        return output;
    } catch (error) {
        console.error('[Autonomous] Error deciding autonomous message:', error);
        return {
            shouldSend: false,
            reason: 'LLM error',
            targetChatId: dmChatId,
            targetType: 'dm',
            content: '',
            expressionKey: 'neutral',
        };
    }
}
