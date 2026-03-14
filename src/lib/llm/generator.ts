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
        focusChatId?: string;
        focusContext?: Message[];
        backgroundContext?: Message[];
        groupHistory: Message[];
        groupName?: string;
        participantNames?: Record<string, string>;
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
        focusChatId: situation.focusChatId,
        focusContext: situation.focusContext,
        backgroundContext: situation.backgroundContext,
        groupName: situation.groupName,
        participantNames: situation.participantNames,
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
        groupName?: string;
        participantNames?: Record<string, string>;
        focusContext?: Message[];
        backgroundContext?: Message[];
        currentVirtualTimeLabel?: string;
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

    const locationLabel = situation.location === 'dm' ? '私訊（一對一）' : `群組（多人，公開發言）${situation.groupName ? `｜${situation.groupName}` : ''}`;
    const participantSummary = situation.location === 'group'
        ? `群組參與者：${formatParticipantSummary(situation.participantNames)}\n`
        : '';
    const publicSpeakingRules = situation.location === 'group'
        ? `
11. **群組公開發言**：這是在多人聊天室公開說話，不是只對 Andy 的私訊
12. **可見性意識**：回應時要記得其他成員都在場，也都看得到
13. **點名方式**：若回應 Andy 或其他成員，直接用名稱或職稱點名，不要寫成私聊口吻`
        : '';
    const currentVirtualTime = resolveCurrentVirtualTimeLabel({
        currentVirtualTimeLabel: situation.currentVirtualTimeLabel,
        fallbackHistory: situation.chatHistory,
        focusContext: situation.focusContext,
        backgroundContext: situation.backgroundContext,
    });

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
目前虛擬時間：${currentVirtualTime}
本幕目標：${situation.phaseGoal}
${situation.triggerDirection ? `發訊方向：${situation.triggerDirection}` : ''}
${!situation.isOnline ? `⚠️ 目前離線（休息中）：Andy 在你非上班/休息時傳訊給你，回應時語氣帶不悅或不情願，簡短冷淡即可。` : ''}

# 對話脈絡
${formatConversationContexts({
        character,
        location: situation.location,
        focusChatId: situation.focusChatId,
    groupName: situation.groupName,
    participantNames: situation.participantNames,
        focusContext: situation.focusContext,
        backgroundContext: situation.backgroundContext,
        fallbackHistory: situation.chatHistory,
    })}

${participantSummary}${situation.location === 'group' ? `焦點聊天室：${situation.focusChatId || 'group'}\n` : ''}本幕目標：${situation.phaseGoal}
${situation.triggerDirection ? `發訊方向：${situation.triggerDirection}` : ''}

    groupName: situation.groupName,
    participantNames: situation.participantNames,
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
10. **背景僅參考**：不得把背景脈絡中的他人話題當成本輪主要回覆目標${publicSpeakingRules}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatChatHistory(messages: Message[], character: Character, participantNames: Record<string, string> = {}): string {
    const recent = messages.slice(-20);
    if (recent.length === 0) return '（無對話紀錄）';

    // Show chat context tag when history contains both DM and group messages
    const chatIds = [...new Set(recent.map(m => m.chatId))];
    const hasMixedChats = chatIds.length > 1;

    return recent.map(msg => {
        const roleLabel = getMessageSpeakerLabel(msg, character, participantNames);
        const chatTag = hasMixedChats
            ? (msg.chatId === character.id ? '[私訊] ' : '[群組] ')
            : '';
        const timestamp = formatMessageTimestamp(msg);
        return `${chatTag}[${timestamp}] ${roleLabel}：${msg.content}`;
    }).join('\n');
}

function resolveCurrentVirtualTimeLabel(input: {
    currentVirtualTimeLabel?: string;
    fallbackHistory: Message[];
    focusContext?: Message[];
    backgroundContext?: Message[];
}): string {
    if (input.currentVirtualTimeLabel?.trim()) return input.currentVirtualTimeLabel.trim();

    const orderedCandidates = [
        ...(input.focusContext || []),
        ...(input.backgroundContext || []),
        ...input.fallbackHistory,
    ];

    const latestWithVirtualLabel = [...orderedCandidates].reverse().find(msg => msg.virtualTimeLabel?.trim());
    if (latestWithVirtualLabel?.virtualTimeLabel) return latestWithVirtualLabel.virtualTimeLabel.trim();

    const latestMessage = [...orderedCandidates].reverse().find(Boolean);
    if (!latestMessage) return '未知';

    return formatCreatedAtLabel(latestMessage.createdAt);
}

function formatMessageTimestamp(message: Message): string {
    if (message.virtualTimeLabel?.trim()) return message.virtualTimeLabel.trim();
    return formatCreatedAtLabel(message.createdAt);
}

function formatCreatedAtLabel(createdAt: Date): string {
    const safeDate = createdAt instanceof Date ? createdAt : new Date(createdAt);
    if (Number.isNaN(safeDate.getTime())) return '未知時間';

    const hours = String(safeDate.getHours()).padStart(2, '0');
    const minutes = String(safeDate.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

function formatConversationContexts(input: {
    character: Character;
    location: 'dm' | 'group';
    focusChatId?: string;
    groupName?: string;
    participantNames?: Record<string, string>;
    focusContext?: Message[];
    backgroundContext?: Message[];
    fallbackHistory: Message[];
}): string {
    const { character, location, focusChatId, groupName, participantNames = {}, focusContext = [], backgroundContext = [], fallbackHistory } = input;

    const hasScopedContext = focusContext.length > 0 || backgroundContext.length > 0;
    if (!hasScopedContext) {
        return formatChatHistory(fallbackHistory, character, participantNames);
    }

    const focusLabel = location === 'dm'
        ? `私訊主脈絡（chat: ${focusChatId ?? character.id}）`
        : `群組主脈絡（群組：${groupName ?? focusChatId ?? 'group'} / chat: ${focusChatId ?? 'group'}）`;
    const participantSummary = location === 'group'
        ? `參與者：${formatParticipantSummary(participantNames)}\n`
        : '';

    const focusText = formatChatHistory(focusContext, character, participantNames);
    const backgroundText = backgroundContext.length > 0
        ? formatChatHistory(backgroundContext, character, participantNames)
        : '（無背景脈絡）';

    return `## 主要脈絡（必須優先回應）\n${focusLabel}\n${participantSummary}${focusText}\n\n## 背景脈絡（僅參考，不可覆寫主要脈絡）\n${backgroundText}`;
}

function getMessageSpeakerLabel(message: Message, character: Character, participantNames: Record<string, string>): string {
    if (message.senderType === 'player') return participantNames.player || 'Andy';
    if (message.senderId === character.id) return character.profile.name;
    if (message.senderId && participantNames[message.senderId]) return participantNames[message.senderId];
    return message.senderId ? `角色(${message.senderId})` : '未知成員';
}

function formatParticipantSummary(participantNames?: Record<string, string>): string {
    const names = Object.entries(participantNames || {}).map(([, name]) => name);
    return names.length > 0 ? names.join('、') : 'Andy';
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

const autonomousPromptSchema = z.object({
    reason: z.string().describe('為什麼現在要催促，25 字以內'),
    targetChatId: z.string().describe('傳送目標：DM 填入角色 ID，群組填入群組 ID'),
    targetType: z.enum(['dm', 'group']).describe('傳送通道類型'),
    content: z.string().describe('催促訊息內容，10–30 字，繁體中文'),
    expressionKey: z.string().describe('表情鍵值：neutral / happy / sad / angry / surprised'),
});

export type AutonomousPrompt = z.infer<typeof autonomousPromptSchema>;

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

/**
 * llmGenerateAutonomousPrompt
 * 在角色已長時間等待且外部資訊沒有更新時，產生第一次或第二次催促訊息。
 */
export async function llmGenerateAutonomousPrompt(input: {
    character: Character;
    state: { pad: PAD; memory: string };
    phaseGoal: string;
    promptLevel: 1 | 2;
    dmChatId: string;
    dmHistory: Message[];
    groupHistories: { groupId: string; groupName: string; messages: Message[] }[];
}): Promise<AutonomousPrompt> {
    const { character, state, phaseGoal, promptLevel, dmChatId, dmHistory, groupHistories } = input;

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

    const urgencyHint = promptLevel === 1
        ? '這是第一次催促，語氣可以自然提醒，不要太重。'
        : '這是第二次催促，語氣可以比第一次更明確，但仍要符合角色設定。';

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

# 任務
Andy 已經超過一分鐘沒有提供任何新資訊，你要主動送出第 ${promptLevel} 次催促訊息。
${urgencyHint}

## 可傳送頻道
${availableTargets}

## 規則
- 一定要輸出一則催促訊息
- 訊息要短，自然，不要像系統通知
- 繁體中文，不加括號動作描述
- 長度：10–30 字`;

    const prompt = `# 私訊對話紀錄\n${dmLines}\n\n# 群組對話紀錄\n${groupSections || '（無群組）'}`;

    try {
        const { output } = await generateText({
            model: getModel(),
            output: Output.object({ schema: autonomousPromptSchema }),
            system: systemPrompt,
            prompt,
            providerOptions: {
                google: {
                    thinkingConfig: { thinkingBudget: 0 },
                } satisfies GoogleLanguageModelOptions,
            },
        });

        console.log(`[AutonomousPrompt] ${character.profile.name} level ${promptLevel}:`, output);
        return output;
    } catch (error) {
        console.error('[AutonomousPrompt] Error generating prompt:', error);
        return {
            reason: 'LLM error',
            targetChatId: dmChatId,
            targetType: 'dm',
            content: promptLevel === 1 ? '你那邊方便回我一下嗎？' : '我這邊還在等你的回覆。',
            expressionKey: 'neutral',
        };
    }
}
