'use client';

/**
 * provider.tsx — GameProvider
 *
 * 負責將所有子模組的邏輯組裝成一個完整的 React Context Provider：
 *
 *  1. Session CRUD        — 建立、載入、刪除遊戲進度（LocalStorage）
 *  2. Virtual Time Engine — 透過 useVirtualTime hook 管理所有排程事件
 *     · onCharacterResponse → 呼叫 /api/chat，寫入訊息 + 更新 PAD
 *     · onNudge             → 呼叫 /api/event/nudge，寫入催促訊息
 *  3. Schedule Wrappers   — 包裝 hook API，對外保持簡單的 (id, delayMs) 介面
 *  4. sendMessage         → DM 或群組訊息發送 + 觸發角色回應排程
 *  5. Phase Management    → advancePhase（評估 branch conditions + 呼叫 phase-start API）
 */

import React, {
    useEffect,
    useState,
    useCallback,
    useRef,
    useMemo
} from 'react';

import { GameContext } from './context';
import { generateId, initializeNewSession, getChatRooms } from './helpers';

import { LocalSessionAdapter } from '../storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from '../story-data';
import { areAllGoalsAchieved, determineNextPhase } from '../engine/phase';
import { useVirtualTime } from '@/hooks/useVirtualTime';

import type { ClientSession, Message } from '../types';

export function GameProvider({ children }: { children: React.ReactNode }) {

    // ── 狀態 ──────────────────────────────────────────────────────────────
    const [session, setSession] = useState<ClientSession | null>(null);
    const [allSessions, setAllSessions] = useState<ClientSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [debugMode, setDebugMode] = useState(false);

    /**
     * sessionRef：在 async callback 內安全讀取最新 session。
     * 直接讀 state 會有 stale closure 問題；透過 ref 可以拿到最新值。
     */
    const sessionRef = useRef<ClientSession | null>(null);
    useEffect(() => { sessionRef.current = session; }, [session]);

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
            setSession(s);
            LocalSessionAdapter.setLastActiveSessionId(sessionId);
            // 預設選取第一個角色的 DM
            const firstCharId = Object.keys(characters)[0];
            if (firstCharId) setActiveChatId(firstCharId);

            // 全新 session（無任何訊息）→ 觸發 phase-start，讓角色主動開場
            if (s.messages.length === 0) {
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
                            setTimeout(() => {
                                setSession(prev => prev ? {
                                    ...prev,
                                    messages: [...prev.messages, {
                                        id: `init_${Date.now()}_${index}`,
                                        chatId: msg.chatId,
                                        senderType: 'character',
                                        senderId: msg.characterId,
                                        content: msg.content,
                                        expressionKey: msg.expressionKey,
                                        createdAt: new Date()
                                    }]
                                } : null);
                            }, 1500 + index * 2000);
                        });
                    }
                }).catch(e => console.error('[Phase] Initial phase-start failed', e));
            }
        } else {
            setSession(null);
        }
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

    // ── Virtual Time Engine ────────────────────────────────────────────────
    //
    // useVirtualTime 負責所有計時排程（typing indicator、response delay、nudge）。
    // 這裡只需提供三個 callback，hook 會在適當時機呼叫它們：
    //   · onCharacterResponse：timer 到期，實際呼叫 LLM API 產生訊息
    //   · onNudge：玩家久未回應，呼叫 nudge API 催促
    //   · onTypingStart / onTypingEnd：hook 內部管理，外部不需操作

    const {
        scheduleDMResponse: vtScheduleDM,
        scheduleGroupResponses: vtScheduleGroup,
        scheduleNudge: vtScheduleNudge,
        cancelNudge: vtCancelNudge,
        typingStates
    } = useVirtualTime({
        enabled: !!session && session.status === 'active',

        onCharacterResponse: async (characterId, chatId) => {
            const cur = sessionRef.current;
            if (!cur) return;

            const charState = cur.characterStates[characterId];
            const character = characters[characterId];
            if (!charState || !character) return;

            // chatId 等於 characterId → DM；否則為群組
            const isDM = chatId === characterId;
            const chatHistory = cur.messages.filter(m => m.chatId === chatId).slice(-15);

            const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
            const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);

            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'respond',
                        characterId,
                        playerMessage: isDM
                            ? chatHistory.filter(m => m.senderType === 'player').slice(-1)[0]?.content
                            : undefined,
                        chatHistory,
                        currentPad: charState.pad,
                        memory: charState.memory || '',
                        phaseGoal: mission?.goal || '',
                        triggerDirection: isDM ? (mission?.triggerDirection || '') : '',
                        location: isDM ? 'dm' : 'group'
                    })
                });
                const data = await res.json();
                if (!data.content) return;

                setSession(prev => {
                    if (!prev) return null;
                    const newMsg: Message = {
                        id: generateId(),
                        chatId,
                        senderType: 'character',
                        senderId: characterId,
                        content: data.content,
                        expressionKey: data.expressionKey,
                        createdAt: new Date()
                    };
                    // DM 才更新 PAD（群組回應不含情緒分析）
                    if (isDM && data.padDelta) {
                        const old = prev.characterStates[characterId];
                        const d = data.padDelta;
                        return {
                            ...prev,
                            messages: [...prev.messages, newMsg],
                            characterStates: {
                                ...prev.characterStates,
                                [characterId]: {
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
                    return { ...prev, messages: [...prev.messages, newMsg] };
                });

                // DM 回應後啟動 nudge 計時（45 秒無回應則催促）
                if (isDM) vtScheduleNudge(characterId, chatId, 45);

            } catch (e) {
                console.error('[VirtualTime] onCharacterResponse error', e);
            }
        },

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
                        nudgeCount: 1 // TODO: 追蹤每角色的 nudge 次數
                    })
                });
                const data = await res.json();
                if (data.content) {
                    setSession(prev => prev ? {
                        ...prev,
                        messages: [...prev.messages, {
                            id: generateId(),
                            chatId,
                            senderType: 'character',
                            senderId: characterId,
                            content: data.content,
                            expressionKey: 'neutral',
                            createdAt: new Date()
                        }]
                    } : null);
                }
            } catch (e) {
                console.error('[Nudge] Error', e);
            }
        },

        onTypingStart: () => {}, // hook 已內部處理，外部不需操作
        onTypingEnd: () => {}
    });

    // ── Schedule Wrappers ──────────────────────────────────────────────────
    //
    // hook 的 API 需要完整的 Character 物件與秒數，
    // 這裡包裝成 (characterId, delayMs) 供其他元件使用。

    const scheduleDMResponse = useCallback((characterId: string, delayMs: number) => {
        const char = characters[characterId];
        if (!char) return;
        const arousal = sessionRef.current?.characterStates[characterId]?.pad.a ?? 0.3;
        vtScheduleDM(char, characterId, delayMs / 1000, arousal);
    }, [vtScheduleDM]);

    const scheduleGroupResponse = useCallback((groupId: string, characterId: string, delayMs: number) => {
        const char = characters[characterId];
        if (!char) return;
        const arousal = sessionRef.current?.characterStates[characterId]?.pad.a ?? 0.3;
        // vtScheduleGroup 內部會做 shouldRespond() 的機率判斷
        vtScheduleGroup(
            [char],
            groupId,
            { [characterId]: { pad: { a: arousal } } },
            { [characterId]: delayMs / 1000 }
        );
    }, [vtScheduleGroup]);

    // ── Message Sending ────────────────────────────────────────────────────

    const sendMessage = useCallback(async (
        chatId: string,
        content: string,
        type: 'text' | 'sticker' = 'text',
        stickerId?: string
    ) => {
        if (!chatId) return;

        // 立即（樂觀）寫入玩家訊息
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
                    createdAt: new Date()
                }],
                lastActiveAt: new Date()
            };
        });

        const cur = sessionRef.current;

        // DM：取消 nudge 計時，排程角色回應 + 背景分析
        const char = characters[chatId];
        if (char) {
            vtCancelNudge(chatId);
            const charState = cur?.characterStates[chatId];
            const arousal = charState?.pad.a ?? 0.3;
            // F1：排程角色回覆（由 useVirtualTime → onCharacterResponse 觸發）
            vtScheduleDM(char, chatId, 1.5, arousal);

            // F3 + F5 平行背景執行
            if (charState && cur) {
                const chatHistory = cur.messages.filter(m => m.chatId === chatId).slice(-15);
                const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
                const mission = currentPhase?.characterMissions.find(m => m.characterId === chatId);

                Promise.all([
                    // F3：分析 PAD delta
                    fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'analyze',
                            characterId: chatId,
                            playerMessage: content,
                            chatHistory,
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
                                chatHistory: [...chatHistory, {
                                    id: 'temp', chatId,
                                    senderType: 'player', senderId: 'player',
                                    content, createdAt: new Date()
                                }],
                                currentlyAchieved: charState.goalAchieved
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

        // 群組：對所有成員根據 Arousal 機率排程回應（hook 內部做 shouldRespond）
        const group = groups.find(g => g.id === chatId);
        if (group) {
            const members = group.members.map(id => characters[id]).filter(Boolean);
            const memberStates = group.members.reduce((acc, id) => {
                if (cur?.characterStates[id]) {
                    acc[id] = { pad: cur.characterStates[id].pad };
                }
                return acc;
            }, {} as Record<string, { pad: { a: number } }>);
            const baseDelays = group.members.reduce((acc, id) => {
                acc[id] = 2 + Math.random() * 3; // 每人 2–5 秒基礎延遲
                return acc;
            }, {} as Record<string, number>);
            vtScheduleGroup(members, chatId, memberStates, baseDelays);
        }
    }, [vtScheduleDM, vtScheduleGroup, vtCancelNudge]);

    // ── Phase Management ───────────────────────────────────────────────────

    const advancePhase = useCallback(async () => {
        const cur = sessionRef.current;
        if (!cur) return;

        const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
        if (!currentPhase) return;

        // 依 branch conditions 決定下一個 phase
        const nextPhaseId = determineNextPhase(currentPhase, storyPlot.phases, cur.characterStates);
        if (!nextPhaseId) {
            console.log('[Phase] 無法推進：故事結束或條件未達成');
            return;
        }

        const nextPhase = storyPlot.phases.find(p => p.id === nextPhaseId);
        if (!nextPhase) return;

        // 1. 更新 session 的 phase 資訊；ending phase 時標記故事結束
        const isEnding = nextPhase.id.startsWith('ending');
        setSession(prev => prev ? {
            ...prev,
            currentPhaseId: nextPhase.id,
            progressLabel: nextPhase.progressLabel,
            virtualTime: nextPhase.virtualTime,
            status: isEnding ? 'completed' : prev.status
        } : null);

        // 2. 呼叫 phase-start API 觸發角色主動開場訊息
        try {
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
                    // 每則訊息間隔 1.5 秒，加上隨機抖動，模擬自然感
                    const delay = 1000 + index * 1500 + Math.random() * 1000;
                    setTimeout(() => {
                        setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: `phase_${Date.now()}_${index}`,
                                chatId: msg.chatId,
                                senderType: 'character',
                                senderId: msg.characterId,
                                content: msg.content,
                                expressionKey: msg.expressionKey,
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

    const getTypingCharacters = useCallback((chatId: string): string[] => {
        return typingStates.filter(t => t.chatId === chatId).map(t => t.characterId);
    }, [typingStates]);

    // ── Derived State ──────────────────────────────────────────────────────

    const chatRooms = useMemo(() => getChatRooms(session), [session]);

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
            typingStates,
            pendingEvents: [],
            debugMode
        };
    }, [session, chatRooms, activeChatId, isLoading, typingStates, debugMode]);

    // ── Context Value ──────────────────────────────────────────────────────

    return (
        <GameContext.Provider value={{
            session,
            gameState,
            sessions: allSessions,
            isLoading,
            activeChatId,
            chatRooms,
            typingStates,
            debugMode,
            sendMessage,
            createSession,
            loadSession,
            deleteSession,
            setActiveChat: setActiveChatId,
            debugFastForward,
            scheduleDMResponse,
            scheduleGroupResponse,
            getCurrentPhase,
            advancePhase,
            toggleDebugMode,
            getCharacterName,
            getTypingCharacters
        }}>
            {children}
        </GameContext.Provider>
    );
}
