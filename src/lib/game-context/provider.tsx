'use client';

/**
 * provider.tsx — GameProvider
 *
 * 組裝子模組，提供完整的 React Context Provider。
 * 重邏輯已抽至獨立 hook，此檔案只負責：
 *
 *  1. 狀態宣告 / shared refs
 *  2. Session CRUD（create / load / delete + phase-start on new game）
 *  3. Autonomous Engine（provider-local real-time state machine）
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

import { LocalSessionAdapter } from '../storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from '../story-data';
import { areAllGoalsAchieved } from '../engine/phase';

import type { ClientSession } from '../types';

/**
 * 初始 phase-start 去重：避免 dev 模式下 mount/effect 重跑造成重複 POST。
 */
const initialPhaseStartDedupRef = new Map<string, number>();
const INITIAL_PHASE_START_DEDUP_MS = 5000;
const AUTONOMOUS_CHECK_INTERVAL_MS = 15000;
const AUTONOMOUS_PROMPT_DELAY_MS = 60000;
const AUTONOMOUS_MAX_PROMPTS = 2;
const AUTONOMOUS_TRIGGER_BONUS = 0.4;
const AUTONOMOUS_DEBUG_LOG = true;

function logAutonomy(event: string, payload?: Record<string, unknown>) {
    if (!AUTONOMOUS_DEBUG_LOG) return;
    if (payload) {
        console.log(`[Autonomy] ${event}`, payload);
        return;
    }
    console.log(`[Autonomy] ${event}`);
}

interface CharacterAutonomyState {
    mode: 'idle' | 'checking' | 'waiting-update';
    inFlight: boolean;
    activeSeq: number | null;
    nextCheckAt: number | null;
    lastCheckedAt: number | null;
    waitingSince: number | null;
    promptCount: number;
    contextKey: string;
    lastContextUpdateAt: number | null;
}

function createAutonomyState(contextKey = ''): CharacterAutonomyState {
    return {
        mode: 'idle',
        inFlight: false,
        activeSeq: null,
        nextCheckAt: null,
        lastCheckedAt: null,
        waitingSince: null,
        promptCount: 0,
        contextKey,
        lastContextUpdateAt: null,
    };
}

export function GameProvider({ children }: { children: React.ReactNode }) {

    // ── 狀態 ──────────────────────────────────────────────────────────────
    const [session, setSession] = useState<ClientSession | null>(null);
    const [allSessions, setAllSessions] = useState<ClientSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [debugMode, setDebugMode] = useState(false);
    const [autonomyModes, setAutonomyModes] = useState<Record<string, CharacterAutonomyState['mode']>>({});
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

    /** 每個角色的自主發訊狀態機 */
    const autonomyStateRef = useRef<Record<string, CharacterAutonomyState>>({});
    useEffect(() => {
        autonomyStateRef.current = {};
        const nextModes: Record<string, CharacterAutonomyState['mode']> = {};
        Object.keys(session?.characterStates ?? {}).forEach(characterId => {
            nextModes[characterId] = 'idle';
        });
        setAutonomyModes(nextModes);
    }, [session?.id]);

    const setAutonomyMode = useCallback((characterId: string, state: CharacterAutonomyState, mode: CharacterAutonomyState['mode']) => {
        if (state.mode !== mode) {
            state.mode = mode;
        }
        setAutonomyModes(prev => (prev[characterId] === mode ? prev : { ...prev, [characterId]: mode }));
    }, []);

    const autonomyPrevMsgCountRef = useRef<number>(0);
    useEffect(() => {
        autonomyPrevMsgCountRef.current = session?.messages.length ?? 0;
    }, [session?.id]);

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

    // ── Autonomous Engine ──────────────────────────────────────────────────

    /**
     * autonomousControlRef：跨 hook 傳遞 useSendMessage 的最新請求控制方法。
     */
    const autonomousControlRef = useRef<{
        start: (characterId: string) => { seq: number; signal: AbortSignal };
        isLatest: (characterId: string, seq: number) => boolean;
        cancel: (characterId: string) => void;
    } | null>(null);

    const isRelevantExternalMessage = useCallback((characterId: string, message: ClientSession['messages'][number]) => {
        if (message.senderId === characterId) return false;
        if (message.chatId === characterId) return true;
        return groups.some(group => group.id === message.chatId && group.members.includes(characterId));
    }, []);

    const getContextKey = useCallback((cur: ClientSession, characterId: string): string => {
        const relevant = cur.messages.filter(message => isRelevantExternalMessage(characterId, message));
        const lastMessage = relevant[relevant.length - 1];
        return `${relevant.length}:${lastMessage?.id ?? 'none'}`;
    }, [isRelevantExternalMessage]);

    const getAutonomyState = useCallback((characterId: string, cur?: ClientSession | null) => {
        const existing = autonomyStateRef.current[characterId];
        if (existing) return existing;

        const next = createAutonomyState(cur ? getContextKey(cur, characterId) : '');
        autonomyStateRef.current[characterId] = next;
        return next;
    }, [getContextKey]);

    const vtScheduleNudge = useCallback((characterId: string, _chatId: string, delaySeconds: number) => {
        const cur = sessionRef.current;
        if (!cur || cur.status !== 'active') return;

        const state = getAutonomyState(characterId, cur);
        setAutonomyMode(characterId, state, 'checking');
        state.inFlight = false;
        state.activeSeq = null;
        state.nextCheckAt = Date.now() + delaySeconds * 1000;
        state.waitingSince = null;
        state.contextKey = getContextKey(cur, characterId);
        logAutonomy('nudge_scheduled', {
            characterId,
            delaySeconds,
            nextCheckAt: state.nextCheckAt,
        });
    }, [getAutonomyState, getContextKey, sessionRef, setAutonomyMode]);

    const vtCancelNudge = useCallback((characterId: string) => {
        autonomousControlRef.current?.cancel(characterId);

        const state = autonomyStateRef.current[characterId];
        if (!state) return;

        setAutonomyMode(characterId, state, 'idle');
        state.inFlight = false;
        state.activeSeq = null;
        state.nextCheckAt = null;
        state.waitingSince = null;
        logAutonomy('nudge_cancelled', { characterId });
    }, [setAutonomyMode]);

    const appendAutonomousMessage = useCallback((characterId: string, targetChatId: string, content: string, expressionKey?: string) => {
        const vtLabel = getVirtualTimeLabel();
        setSession(prev => prev ? {
            ...prev,
            messages: [...prev.messages, {
                id: generateId(),
                chatId: targetChatId,
                senderType: 'character' as const,
                senderId: characterId,
                content,
                expressionKey: expressionKey || 'neutral',
                virtualTimeLabel: vtLabel,
                createdAt: new Date()
            }]
        } : null);
    }, [getVirtualTimeLabel]);

    const runAutonomousCheck = useCallback(async (characterId: string) => {
        logAutonomy('check_started', { characterId });
        const cur = sessionRef.current;
        if (!cur || cur.status !== 'active') return;

        const charState = cur.characterStates[characterId];
        if (!charState || charState.goalAchieved) {
            vtCancelNudge(characterId);
            return;
        }

        const state = getAutonomyState(characterId, cur);
        if (state.mode !== 'checking' || state.inFlight) return;

        state.lastCheckedAt = Date.now();

        const arousal = charState.pad.a ?? 0.5;
        const triggerChance = Math.min(1, Math.max(0, arousal + AUTONOMOUS_TRIGGER_BONUS));
        const roll = Math.random();
        logAutonomy('check_roll', { characterId, arousal, triggerChance, roll });
        if (roll > triggerChance) {
            logAutonomy('check_skipped_by_roll', { characterId, triggerChance, roll });
            state.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
            return;
        }

        const control = autonomousControlRef.current;
        if (!control) {
            state.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
            return;
        }

        const { seq, signal } = control.start(characterId);
        state.inFlight = true;
        state.activeSeq = seq;

        const currentPhase = storyPlot.phases.find(phase => phase.id === cur.currentPhaseId);
        const mission = currentPhase?.characterMissions.find(item => item.characterId === characterId);
        const dmHistory = cur.messages.filter(message => message.chatId === characterId).slice(-10);
        const groupHistories = groups
            .filter(group => group.members.includes(characterId))
            .map(group => ({
                groupId: group.id,
                groupName: group.name,
                messages: cur.messages.filter(message => message.chatId === group.id).slice(-10),
            }));

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({
                    action: 'autonomousMessage',
                    characterId,
                    currentPad: charState.pad,
                    memory: charState.memory || '',
                    phaseGoal: mission?.goal || '',
                    dmHistory,
                    groupHistories,
                })
            });

            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq || !control.isLatest(characterId, seq)) return;

            if (!res.ok) {
                console.error(`[Autonomous] API failed ${res.status}`);
                logAutonomy('check_api_failed', { characterId, status: res.status });
                setAutonomyMode(characterId, latestState, 'checking');
                latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
                return;
            }

            const data = await res.json();
            if (latestState.activeSeq !== seq || !control.isLatest(characterId, seq)) return;

            if (data.shouldSend && data.content) {
                appendAutonomousMessage(characterId, data.targetChatId, data.content, data.expressionKey);
                logAutonomy('message_sent', {
                    characterId,
                    targetChatId: data.targetChatId,
                    expressionKey: data.expressionKey,
                });
                setAutonomyMode(characterId, latestState, 'checking');
                latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
                latestState.waitingSince = null;
            } else {
                logAutonomy('waiting_for_update', { characterId });
                setAutonomyMode(characterId, latestState, 'waiting-update');
                latestState.nextCheckAt = null;
                latestState.waitingSince = Date.now();
            }
        } catch (e) {
            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq) return;
            if ((e as Error)?.name !== 'AbortError') {
                console.error('[Autonomous] Error', e);
                logAutonomy('check_error', {
                    characterId,
                    error: (e as Error)?.message ?? 'unknown',
                });
                if (latestState.mode === 'checking') {
                    latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
                }
            }
        } finally {
            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq) return;
            latestState.inFlight = false;
            latestState.activeSeq = null;
            logAutonomy('check_finished', { characterId });
        }
    }, [appendAutonomousMessage, getAutonomyState, sessionRef, setAutonomyMode, vtCancelNudge]);

    const sendAutonomousPrompt = useCallback(async (characterId: string) => {
        const cur = sessionRef.current;
        if (!cur || cur.status !== 'active') return;

        const charState = cur.characterStates[characterId];
        if (!charState || charState.goalAchieved) {
            vtCancelNudge(characterId);
            return;
        }

        const state = getAutonomyState(characterId, cur);
        if (state.mode !== 'waiting-update' || state.inFlight || state.promptCount >= AUTONOMOUS_MAX_PROMPTS) return;

        const control = autonomousControlRef.current;
        if (!control) return;

        const { seq, signal } = control.start(characterId);
        state.inFlight = true;
        state.activeSeq = seq;
        logAutonomy('prompt_started', {
            characterId,
            promptLevel: state.promptCount + 1,
        });

        const currentPhase = storyPlot.phases.find(phase => phase.id === cur.currentPhaseId);
        const mission = currentPhase?.characterMissions.find(item => item.characterId === characterId);
        const dmHistory = cur.messages.filter(message => message.chatId === characterId).slice(-10);
        const groupHistories = groups
            .filter(group => group.members.includes(characterId))
            .map(group => ({
                groupId: group.id,
                groupName: group.name,
                messages: cur.messages.filter(message => message.chatId === group.id).slice(-10),
            }));

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal,
                body: JSON.stringify({
                    action: 'autonomousPrompt',
                    characterId,
                    currentPad: charState.pad,
                    memory: charState.memory || '',
                    phaseGoal: mission?.goal || '',
                    promptLevel: (state.promptCount + 1) as 1 | 2,
                    dmHistory,
                    groupHistories,
                })
            });

            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq || !control.isLatest(characterId, seq)) return;

            if (!res.ok) {
                console.error(`[AutonomousPrompt] API failed ${res.status}`);
                logAutonomy('prompt_api_failed', { characterId, status: res.status });
                setAutonomyMode(characterId, latestState, 'checking');
                latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
                latestState.waitingSince = null;
                return;
            }

            const data = await res.json();
            if (latestState.activeSeq !== seq || !control.isLatest(characterId, seq)) return;

            if (data.content) {
                appendAutonomousMessage(characterId, data.targetChatId, data.content, data.expressionKey);
                latestState.promptCount += 1;
                logAutonomy('prompt_sent', {
                    characterId,
                    targetChatId: data.targetChatId,
                    promptCount: latestState.promptCount,
                });
            }

            setAutonomyMode(characterId, latestState, 'checking');
            latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
            latestState.waitingSince = null;
        } catch (e) {
            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq) return;
            if ((e as Error)?.name !== 'AbortError') {
                console.error('[AutonomousPrompt] Error', e);
                logAutonomy('prompt_error', {
                    characterId,
                    error: (e as Error)?.message ?? 'unknown',
                });
                setAutonomyMode(characterId, latestState, 'checking');
                latestState.nextCheckAt = Date.now() + AUTONOMOUS_CHECK_INTERVAL_MS;
                latestState.waitingSince = null;
            }
        } finally {
            const latestState = autonomyStateRef.current[characterId];
            if (!latestState || latestState.activeSeq !== seq) return;
            latestState.inFlight = false;
            latestState.activeSeq = null;
            logAutonomy('prompt_finished', { characterId });
        }
    }, [appendAutonomousMessage, getAutonomyState, sessionRef, setAutonomyMode, vtCancelNudge]);

    useEffect(() => {
        if (!session) return;

        const messages = session.messages;
        if (messages.length <= autonomyPrevMsgCountRef.current) {
            autonomyPrevMsgCountRef.current = messages.length;
            return;
        }

        const newMessages = messages.slice(autonomyPrevMsgCountRef.current);
        autonomyPrevMsgCountRef.current = messages.length;
        const now = Date.now();

        Object.keys(session.characterStates).forEach(characterId => {
            const state = autonomyStateRef.current[characterId]
                ?? (() => {
                    const next = createAutonomyState(getContextKey(session, characterId));
                    autonomyStateRef.current[characterId] = next;
                    return next;
                })();
            const hasRelevantUpdate = newMessages.some(message => isRelevantExternalMessage(characterId, message));
            if (!hasRelevantUpdate) return;

            autonomousControlRef.current?.cancel(characterId);
            state.inFlight = false;
            state.activeSeq = null;
            setAutonomyMode(characterId, state, 'checking');
            state.nextCheckAt = now + AUTONOMOUS_CHECK_INTERVAL_MS;
            state.waitingSince = null;
            state.contextKey = getContextKey(session, characterId);
            state.promptCount = 0;
            state.lastContextUpdateAt = now;
        });
    }, [getContextKey, isRelevantExternalMessage, session, setAutonomyMode]);

    useEffect(() => {
        if (!session || session.status !== 'active') return;

        const timer = window.setInterval(() => {
            const cur = sessionRef.current;
            if (!cur || cur.status !== 'active') return;

            const now = Date.now();
            Object.entries(cur.characterStates).forEach(([characterId, charState]) => {
                const state = getAutonomyState(characterId, cur);

                if (charState.goalAchieved) {
                    vtCancelNudge(characterId);
                    return;
                }

                // Recovery guard: if a character accidentally stays idle, restore periodic checks.
                if (state.mode === 'idle' && !state.inFlight) {
                    setAutonomyMode(characterId, state, 'checking');
                    state.nextCheckAt = now + AUTONOMOUS_CHECK_INTERVAL_MS;
                    state.waitingSince = null;
                    logAutonomy('idle_recovered_to_checking', { characterId, nextCheckAt: state.nextCheckAt });
                }

                if (state.mode === 'checking' && !state.inFlight && state.nextCheckAt !== null && now >= state.nextCheckAt) {
                    void runAutonomousCheck(characterId);
                    return;
                }

                if (
                    state.mode === 'waiting-update'
                    && !state.inFlight
                    && state.waitingSince !== null
                    && now - state.waitingSince >= AUTONOMOUS_PROMPT_DELAY_MS
                    && state.promptCount < AUTONOMOUS_MAX_PROMPTS
                ) {
                    void sendAutonomousPrompt(characterId);
                }
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [getAutonomyState, runAutonomousCheck, sendAutonomousPrompt, session, sessionRef, setAutonomyMode, vtCancelNudge]);

    // ── Message Sending ────────────────────────────────────────────────────

    const { sendMessage, startAutonomousCheck, isLatestAutonomousCheck, cancelAutonomousCheck } = useSendMessage({
        sessionRef,
        getVirtualTimeLabel,
        vtCancelNudge,
        vtScheduleNudge,
        setSession,
        resetNudgeCount: () => {},
    });

    // 填入 autonomousControlRef（provider 透過此 ref 管理自主請求序號與取消）
    autonomousControlRef.current = {
        start: startAutonomousCheck,
        isLatest: isLatestAutonomousCheck,
        cancel: cancelAutonomousCheck,
    };

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
            autonomyModes,
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
