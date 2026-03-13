'use client';

/**
 * provider.tsx — GameProvider
 *
 * 負責將所有子模組的邏輯組裝成一個完整的 React Context Provider：
 *
 *  1. Session CRUD        — 建立、載入、刪除遊戲進度（LocalStorage）
 *  2. Nudge Engine        — 透過 useVirtualTime hook 管理 nudge 計時器
 *  3. sendMessage         — DM 或群組訊息發送
 *     · 立即呼叫 API（不等 t_delay 才打）
 *     · API 回傳後：wait max(0, t_delay - elapsed) 才顯示 + 標記已讀
 *     · 同步平行跑 F3（analyze）、F5（checkGoal）
 *     · F3 完成後非同步跑 F4（updateMemory）
 *  4. Phase Management    → advancePhase（評估 branch conditions + 呼叫 phase-start API）
 *
 *  Context 歷史設計：每個角色回應時，同時傳入 DM 歷史 + 群組歷史，
 *  讓角色能綜合兩個聊天室的資訊來回應。
 */

import React, {
    useEffect,
    useState,
    useCallback,
    useRef,
    useMemo
} from 'react';

import { GameContext } from './context';
import { generateId, initializeNewSession, getChatRooms, computeVirtualTimeLabel } from './helpers';

import { LocalSessionAdapter } from '../storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from '../story-data';
import { areAllGoalsAchieved, determineNextPhase } from '../engine/phase';
import { shouldRespond } from '../engine/pad';
import { useVirtualTime } from '@/hooks/useVirtualTime';

import type { ClientSession, Message } from '../types';

export function GameProvider({ children }: { children: React.ReactNode }) {

    // ── 狀態 ──────────────────────────────────────────────────────────────
    const [session, setSession] = useState<ClientSession | null>(null);
    const [allSessions, setAllSessions] = useState<ClientSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [debugMode, setDebugMode] = useState(false);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

    /**
     * sessionRef：在 async callback 內安全讀取最新 session。
     * 直接讀 state 會有 stale closure 問題；透過 ref 可以拿到最新值。
     */
    const sessionRef = useRef<ClientSession | null>(null);
    useEffect(() => { sessionRef.current = session; }, [session]);

    /** 追蹤每個 phase 的真實開始時間（毫秒），用來計算虛擬時間標籤偏移量 */
    const phaseStartedAtRef = useRef<number>(Date.now());

    /** 回傳當前虛擬時間標籤（依 phaseStartedAt 和 session.virtualTime 計算） */
    const getVirtualTimeLabel = useCallback((): string => {
        const vt = sessionRef.current?.virtualTime ?? '09:00';
        return computeVirtualTimeLabel(vt, Date.now() - phaseStartedAtRef.current);
    }, []);

    /** activeChatId ref，供 useEffect 內非同步存取 */
    const activeChatIdRef = useRef<string | null>(null);
    useEffect(() => { activeChatIdRef.current = activeChatId; }, [activeChatId]);

    /** 追蹤上次 session.messages.length，用來偵測新訊息 */
    const prevMsgCountRef = useRef<number>(0);
    useEffect(() => {
        if (!session) return;
        const msgs = session.messages;
        if (msgs.length <= prevMsgCountRef.current) {
            prevMsgCountRef.current = msgs.length;
            return;
        }
        const newMsgs = msgs.slice(prevMsgCountRef.current);
        prevMsgCountRef.current = msgs.length;

        const increments: Record<string, number> = {};
        newMsgs.forEach(m => {
            if (m.senderType === 'character' && m.chatId !== activeChatIdRef.current) {
                increments[m.chatId] = (increments[m.chatId] || 0) + 1;
            }
        });
        if (Object.keys(increments).length > 0) {
            setUnreadCounts(prev => {
                const next = { ...prev };
                Object.entries(increments).forEach(([chatId, count]) => {
                    next[chatId] = (next[chatId] || 0) + count;
                });
                return next;
            });
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.messages.length]);

    // ── Session CRUD ───────────────────────────────────────────────────────

    const createSession = useCallback((): string => {
        const newSession = initializeNewSession();
        setAllSessions(prev => [newSession, ...prev]);
        LocalSessionAdapter.saveSession(newSession);
        LocalSessionAdapter.setLastActiveSessionId(newSession.id);
        return newSession.id;
    }, []);

    const loadSession = useCallback((sessionId: string) => {
        const s = LocalSessionAdapter.loadSession(sessionId);
        if (s) {
            phaseStartedAtRef.current = Date.now();
            setSession(s);
            LocalSessionAdapter.setLastActiveSessionId(sessionId);
            // 預設選取第一個角色的 DM
            const firstCharId = Object.keys(characters)[0];
            if (firstCharId) setActiveChatId(firstCharId);

            // 全新 session（無任何訊息）→ 觸發 phase-start，讓角色主動開場
            if (s.messages.length === 0) {
                const phaseStart = Date.now();
                fetch('/api/event/phase-start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phaseId: s.currentPhaseId,
                        characterStates: s.characterStates,
                        chatHistories: {}
                    })
                }).then(res => res.json()).then(data => {
                    if (Array.isArray(data.messages)) {
                        data.messages.forEach((msg: { characterId: string; chatId: string; content: string; expressionKey?: string }, index: number) => {
                            const delay = 1500 + index * 2000;
                            setTimeout(() => {
                                const vtLabel = computeVirtualTimeLabel(s.virtualTime, Date.now() - phaseStart);
                                setSession(prev => prev ? {
                                    ...prev,
                                    messages: [...prev.messages, {
                                        id: `init_${Date.now()}_${index}`,
                                        chatId: msg.chatId,
                                        senderType: 'character',
                                        senderId: msg.characterId,
                                        content: msg.content,
                                        expressionKey: msg.expressionKey,
                                        virtualTimeLabel: vtLabel,
                                        createdAt: new Date()
                                    }]
                                } : null);
                            }, delay);
                        });
                    }
                }).catch(e => console.error('[Phase] Initial phase-start failed', e));
            }
        } else {
            setSession(null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const deleteSession = useCallback((sessionId: string) => {
        LocalSessionAdapter.deleteSession(sessionId);
        setAllSessions(prev => prev.filter(s => s.id !== sessionId));
    }, []);

    // 啟動時載入 session 列表（不自動載入任何 session，由頁面決定）
    useEffect(() => {
        setAllSessions(LocalSessionAdapter.listSessions());
        setIsLoading(false);
    }, []);

    // session 變動時持久化到 LocalStorage，並同步更新列表
    useEffect(() => {
        if (!session) return;
        LocalSessionAdapter.saveSession(session);
        setAllSessions(prev => {
            const idx = prev.findIndex(s => s.id === session.id);
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = session;
                return updated;
            }
            return [...prev, session];
        });
    }, [session]);

    // ── Nudge Engine ───────────────────────────────────────────────────────
    //
    // useVirtualTime 只負責 nudge 計時器。
    // 角色回應延遲改用 t_delay 模式（見 sendMessage）。

    const {
        scheduleNudge: vtScheduleNudge,
        cancelNudge: vtCancelNudge,
    } = useVirtualTime({
        enabled: !!session && session.status === 'active',

        onNudge: async (characterId, chatId) => {
            const cur = sessionRef.current;
            if (!cur) return;

            const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
            try {
                const res = await fetch('/api/event/nudge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        characterId,
                        chatId,
                        chatHistory: cur.messages.filter(m => m.chatId === chatId).slice(-10),
                        characterState: cur.characterStates[characterId],
                        phaseGoal: currentPhase?.characterMissions
                            .find(m => m.characterId === characterId)?.goal || '',
                        nudgeCount: 1
                    })
                });
                const data = await res.json();
                if (data.content) {
                    const vtLabel = getVirtualTimeLabel();
                    setSession(prev => prev ? {
                        ...prev,
                        messages: [...prev.messages, {
                            id: generateId(),
                            chatId,
                            senderType: 'character',
                            senderId: characterId,
                            content: data.content,
                            expressionKey: 'neutral',
                            virtualTimeLabel: vtLabel,
                            createdAt: new Date()
                        }]
                    } : null);
                }
            } catch (e) {
                console.error('[Nudge] Error', e);
            }
        },
    });

    // ── Message Sending ────────────────────────────────────────────────────
    //
    // t_delay 模式：
    //   1. 立即插入玩家訊息
    //   2. 立即打 API（不等 t_delay 再打）
    //   3. API 完成後：remaining = max(0, t_delay - elapsed)
    //   4. setTimeout(remaining)：標記已讀 + 顯示角色訊息

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

        // ── DM ──────────────────────────────────────────────────────────────
        const char = characters[chatId];
        if (char) {
            vtCancelNudge(chatId);

            const charState = cur.characterStates[chatId];
            const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
            const mission = currentPhase?.characterMissions.find(m => m.characterId === chatId);
            const tDelay = (mission?.responseDelaySeconds ?? 3) * 1000;

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
                    location: 'dm'
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
            return;
        }

        // ── 群組 ────────────────────────────────────────────────────────────
        const group = groups.find(g => g.id === chatId);
        if (group) {
            const groupHistory = cur.messages.filter(m => m.chatId === chatId).slice(-15);

            group.members.forEach(memberId => {
                const memberChar = characters[memberId];
                const memberState = cur.characterStates[memberId];
                if (!memberChar || !memberState) return;
                if (!shouldRespond(memberChar, memberState.pad.a)) return;

                const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
                const mission = currentPhase?.characterMissions.find(m => m.characterId === memberId);
                const tDelay = (mission?.responseDelaySeconds ?? 5) * 1000;

                // 綜合群組歷史 + 該角色的 DM 歷史
                const memberDmHistory = cur.messages.filter(m => m.chatId === memberId).slice(-10);
                const combinedHistory: Message[] = [
                    ...groupHistory,
                    ...memberDmHistory,
                    { id: 'temp', chatId, senderType: 'player' as const, senderId: 'player', content, createdAt: new Date() }
                ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

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
    }, [vtCancelNudge, vtScheduleNudge]);

    // ── Phase Management ───────────────────────────────────────────────────

    const advancePhase = useCallback(async () => {
        const cur = sessionRef.current;
        if (!cur) return;

        const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
        if (!currentPhase) return;

        const nextPhaseId = determineNextPhase(currentPhase, storyPlot.phases, cur.characterStates);
        if (!nextPhaseId) {
            console.log('[Phase] 無法推進：故事結束或條件未達成');
            return;
        }

        const nextPhase = storyPlot.phases.find(p => p.id === nextPhaseId);
        if (!nextPhase) return;

        const isEnding = nextPhase.id.startsWith('ending');
        // Reset phase timer before updating session so virtualTime is correct
        phaseStartedAtRef.current = Date.now();
        setSession(prev => prev ? {
            ...prev,
            currentPhaseId: nextPhase.id,
            progressLabel: nextPhase.progressLabel,
            virtualTime: nextPhase.virtualTime,
            status: isEnding ? 'completed' : prev.status
        } : null);

        try {
            const phaseStart = Date.now();
            const res = await fetch('/api/event/phase-start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phaseId: nextPhase.id,
                    characterStates: cur.characterStates,
                    chatHistories: {}
                })
            });
            if (!res.ok) throw new Error(`phase-start API error ${res.status}`);
            const data = await res.json();

            if (Array.isArray(data.messages)) {
                data.messages.forEach((msg: any, index: number) => {
                    const delay = 1000 + index * 1500 + Math.random() * 1000;
                    setTimeout(() => {
                        const vtLabel = computeVirtualTimeLabel(nextPhase.virtualTime, Date.now() - phaseStart);
                        setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: `phase_${Date.now()}_${index}`,
                                chatId: msg.chatId,
                                senderType: 'character',
                                senderId: msg.characterId,
                                content: msg.content,
                                expressionKey: msg.expressionKey,
                                virtualTimeLabel: vtLabel,
                                createdAt: new Date()
                            }]
                        } : null);
                    }, delay);
                });
            }
        } catch (e) {
            console.error('[Phase] phase-start 觸發失敗', e);
        }
    }, []);

    const debugFastForward = useCallback(() => { advancePhase(); }, [advancePhase]);

    const getCurrentPhase = useCallback(() => {
        if (!session) return undefined;
        return storyPlot.phases.find(p => p.id === session.currentPhaseId);
    }, [session]);

    const toggleDebugMode = useCallback(() => setDebugMode(p => !p), []);

    const getCharacterName = useCallback((characterId: string): string | null => {
        return characters[characterId]?.profile.name ?? null;
    }, []);

    // ── Derived State ──────────────────────────────────────────────────────

    const chatRooms = useMemo(() => {
        const rooms = getChatRooms(session);
        return rooms.map(r => ({ ...r, unreadCount: unreadCounts[r.id] ?? 0 }));
    }, [session, unreadCounts]);

    const gameState = useMemo(() => {
        if (!session) return null;
        const currentPhase = storyPlot.phases.find(p => p.id === session.currentPhaseId);
        return {
            session,
            story: storyPlot,
            characters,
            characterMissions: allCharacterMissions,
            groups,
            chatRooms,
            activeChatId,
            isLoading,
            canFastForward: currentPhase
                ? areAllGoalsAchieved(currentPhase, session.characterStates)
                : false,
            pendingEvents: [],
            debugMode
        };
    }, [session, chatRooms, activeChatId, isLoading, debugMode]);

    // ── Context Value ──────────────────────────────────────────────────────

    return (
        <GameContext.Provider value={{
            session,
            gameState,
            sessions: allSessions,
            isLoading,
            activeChatId,
            chatRooms,
            debugMode,
            sendMessage,
            createSession,
            loadSession,
            deleteSession,
            setActiveChat: (chatId: string | null) => {
                setActiveChatId(chatId);
                if (chatId) setUnreadCounts(prev => ({ ...prev, [chatId]: 0 }));
            },
            debugFastForward,
            getCurrentPhase,
            advancePhase,
            toggleDebugMode,
            getCharacterName,
        }}>
            {children}
        </GameContext.Provider>
    );
}
