'use client';

/**
 * provider.tsx — GameProvider
 *
 * 組裝子模組，提供完整的 React Context Provider。
 * 重邏輯已抽至獨立 hook，此檔案只負責：
 *
 *  1. 狀態宣告 / shared refs
 *  2. Session CRUD（create / load / delete + phase-start on new game）
 *  3. Nudge Engine（useVirtualTime + onNudge callback）
 *  4. 組合 useSendMessage / usePhaseManager
 *  5. Derived state（chatRooms、gameState、unreadCounts）
 *  6. Context.Provider return
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
import { useSendMessage } from './use-send-message';
import { usePhaseManager } from './use-phase-manager';

import { LocalSessionAdapter } from '../storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from '../story-data';
import { areAllGoalsAchieved } from '../engine/phase';
import { useVirtualTime } from '@/hooks/useVirtualTime';

import type { ClientSession } from '../types';

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

    /** 追蹤上次 session.messages.length，用來偵測新訊息並更新 unreadCounts */
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
                        data.messages.forEach((msg: {
                            characterId: string;
                            chatId: string;
                            content: string;
                            expressionKey?: string;
                        }, index: number) => {
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
    // 角色回應延遲改用 t_delay 模式（見 useSendMessage）。

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

    const sendMessage = useSendMessage({
        sessionRef,
        getVirtualTimeLabel,
        vtCancelNudge,
        vtScheduleNudge,
        setSession,
    });

    // ── Phase Management ───────────────────────────────────────────────────

    const { advancePhase } = usePhaseManager({
        sessionRef,
        phaseStartedAtRef,
        setSession,
    });

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
