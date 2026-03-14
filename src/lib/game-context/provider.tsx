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
import { generateId, initializeNewSession, getChatRooms, computeVirtualTimeLabel, virtualTimeToRealMs, getPhaseCapVirtualTime } from './helpers';
import { useSendMessage } from './use-send-message';
import { usePhaseManager } from './use-phase-manager';
import { NudgeCounter } from '@/lib/nudge/counter';

import { LocalSessionAdapter } from '../storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from '../story-data';
import { areAllGoalsAchieved } from '../engine/phase';
import { useVirtualTime } from '@/hooks/useVirtualTime';

import type { ClientSession } from '../types';

/**
 * 初始 phase-start 去重：避免 dev 模式下 mount/effect 重跑造成重複 POST。
 */
const initialPhaseStartDedupRef = new Map<string, number>();
const INITIAL_PHASE_START_DEDUP_MS = 5000;

export function GameProvider({ children }: { children: React.ReactNode }) {

    // ── 狀態 ──────────────────────────────────────────────────────────────
    const [session, setSession] = useState<ClientSession | null>(null);
    const [allSessions, setAllSessions] = useState<ClientSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [debugMode, setDebugMode] = useState(false);
    const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
    /** Reactive counterpart of phaseStartedAtRef — triggers re-render for TimeBar phase timer */
    const [phaseStartedAt, setPhaseStartedAt] = useState<number>(() => Date.now());

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

    /** 追蹤每個 chatId 的 nudge 次數，供 nudge 升壓邏輯使用 */
    const nudgeCounterRef = useRef(new NudgeCounter());

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
            const now = Date.now();
            phaseStartedAtRef.current = now;
            setPhaseStartedAt(now);
            setSession(s);
            LocalSessionAdapter.setLastActiveSessionId(sessionId);
            // 預設選取第一個角色的 DM
            const firstCharId = Object.keys(characters)[0];
            if (firstCharId) setActiveChatId(firstCharId);

            // 全新 session（無任何訊息）→ 觸發 phase-start，讓角色主動開場
            if (s.messages.length === 0) {
                const dedupKey = `${sessionId}:${s.currentPhaseId}`;
                const nowTs = Date.now();
                const lastTriggerAt = initialPhaseStartDedupRef.get(dedupKey);
                if (lastTriggerAt && nowTs - lastTriggerAt < INITIAL_PHASE_START_DEDUP_MS) {
                    return;
                }
                initialPhaseStartDedupRef.set(dedupKey, nowTs);

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

    // ── Phase Virtual Time Enforcement ────────────────────────────────────
    //
    // 虛擬時鐘到達下一個 phase 的起始虛擬時間時，自動呼叫 advancePhase()。
    // 速率：VIRTUAL_TIME_RATIO_MS ms 真實時間 = 1 虛擬分鐘

    const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // 清除前一個計時器
        if (phaseTimeoutRef.current !== null) {
            clearTimeout(phaseTimeoutRef.current);
            phaseTimeoutRef.current = null;
        }

        // 只在 active session 時啟動
        if (!session || session.status !== 'active') return;

        const currentPhase = storyPlot.phases.find(p => p.id === session.currentPhaseId);
        if (!currentPhase) return;

        const capVirtualTime = getPhaseCapVirtualTime(currentPhase, storyPlot.phases);
        if (!capVirtualTime) return; // ending phase，無 branch

        const totalMs = virtualTimeToRealMs(currentPhase.virtualTime, capVirtualTime);
        if (totalMs <= 0) return;
        const elapsed = Date.now() - phaseStartedAtRef.current;
        const remaining = Math.max(0, totalMs - elapsed);

        phaseTimeoutRef.current = setTimeout(() => {
            phaseTimeoutRef.current = null;
            advancePhase();
        }, remaining);

        return () => {
            if (phaseTimeoutRef.current !== null) {
                clearTimeout(phaseTimeoutRef.current);
                phaseTimeoutRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.currentPhaseId, session?.status]);

    // ── Nudge Engine ───────────────────────────────────────────────────────
    //
    // useVirtualTime 只負責 nudge 計時器。
    // 角色回應延遲改用 t_delay 模式（見 useSendMessage）。

    /**
     * autonomousCheckerRef：跨 hook 傳遞 useSendMessage 的自主檢查方法。
     * 在 useVirtualTime 定義之後、useSendMessage 初始化之後才寫入。
     * onNudge 透過 ref 拿到最新值（非同步呼叫，一定在賦值後才執行）。
     */
    const autonomousCheckerRef = useRef<{
        start: (characterId: string) => { seq: number; signal: AbortSignal };
        isLatest: (characterId: string, seq: number) => boolean;
    } | null>(null);

    /**
     * scheduleCheckRef：供 onNudge 重新排程自主檢查（避免循環依賴）。
     * 在 useVirtualTime 返回後立即填入 vtScheduleNudge。
     */
    const scheduleCheckRef = useRef<((characterId: string, chatId: string, delay: number) => void) | null>(null);

    const {
        scheduleNudge: vtScheduleNudge,
        cancelNudge: vtCancelNudge,
    } = useVirtualTime({
        enabled: !!session && session.status === 'active',

        onNudge: async (characterId, chatId) => {
            const cur = sessionRef.current;
            if (!cur) return;

            const charState = cur.characterStates[characterId];
            if (charState?.goalAchieved) return;

            // ── 機率門檻：以 PAD.a 決定是否觸發 LLM 檢查 ──────────────────
            // a=1.0 → 必定觸發；a=0.3 → 30% 機率；a=0 → 永不觸發
            const arousal = charState?.pad.a ?? 0.5;
            if (Math.random() > arousal) {
                // 機率未通過：靜默跳過，重新排程下一次檢查
                scheduleCheckRef.current?.(characterId, chatId, 15);
                return;
            }

            const checker = autonomousCheckerRef.current;
            if (!checker) return;

            // ── 建立本次自主檢查序號與 AbortSignal ────────────────────────
            const { seq, signal } = checker.start(characterId);

            const currentPhase = storyPlot.phases.find(p => p.id === cur.currentPhaseId);
            const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);

            const dmHistory = cur.messages.filter(m => m.chatId === characterId).slice(-10);
            const groupHistories = groups
                .filter(g => g.members.includes(characterId))
                .map(g => ({
                    groupId: g.id,
                    groupName: g.name,
                    messages: cur.messages.filter(m => m.chatId === g.id).slice(-10),
                }));

            try {
                const res = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal,
                    body: JSON.stringify({
                        action: 'autonomousMessage',
                        characterId,
                        currentPad: charState?.pad || { p: 0, a: 0.5, d: 0 },
                        memory: charState?.memory || '',
                        phaseGoal: mission?.goal || '',
                        dmHistory,
                        groupHistories,
                    })
                });

                if (!checker.isLatest(characterId, seq)) return;

                if (!res.ok) {
                    console.error(`[Autonomous] API failed ${res.status}`);
                } else {
                    const data = await res.json();
                    if (!checker.isLatest(characterId, seq)) return;

                    if (data.shouldSend && data.content) {
                        const vtLabel = getVirtualTimeLabel();
                        setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: generateId(),
                                chatId: data.targetChatId,
                                senderType: 'character' as const,
                                senderId: characterId,
                                content: data.content,
                                expressionKey: data.expressionKey || 'neutral',
                                virtualTimeLabel: vtLabel,
                                createdAt: new Date()
                            }]
                        } : null);
                    }
                }
            } catch (e) {
                if ((e as Error)?.name === 'AbortError') return;
                console.error('[Autonomous] Error', e);
            }

            // ── 重新排程下一次自主檢查（目標未達成時繼續每 15 秒檢查）──────
            if (!sessionRef.current?.characterStates[characterId]?.goalAchieved) {
                scheduleCheckRef.current?.(characterId, chatId, 15);
            }
        },
    });

    // 填入 scheduleCheckRef（onNudge 透過此 ref 重新排程，避免循環依賴）
    scheduleCheckRef.current = vtScheduleNudge;

    // ── Message Sending ────────────────────────────────────────────────────

    const { sendMessage, startAutonomousCheck, isLatestAutonomousCheck } = useSendMessage({
        sessionRef,
        getVirtualTimeLabel,
        vtCancelNudge,
        vtScheduleNudge,
        setSession,
        resetNudgeCount: (chatId) => { nudgeCounterRef.current.reset(chatId); },
    });

    // 填入 autonomousCheckerRef（onNudge 透過此 ref 管理自主檢查序號）
    autonomousCheckerRef.current = { start: startAutonomousCheck, isLatest: isLatestAutonomousCheck };

    // ── Phase Management ───────────────────────────────────────────────────

    const { advancePhase } = usePhaseManager({
        sessionRef,
        phaseStartedAtRef,
        setSession,
        setPhaseStartedAt,
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
            phaseStartedAt,
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
