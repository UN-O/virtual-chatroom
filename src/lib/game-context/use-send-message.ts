'use client';

/**
 * use-send-message.ts — useSendMessage hook
 *
 * 封裝 GameProvider 的訊息發送邏輯，包含：
 *  - DM 流程：t_delay 模式（立刻打 F1 API → remaining 後顯示泡泡 + 標記已讀）
 *             F3 + F5 平行背景執行，F3 完成後觸發 F4
 *  - 群組流程：shouldRespond() 過濾 → F2 + F3 並行，PAD delta 靜默更新
 *
 * 透過 options 注入所有外部依賴（ref、callback、setState），
 * 讓 provider.tsx 保持精簡，此 hook 可獨立閱讀與測試。
 */

import { useCallback } from 'react';
import type { MutableRefObject, Dispatch, SetStateAction } from 'react';

import { generateId } from './helpers';
import { characters, groups, storyPlot } from '../story-data';
import { shouldRespond } from '../engine/pad';

import type { ClientSession, Message } from '../types';

// ── Options ───────────────────────────────────────────────────────────────────

export interface UseSendMessageOptions {
    /** async callback 內讀取最新 session（避免 stale closure） */
    sessionRef: MutableRefObject<ClientSession | null>;
    /** 回傳當前虛擬時間標籤字串（e.g. "09:05"） */
    getVirtualTimeLabel: () => string;
    /** 取消某個 chatId 的 nudge 計時器 */
    vtCancelNudge: (characterId: string) => void;
    /** 排程 nudge 計時器 */
    vtScheduleNudge: (characterId: string, chatId: string, delaySeconds: number) => void;
    /** React setState dispatcher */
    setSession: Dispatch<SetStateAction<ClientSession | null>>;
    /** 玩家回覆後重置某個 chatId 的 nudge 計數 */
    resetNudgeCount: (chatId: string) => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSendMessage({
    sessionRef,
    getVirtualTimeLabel,
    vtCancelNudge,
    vtScheduleNudge,
    setSession,
    resetNudgeCount,
}: UseSendMessageOptions) {
    return useCallback(async (
        chatId: string,
        content: string,
        type: 'text' | 'sticker' = 'text',
        stickerId?: string
    ) => {
        if (!chatId) return;

        // 立即（樂觀）寫入玩家訊息
        const playerVtLabel = getVirtualTimeLabel();
        setSession(prev => {
            if (!prev) return null;
            return {
                ...prev,
                messages: [...prev.messages, {
                    id: generateId(),
                    chatId,
                    senderType: 'player',
                    senderId: 'player',
                    content,
                    stickerId,
                    virtualTimeLabel: playerVtLabel,
                    createdAt: new Date()
                }],
                lastActiveAt: new Date()
            };
        });

        const cur = sessionRef.current;
        if (!cur) return;

        // ── DM ───────────────────────────────────────────────────────────────
        const char = characters[chatId];
        if (char) {
            handleDM({
                chatId, content, cur,
                getVirtualTimeLabel, vtCancelNudge, vtScheduleNudge, setSession, resetNudgeCount,
            });
            return;
        }

        // ── 群組 ─────────────────────────────────────────────────────────────
        const group = groups.find(g => g.id === chatId);
        if (group) {
            handleGroup({
                group, chatId, content, cur,
                getVirtualTimeLabel, setSession,
            });
        }
    }, [vtCancelNudge, vtScheduleNudge, sessionRef, getVirtualTimeLabel, setSession, resetNudgeCount]);
}

// ── DM Handler ────────────────────────────────────────────────────────────────

interface HandleDMOptions {
    chatId: string;
    content: string;
    cur: ClientSession;
    getVirtualTimeLabel: () => string;
    vtCancelNudge: (characterId: string) => void;
    vtScheduleNudge: (characterId: string, chatId: string, delaySeconds: number) => void;
    setSession: Dispatch<SetStateAction<ClientSession | null>>;
    resetNudgeCount: (chatId: string) => void;
}

/** 將 phase ID 對應到 OnlineSchedule 鍵名（與 helpers.ts 保持一致） */
function getOnlineScheduleKey(phaseId: string): keyof import('../types').OnlineSchedule | null {
    if (phaseId === 'morning') return 'morning';
    if (phaseId === 'afternoon') return 'afternoon';
    if (phaseId.startsWith('ending')) return 'evening';
    return null;
}

function handleDM({
    chatId, content, cur,
    getVirtualTimeLabel, vtCancelNudge, vtScheduleNudge, setSession, resetNudgeCount,
}: HandleDMOptions) {
    vtCancelNudge(chatId);
    resetNudgeCount(chatId);

    const char = characters[chatId];
    const charState = cur.characterStates[chatId];
    const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
    const mission = currentPhase?.characterMissions.find(m => m.characterId === chatId);
    const tDelay = (mission?.responseDelaySeconds ?? 3) * 1000;

    // 判斷角色是否在線（依當前 phase 對應的 onlineSchedule 時段）
    const scheduleKey = getOnlineScheduleKey(cur.currentPhaseId);
    const isOnline = char && scheduleKey != null ? char.onlineSchedule[scheduleKey] : true;

    // 離線懲罰：玩家打擾離線角色，立即施加 PAD P -0.15 delta
    if (!isOnline && charState) {
        setSession(prev => {
            if (!prev) return null;
            const old = prev.characterStates[chatId];
            if (!old) return prev;
            return {
                ...prev,
                characterStates: {
                    ...prev.characterStates,
                    [chatId]: {
                        ...old,
                        pad: {
                            ...old.pad,
                            p: Math.max(-1, old.pad.p - 0.15)
                        }
                    }
                }
            };
        });
    }

    // 綜合 DM + 群組歷史作為角色的上下文
    const dmHistory = cur.messages.filter(m => m.chatId === chatId).slice(-10);
    const groupHistory = cur.messages
        .filter(m => groups.some(g => g.id === m.chatId))
        .slice(-10);
    const combinedHistory: Message[] = [
        ...dmHistory,
        ...groupHistory,
        { id: 'temp', chatId, senderType: 'player' as const, senderId: 'player', content, createdAt: new Date() }
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const tStart = Date.now();

    // F1：立刻打 API，完成後等 remaining 才顯示
    fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'respond',
            characterId: chatId,
            playerMessage: content,
            chatHistory: combinedHistory,
            currentPad: charState?.pad || { p: 0, a: 0.5, d: 0 },
            memory: charState?.memory || '',
            phaseGoal: mission?.goal || '',
            triggerDirection: mission?.triggerDirection || '',
            location: 'dm',
            isOnline
        })
    }).then(r => r.json()).then(data => {
        const burst: Array<{ content: string }> = data?.messages;
        if (!burst?.length) return;

        const elapsed = Date.now() - tStart;
        const remaining = Math.max(0, tDelay - elapsed);
        const BUBBLE_GAP = 800; // ms between each bubble in a burst

        // First bubble: show at `remaining`, mark 已讀, apply PAD delta
        setTimeout(() => {
            const vtLabel = getVirtualTimeLabel();
            setSession(prev => {
                if (!prev) return null;

                // 標記最後一則玩家訊息為「已讀」
                let msgs = prev.messages;
                const lastPlayerIdx = msgs.reduce(
                    (idx, m, i) => (m.chatId === chatId && m.senderType === 'player' ? i : idx),
                    -1
                );
                if (lastPlayerIdx >= 0) {
                    msgs = msgs.map((m, i) => i === lastPlayerIdx
                        ? { ...m, readBy: [...(m.readBy || []).filter(id => id !== chatId), chatId] }
                        : m
                    );
                }

                const firstBubble: Message = {
                    id: generateId(),
                    chatId,
                    senderType: 'character',
                    senderId: chatId,
                    content: burst[0].content,
                    expressionKey: data.expressionKey,
                    virtualTimeLabel: vtLabel,
                    createdAt: new Date()
                };

                // 同步更新 PAD（只在第一則套用，避免重複計算）
                if (data.padDelta) {
                    const old = prev.characterStates[chatId];
                    const d = data.padDelta;
                    return {
                        ...prev,
                        messages: [...msgs, firstBubble],
                        characterStates: {
                            ...prev.characterStates,
                            [chatId]: {
                                ...old,
                                pad: {
                                    p: Math.max(-1, Math.min(1, old.pad.p + d.p)),
                                    a: Math.max(0, Math.min(1, old.pad.a + d.a)),
                                    d: Math.max(-1, Math.min(1, old.pad.d + d.d))
                                }
                            }
                        }
                    };
                }
                return { ...prev, messages: [...msgs, firstBubble] };
            });
        }, remaining);

        // Remaining bubbles: stagger at BUBBLE_GAP intervals
        burst.slice(1).forEach((bubble, i) => {
            setTimeout(() => {
                const vtLabel = getVirtualTimeLabel();
                setSession(prev => prev ? {
                    ...prev,
                    messages: [...prev.messages, {
                        id: generateId(),
                        chatId,
                        senderType: 'character',
                        senderId: chatId,
                        content: bubble.content,
                        expressionKey: data.expressionKey,
                        virtualTimeLabel: vtLabel,
                        createdAt: new Date()
                    } as Message]
                } : null);
            }, remaining + (i + 1) * BUBBLE_GAP);
        });

        // 所有泡泡顯示完後才開始 nudge 計時
        const totalDelay = remaining + (burst.length - 1) * BUBBLE_GAP;
        setTimeout(() => vtScheduleNudge(chatId, chatId, 45), totalDelay);
    }).catch(e => console.error('[F1] DM response error', e));

    // F3 + F5 平行背景執行
    if (charState) {
        Promise.all([
            // F3：分析 PAD delta
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'analyze',
                    characterId: chatId,
                    playerMessage: content,
                    chatHistory: dmHistory,
                    currentPad: charState.pad
                })
            }).then(r => r.json()).catch(() => null),
            // F5：檢查 goal（未達成且有 mission 才執行）
            mission && !charState.goalAchieved
                ? fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'checkGoal',
                        goal: mission.goal,
                        completionHint: mission.completionHint,
                        chatHistory: combinedHistory,
                        currentlyAchieved: false
                    })
                }).then(r => r.json()).catch(() => null)
                : Promise.resolve(null)
        ]).then(([analyzeResult, goalResult]) => {
            setSession(prev => {
                if (!prev) return null;
                const old = prev.characterStates[chatId];
                if (!old) return prev;
                const d = analyzeResult?.padDelta || { p: 0, a: 0, d: 0 };
                return {
                    ...prev,
                    characterStates: {
                        ...prev.characterStates,
                        [chatId]: {
                            ...old,
                            pad: {
                                p: Math.max(-1, Math.min(1, old.pad.p + d.p)),
                                a: Math.max(0, Math.min(1, old.pad.a + d.a)),
                                d: Math.max(-1, Math.min(1, old.pad.d + d.d))
                            },
                            goalAchieved: goalResult?.achieved ?? old.goalAchieved
                        }
                    }
                };
            });
            // F4：更新記憶（F3 完成後背景執行）
            if (analyzeResult?.emotionTag) {
                fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'updateMemory',
                        characterId: chatId,
                        previousMemory: charState.memory,
                        playerMessage: content,
                        characterResponse: '',
                        padDelta: analyzeResult.padDelta || { p: 0, a: 0, d: 0 },
                        emotionTag: analyzeResult.emotionTag
                    })
                }).then(r => r.json()).then(res => {
                    if (res?.memory) {
                        setSession(prev => prev ? {
                            ...prev,
                            characterStates: {
                                ...prev.characterStates,
                                [chatId]: { ...prev.characterStates[chatId], memory: res.memory }
                            }
                        } : null);
                    }
                }).catch(e => console.error('[F4] Memory update failed', e));
            }
        }).catch(e => console.error('[F3/F5] Analysis failed', e));
    }
}

// ── Group Handler ─────────────────────────────────────────────────────────────

interface HandleGroupOptions {
    group: { id: string; members: string[] };
    chatId: string;
    content: string;
    cur: ClientSession;
    getVirtualTimeLabel: () => string;
    setSession: Dispatch<SetStateAction<ClientSession | null>>;
}

function handleGroup({
    group, chatId, content, cur,
    getVirtualTimeLabel, setSession,
}: HandleGroupOptions) {
    const groupHistory = cur.messages.filter(m => m.chatId === chatId).slice(-15);

    group.members.forEach(memberId => {
        const memberChar = characters[memberId];
        const memberState = cur.characterStates[memberId];
        if (!memberChar || !memberState) return;
        if (!shouldRespond(memberChar, memberState.pad.a)) return;

        const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
        const mission = currentPhase?.characterMissions.find(m => m.characterId === memberId);
        const tDelay = (mission?.responseDelaySeconds ?? 5) * 1000;

        // 群組回應只使用群組歷史，避免 DM 頻道語境污染群組回覆
        const combinedHistory: Message[] = [
            ...groupHistory,
            { id: 'temp', chatId, senderType: 'player' as const, senderId: 'player', content, createdAt: new Date() }
        ];

        const tStart = Date.now();

        // F2 (group respond) + F3 (analyze PAD) in parallel
        Promise.all([
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'groupRespond',
                    characterId: memberId,
                    groupHistory: combinedHistory,
                    currentPad: memberState.pad,
                    memory: memberState.memory || '',
                    phaseGoal: mission?.goal || '',
                    urgency: 'medium'
                })
            }).then(r => r.json()).catch(() => null),
            // F3：分析群組訊息對該角色的情緒影響
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'analyze',
                    characterId: memberId,
                    playerMessage: content,
                    chatHistory: groupHistory,
                    currentPad: memberState.pad
                })
            }).then(r => r.json()).catch(() => null)
        ]).then(([f2Data, analyzeResult]) => {
            // Apply F3 PAD delta (silent background update)
            if (analyzeResult?.padDelta) {
                setSession(prev => {
                    if (!prev) return null;
                    const old = prev.characterStates[memberId];
                    if (!old) return prev;
                    const d = analyzeResult.padDelta;
                    return {
                        ...prev,
                        characterStates: {
                            ...prev.characterStates,
                            [memberId]: {
                                ...old,
                                pad: {
                                    p: Math.max(-1, Math.min(1, old.pad.p + d.p)),
                                    a: Math.max(0, Math.min(1, old.pad.a + d.a)),
                                    d: Math.max(-1, Math.min(1, old.pad.d + d.d))
                                }
                            }
                        }
                    };
                });
            }

            if (!f2Data?.content) return;
            const elapsed = Date.now() - tStart;
            const remaining = Math.max(0, tDelay - elapsed);

            setTimeout(() => {
                const vtLabel = getVirtualTimeLabel();
                setSession(prev => prev ? {
                    ...prev,
                    messages: [...prev.messages, {
                        id: generateId(),
                        chatId,
                        senderType: 'character',
                        senderId: memberId,
                        content: f2Data.content,
                        expressionKey: f2Data.expressionKey,
                        virtualTimeLabel: vtLabel,
                        createdAt: new Date()
                    }]
                } : null);
            }, remaining);
        }).catch(e => console.error(`[F2/F3] Group response error for ${memberId}`, e));
    });
}
