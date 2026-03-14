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

import { useCallback, useEffect, useRef } from 'react';
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
    /** 每個 DM chat 的請求序號（最新序號勝出） */
    const dmRequestSeqRef = useRef<Record<string, number>>({});
    /** 每個 DM chat 的 in-flight request controller（新訊息會中止舊請求） */
    const dmAbortRef = useRef<Record<string, AbortController | undefined>>({});

    /** 每個群組 chat 的波次序號（最新波次勝出） */
    const groupRequestSeqRef = useRef<Record<string, number>>({});
    /** 每個群組 chat 的 in-flight wave controller（新訊息會中止舊波次） */
    const groupAbortRef = useRef<Record<string, AbortController | undefined>>({});

    /** 每個角色的自主檢查序號（最新序號勝出） */
    const autonomousSeqRef = useRef<Record<string, number>>({});
    /** 每個角色的自主檢查 AbortController（玩家新訊息時中止） */
    const autonomousAbortRef = useRef<Record<string, AbortController | undefined>>({});

    useEffect(() => {
        return () => {
            Object.values(dmAbortRef.current).forEach(c => c?.abort());
            Object.values(groupAbortRef.current).forEach(c => c?.abort());
            Object.values(autonomousAbortRef.current).forEach(c => c?.abort());
        };
    }, []);

    const startLatestDMRequest = useCallback((chatId: string) => {
        dmAbortRef.current[chatId]?.abort();
        const controller = new AbortController();
        dmAbortRef.current[chatId] = controller;

        const nextSeq = (dmRequestSeqRef.current[chatId] ?? 0) + 1;
        dmRequestSeqRef.current[chatId] = nextSeq;

        return { seq: nextSeq, signal: controller.signal };
    }, []);

    const isLatestDMRequest = useCallback((chatId: string, seq: number) => {
        return dmRequestSeqRef.current[chatId] === seq;
    }, []);

    const startLatestGroupRequest = useCallback((chatId: string) => {
        groupAbortRef.current[chatId]?.abort();
        const controller = new AbortController();
        groupAbortRef.current[chatId] = controller;

        const nextSeq = (groupRequestSeqRef.current[chatId] ?? 0) + 1;
        groupRequestSeqRef.current[chatId] = nextSeq;

        return { seq: nextSeq, signal: controller.signal };
    }, []);

    const isLatestGroupRequest = useCallback((chatId: string, seq: number) => {
        return groupRequestSeqRef.current[chatId] === seq;
    }, []);

    /** 開始一次自主檢查（同一角色的舊檢查會被中止） */
    const startAutonomousCheck = useCallback((characterId: string) => {
        autonomousAbortRef.current[characterId]?.abort();
        const controller = new AbortController();
        autonomousAbortRef.current[characterId] = controller;
        const nextSeq = (autonomousSeqRef.current[characterId] ?? 0) + 1;
        autonomousSeqRef.current[characterId] = nextSeq;
        return { seq: nextSeq, signal: controller.signal };
    }, []);

    const isLatestAutonomousCheck = useCallback((characterId: string, seq: number) => {
        return autonomousSeqRef.current[characterId] === seq;
    }, []);

    /** 中止某角色目前進行中的自主檢查（不遞增序號） */
    const cancelAutonomousCheck = useCallback((characterId: string) => {
        autonomousAbortRef.current[characterId]?.abort();
        delete autonomousAbortRef.current[characterId];
    }, []);

    const sendMessage = useCallback(async (
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
            const { seq, signal } = startLatestDMRequest(chatId);
            handleDM({
                chatId, content, cur,
                getVirtualTimeLabel, vtCancelNudge, vtScheduleNudge, setSession, resetNudgeCount,
                dmRequestSeq: seq,
                dmRequestSignal: signal,
                isLatestDMRequest,
            });
            return;
        }

        // ── 群組 ─────────────────────────────────────────────────────────────
        const group = groups.find(g => g.id === chatId);
        if (group) {
            group.members.forEach(memberId => vtCancelNudge(memberId));
            const { seq, signal } = startLatestGroupRequest(chatId);
            handleGroup({
                group, chatId, content, cur,
                getVirtualTimeLabel, setSession, vtScheduleNudge,
                groupRequestSeq: seq,
                groupRequestSignal: signal,
                isLatestGroupRequest,
            });
        }
    }, [vtCancelNudge, vtScheduleNudge, sessionRef, getVirtualTimeLabel, setSession, resetNudgeCount, startLatestDMRequest, isLatestDMRequest, startLatestGroupRequest, isLatestGroupRequest]);

    return { sendMessage, startAutonomousCheck, isLatestAutonomousCheck, cancelAutonomousCheck };
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
    dmRequestSeq: number;
    dmRequestSignal: AbortSignal;
    isLatestDMRequest: (chatId: string, seq: number) => boolean;
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
    dmRequestSeq, dmRequestSignal, isLatestDMRequest,
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

    // 綜合 DM + 群組歷史作為角色上下文，並明確分出主要/背景脈絡
    const dmHistory = cur.messages.filter(m => m.chatId === chatId).slice(-10);
    const groupHistory = cur.messages
        .filter(m => groups.some(g => g.id === m.chatId))
        .slice(-10);
    const playerTempMessage: Message = {
        id: 'temp',
        chatId,
        senderType: 'player' as const,
        senderId: 'player',
        content,
        createdAt: new Date()
    };
    const focusContext: Message[] = [...dmHistory, playerTempMessage];
    const backgroundContext: Message[] = [...groupHistory];
    const combinedHistory: Message[] = [
        ...dmHistory,
        ...groupHistory,
        playerTempMessage
    ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const tStart = Date.now();

    // F1：立刻打 API（內部同步執行 F3 analyze），完成後等 remaining 才顯示
    // NOTE: action=respond already runs F3 internally and returns padDelta + emotionTag.
    // We do NOT fire a separate action=analyze to avoid double-applying the PAD delta.
    fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: dmRequestSignal,
        body: JSON.stringify({
            action: 'respond',
            characterId: chatId,
            playerMessage: content,
            focusChatId: chatId,
            focusContext,
            backgroundContext,
            chatHistory: combinedHistory,
            currentPad: charState?.pad || { p: 0, a: 0.5, d: 0 },
            memory: charState?.memory || '',
            phaseGoal: mission?.goal || '',
            triggerDirection: mission?.triggerDirection || '',
            location: 'dm',
            isOnline
        })
    }).then(r => r.json()).then(data => {
        if (!isLatestDMRequest(chatId, dmRequestSeq)) return;

        const burst: Array<{ content: string }> = data?.messages;
        if (!burst?.length) return;

        const elapsed = Date.now() - tStart;
        const remaining = Math.max(0, tDelay - elapsed);
        const BUBBLE_GAP = 800; // ms between each bubble in a burst

        // First bubble: show at `remaining`, mark 已讀, apply PAD delta (from F3 inside respond)
        setTimeout(() => {
            if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
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
                if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
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
        setTimeout(() => {
            if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
            vtScheduleNudge(chatId, chatId, 15);
        }, totalDelay);

        // F4：更新記憶（F3 的 emotionTag 已由 respond 回傳，直接使用）
        if (charState && data.emotionTag) {
            if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'updateMemory',
                    characterId: chatId,
                    previousMemory: charState.memory,
                    playerMessage: content,
                    characterResponse: burst[0]?.content || '',
                    padDelta: data.padDelta || { p: 0, a: 0, d: 0 },
                    emotionTag: data.emotionTag
                })
            }).then(r => r.json()).then(res => {
                if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
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
    }).catch(e => {
        if ((e as Error)?.name === 'AbortError') return;
        console.error('[F1] DM response error', e);
    });

    // F5：背景執行 goal 檢查（未達成且有 mission 才執行）
    // F3 已由 action=respond 內部執行，此處只需 F5。
    if (charState && mission && !charState.goalAchieved) {
        if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
        fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'checkGoal',
                goal: mission.goal,
                completionHint: mission.completionHint,
                chatHistory: combinedHistory,
                currentlyAchieved: false
            })
        }).then(r => r.json()).then(goalResult => {
            if (!isLatestDMRequest(chatId, dmRequestSeq)) return;
            if (goalResult?.achieved) {
                vtCancelNudge(chatId);
                resetNudgeCount(chatId);
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
                                goalAchieved: true
                            }
                        }
                    };
                });
            }
        }).catch(e => console.error('[F5] Goal check failed', e));
    }
}

// ── Group Handler ─────────────────────────────────────────────────────────────

interface HandleGroupOptions {
    group: { id: string; name: string; members: string[] };
    chatId: string;
    content: string;
    cur: ClientSession;
    getVirtualTimeLabel: () => string;
    setSession: Dispatch<SetStateAction<ClientSession | null>>;
    vtScheduleNudge: (characterId: string, chatId: string, delaySeconds: number) => void;
    groupRequestSeq: number;
    groupRequestSignal: AbortSignal;
    isLatestGroupRequest: (chatId: string, seq: number) => boolean;
}

function buildGroupScenePayload(group: { id: string; name: string; members: string[] }, content: string, groupHistory: Message[]) {
    const latestPlayerMessage: Message = {
        id: 'temp',
        chatId: group.id,
        senderType: 'player',
        senderId: 'player',
        content,
        createdAt: new Date()
    };
    const participantIds = ['player', ...group.members];
    const participantNames = participantIds.reduce<Record<string, string>>((acc, participantId) => {
        if (participantId === 'player') {
            acc[participantId] = 'Andy';
            return acc;
        }

        acc[participantId] = characters[participantId]?.profile.name || participantId;
        return acc;
    }, {});

    return {
        focusChatId: group.id,
        focusContext: [...groupHistory, latestPlayerMessage],
        backgroundContext: [] as Message[],
        groupHistory: [...groupHistory, latestPlayerMessage],
        groupName: group.name,
        participantIds,
        participantNames,
    };
}

function handleGroup({
    group, chatId, content, cur,
    getVirtualTimeLabel, setSession, vtScheduleNudge, groupRequestSeq, groupRequestSignal, isLatestGroupRequest,
}: HandleGroupOptions) {
    const groupHistory = cur.messages.filter(m => m.chatId === chatId).slice(-15);
    const groupScene = buildGroupScenePayload(group, content, groupHistory);

    group.members.forEach(memberId => {
        if (!isLatestGroupRequest(chatId, groupRequestSeq)) return;

        const memberChar = characters[memberId];
        const memberState = cur.characterStates[memberId];
        if (!memberChar || !memberState) return;
        if (!shouldRespond(memberChar, memberState.pad.a)) return;

        const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
        const mission = currentPhase?.characterMissions.find(m => m.characterId === memberId);
        const tDelay = (mission?.responseDelaySeconds ?? 5) * 1000;

        const tStart = Date.now();

        // F2 (group respond) + F3 (analyze PAD) in parallel
        Promise.all([
            fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: groupRequestSignal,
                body: JSON.stringify({
                    action: 'groupRespond',
                    characterId: memberId,
                    focusChatId: groupScene.focusChatId,
                    focusContext: groupScene.focusContext,
                    backgroundContext: groupScene.backgroundContext,
                    groupHistory: groupScene.groupHistory,
                    groupName: groupScene.groupName,
                    participantIds: groupScene.participantIds,
                    participantNames: groupScene.participantNames,
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
                signal: groupRequestSignal,
                body: JSON.stringify({
                    action: 'analyze',
                    characterId: memberId,
                    playerMessage: content,
                    focusChatId: groupScene.focusChatId,
                    focusContext: groupScene.focusContext,
                    backgroundContext: groupScene.backgroundContext,
                    chatHistory: groupScene.groupHistory,
                    location: 'group',
                    groupName: groupScene.groupName,
                    participantIds: groupScene.participantIds,
                    participantNames: groupScene.participantNames,
                    currentPad: memberState.pad
                })
            }).then(r => r.json()).catch(() => null)
        ]).then(([f2Data, analyzeResult]) => {
            if (!isLatestGroupRequest(chatId, groupRequestSeq)) return;

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
                if (!isLatestGroupRequest(chatId, groupRequestSeq)) return;
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
                // 群組回應後排程自主檢查（15 秒後角色可主動發訊）
                vtScheduleNudge(memberId, memberId, 15);
            }, remaining);
        }).catch(e => {
            if ((e as Error)?.name === 'AbortError') return;
            console.error(`[F2/F3] Group response error for ${memberId}`, e);
        });
    });
}
