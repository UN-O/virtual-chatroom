'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from 'react';
import type {
    GameSession,
    ClientSession,
    Message,
    ChatRoom,
    TypingState,
    ScheduledEvent,
    GameState,
    Phase
} from './types';
import { LocalSessionAdapter } from './storage/local-adapter';
import { storyPlot, characters, groups, allCharacterMissions } from './story-data';
import { areAllGoalsAchieved, determineNextPhase } from './engine/phase';
import { calculateResponseProbability, shouldRespond } from './engine/pad';
import { useVirtualTime } from '@/hooks/useVirtualTime';

// --- Context Definition ---


export interface GameContextType {
    // State
    session: GameSession | null;
    gameState: GameState | null;
    sessions: ClientSession[];
    isLoading: boolean;
    activeChatId: string | null;
    chatRooms: ChatRoom[];
    typingStates: TypingState[];
    debugMode: boolean;

    // Actions
    sendMessage: (chatId: string, content: string, type?: 'text' | 'sticker', stickerId?: string) => Promise<void>;
    createSession: () => string;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    setActiveChat: (chatId: string | null) => void;
    debugFastForward: () => void;
    scheduleDMResponse: (characterId: string, delayMs: number) => void;
    scheduleGroupResponse: (groupId: string, characterId: string, delayMs: number) => void;
    getCurrentPhase: () => Phase | undefined;
    advancePhase: () => void;
    toggleDebugMode: () => void;
    getCharacterName: (characterId: string) => string | null;
    getTypingCharacters: (chatId: string) => string[];
}

const GameContext = createContext<GameContextType | undefined>(undefined);

// --- Helpers ---

const generateId = () => Math.random().toString(36).substring(2, 9);

const initializeNewSession = (): ClientSession => {
    const sessionId = generateId();
    const initialPhase = storyPlot.phases[0];

    // Initialize Character States
    const charStates: Record<string, any> = {};
    Object.keys(characters).forEach(id => {
        charStates[id] = {
            characterId: id,
            pad: { ...characters[id].padConfig.initial },
            memory: '',
            goalAchieved: false
        };
    });

    return {
        id: sessionId,
        storyId: storyPlot.id,
        userId: 'user-1', // Single user for now
        version: 1,
        status: 'active',
        currentPhaseId: initialPhase.id,
        progressLabel: initialPhase.progressLabel,
        virtualTime: initialPhase.virtualTime,
        characterStates: charStates,
        messages: [], // Empty initially
        startedAt: new Date(),
        lastActiveAt: new Date()
    };
};

const getChatRooms = (session: GameSession | null): ChatRoom[] => {
    if (!session) return [];

    // 1. Generate DM Rooms for all characters
    const dmRooms: ChatRoom[] = Object.values(characters).map(char => {
        // Check if there is history
        const lastMsg = session.messages
            .filter(m =>
                (m.senderId === char.id && m.chatId === char.id) ||
                (m.senderType === 'player' && m.chatId === char.id)
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        return {
            id: char.id,
            type: 'dm',
            name: char.profile.name,
            avatarUrl: char.profile.avatarUrl,
            characterId: char.id, // Only for DM
            lastMessage: lastMsg ? lastMsg.content : undefined,
            lastMessageTime: lastMsg ? new Date(lastMsg.createdAt) : undefined,
            unreadCount: 0 // Logic for unread later
        };
    });

    // 2. Generate Group Rooms
    // Filter groups that the player is in or explicitly invited to (for now all defined groups)
    const groupRooms: ChatRoom[] = groups.map(group => {
        const lastMsg = session.messages
            .filter(m => m.chatId === group.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        return {
            id: group.id,
            type: 'group',
            name: group.name,
            avatarUrl: group.avatarUrl,
            groupId: group.id, // Only for Group
            lastMessage: lastMsg ? lastMsg.content : undefined,
            lastMessageTime: lastMsg ? new Date(lastMsg.createdAt) : undefined,
            unreadCount: 0
        };
    });

    return [...dmRooms, ...groupRooms];
};


// --- Provider ---

export function GameProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<ClientSession | null>(null);
    const [allSessions, setAllSessions] = useState<ClientSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [debugMode, setDebugMode] = useState(false);

    // Stable ref to session for use inside async callbacks (avoids stale closure)
    const sessionRef = useRef<ClientSession | null>(null);
    useEffect(() => { sessionRef.current = session; }, [session]);

    // Actions wrapped in useCallback to be stable
    const createSession = useCallback((): string => {
        const newSession = initializeNewSession();
        // Don't auto-set session here, let the navigation handle it
        // setSession(newSession);
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
            const firstCharId = Object.keys(characters)[0];
            if (firstCharId) setActiveChatId(firstCharId);

            // Trigger phase-start messages if this is a fresh session (no messages yet)
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
                    if (data.messages && Array.isArray(data.messages)) {
                        data.messages.forEach((msg: { characterId: string; chatId: string; content: string; expressionKey?: string }, index: number) => {
                            const delay = 1500 + index * 2000;
                            setTimeout(() => {
                                setSession(prev => prev ? {
                                    ...prev,
                                    messages: [...prev.messages, {
                                        id: `phase_start_${Date.now()}_${index}`,
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
                }).catch(e => console.error('[Phase] Initial phase-start failed', e));
            }
        } else {
            setSession(null); // Clear session if not found
        }
    }, []);

    const deleteSession = useCallback((sessionId: string) => {
        LocalSessionAdapter.deleteSession(sessionId);
        setAllSessions(prev => prev.filter(s => s.id !== sessionId));
        // If we passed session here, we need to access current 'session' state.
        // However, since we are inside useCallback, we need to depend on 'session' or use ref.
        // We'll depend on it, but be careful about recreations.
        // Or better: check inside the setState updater or force reload logic outside.
    }, []);

    // 1. Load Initial State (List only)
    useEffect(() => {
        const sessions = LocalSessionAdapter.listSessions();
        setAllSessions(sessions);

        // Don't auto-load or auto-create session. Let the page component decide.
        setIsLoading(false);
    }, []); // Only run once on mount

    // 2. Persist State on Change
    useEffect(() => {
        if (session) {
            LocalSessionAdapter.saveSession(session);

            // Update the list view
            setAllSessions(prev => {
                const idx = prev.findIndex(s => s.id === session.id);
                if (idx >= 0) {
                    const newSessions = [...prev];
                    newSessions[idx] = session;
                    return newSessions;
                }
                return [...prev, session];
            });
        }
    }, [session]);


    // --- Virtual Time Engine Integration ---
    const { 
        scheduleDMResponse: vtScheduleDM,
        scheduleGroupResponses: vtScheduleGroup,
        scheduleNudge: vtScheduleNudge,
        cancelNudge: vtCancelNudge,
        typingStates
    } = useVirtualTime({
        enabled: !!session && session.status === 'active',
        onCharacterResponse: async (characterId, chatId) => {
             const currentSession = sessionRef.current;
             if (!currentSession) return;
             
             const charState = currentSession.characterStates[characterId];
             const character = characters[characterId];
             if(!charState || !character) return;
             
             // Determine if it is DM or Group
             const isDM = chatId === characterId;
             const location = isDM ? 'dm' : 'group';
             const chatHistory = currentSession.messages
                 .filter(m => m.chatId === chatId)
                 .slice(-15);
                 
            const currentPhase = storyPlot.phases.find(p => p.id === currentSession.currentPhaseId);
            const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);

            try {
                // If Group, use char-respond endpoint (F2)
                if (location === 'group') {
                    // Logic handled in scheduleGroupResponse but we need to generate message here if scheduled directly
                    // Actually useVirtualTime's logic for group is complex.
                    // Let's reuse existing API endpoints logic.
                    // Group response usually triggered by char-respond endpoint. 
                    // Wait, useVirtualTime schedules response, so here we just need to GENERATE it.
                    // But wait, group logic in existing code was intertwined.
                    
                    // Let's simplify: Standardize on generate-message logic
                     const res = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'respond', // Treat group response same as DM for generation for now, or add group flag
                            characterId,
                            chatHistory,
                            currentPad: charState.pad,
                            memory: charState.memory,
                            phaseGoal: mission?.goal || '',
                            triggerDirection: '',
                            location: 'group'
                        })
                    });
                    const data = await res.json();
                    if(data.content) {
                         setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: generateId(),
                                chatId,
                                senderType: 'character',
                                senderId: characterId,
                                content: data.content,
                                expressionKey: data.expressionKey,
                                createdAt: new Date()
                            }]
                        } : null);
                        
                        // After group message, schedule further responses
                        // vtScheduleGroup(groups.find(g=>g.id===chatId)?.members || [], chatId, ...);
                    }

                } else {
                    // DM
                    const lastPlayerMsg = chatHistory
                        .filter(m => m.senderType === 'player')
                        .slice(-1)[0]?.content;

                    const res = await fetch('/api/chat', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            action: 'respond',
                            characterId,
                            playerMessage: lastPlayerMsg,
                            chatHistory,
                            currentPad: charState.pad,
                            memory: charState.memory || '',
                            phaseGoal: mission?.goal || '',
                            triggerDirection: mission?.triggerDirection || '',
                            location: 'dm'
                        })
                    });
                    const data = await res.json();
                     if(data.content) {
                        setSession(prev => prev ? {
                            ...prev,
                            messages: [...prev.messages, {
                                id: generateId(),
                                chatId,
                                senderType: 'character',
                                senderId: characterId,
                                content: data.content,
                                expressionKey: data.expressionKey,
                                createdAt: new Date()
                            }]
                        } : null);
                        
                        // Schedule nudge after character reply
                         vtScheduleNudge(characterId, chatId, 45000); // 45s Nudge
                    }
                }
            } catch (e) {
                console.error('[VirtualTime] Response error', e);
            }
        },
        onNudge: async (characterId, chatId) => {
             const currentSession = sessionRef.current;
             if (!currentSession) return;
             
             // Get nudge count for this phase? For now simple implementation.
             try {
                const res = await fetch('/api/event/nudge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                       characterId,
                       chatId,
                       nudgeCount: 1 // TODO: Track count
                    })
                });
                const data = await res.json();
                if(data.content) {
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
             } catch(e) {
                 console.error('[Nudge] Error', e);
             }
        },
        onTypingStart: (characterId, chatId) => {
            // Typing state is returned by hook, no manual set needed if we use that
            // But logic inside hook uses internal state. Need to verify.
            // Actually hook returns `typingStates` we can use directly.
        },
        onTypingEnd: (characterId, chatId) => {
             // Handled by hook
        }
    });

    // Remap old schedule functions to new hook
    const scheduleDMResponse = useCallback((characterId: string, delayMs: number) => {
        const char = characters[characterId];
        if (char) vtScheduleDM(char, characterId, delayMs / 1000, 0.5);
    }, [vtScheduleDM]);

    const scheduleGroupResponse = useCallback((groupId: string, characterId: string, delayMs: number) => {
        // Map single-character group schedule to vtScheduleDM (same timer mechanism, different chatId)
        vtScheduleDM(characters[characterId], groupId, delayMs / 1000, 0.5);
    }, [vtScheduleDM]);

    const sendMessage = useCallback(async (chatId: string, content: string, type: 'text' | 'sticker' = 'text', stickerId?: string) => {
        if (!chatId) return;

        // 1. Optimistic Update
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

        const currentSession = sessionRef.current;
        
        // 2. DM Logic
        const char = characters[chatId];
        if (char) {
            // Cancel any pending nudge since player spoke
            vtCancelNudge(chatId);

            const charState = currentSession?.characterStates[chatId];
            if (charState && currentSession) {
                // F1: Schedule character response (via useVirtualTime → onCharacterResponse → API)
                vtScheduleDM(char, chatId, 1.5, charState.pad.a);

                // F3 + F5 in parallel (background, no-await)
                const chatHistory = currentSession.messages
                    .filter(m => m.chatId === chatId)
                    .slice(-15);
                const currentPhase = storyPlot.phases.find(p => p.id === currentSession.currentPhaseId);
                const mission = currentPhase?.characterMissions.find(m => m.characterId === chatId);

                Promise.all([
                    // F3: Analyze PAD delta
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
                    // F5: Check goal (skip if already achieved or no mission)
                    mission && !charState.goalAchieved
                        ? fetch('/api/chat', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                action: 'checkGoal',
                                goal: mission.goal,
                                completionHint: mission.completionHint,
                                chatHistory: [...chatHistory, {
                                    id: 'temp',
                                    chatId,
                                    senderType: 'player',
                                    senderId: 'player',
                                    content,
                                    createdAt: new Date()
                                }],
                                currentlyAchieved: charState.goalAchieved
                            })
                        }).then(r => r.json()).catch(() => null)
                        : Promise.resolve(null)
                ]).then(([analyzeResult, goalResult]) => {
                    // Update PAD and goalAchieved from F3/F5 results
                    setSession(prev => {
                        if (!prev) return null;
                        const oldCharState = prev.characterStates[chatId];
                        if (!oldCharState) return prev;
                        const delta = analyzeResult?.padDelta || { p: 0, a: 0, d: 0 };
                        const newGoalAchieved = goalResult?.achieved ?? oldCharState.goalAchieved;
                        return {
                            ...prev,
                            characterStates: {
                                ...prev.characterStates,
                                [chatId]: {
                                    ...oldCharState,
                                    pad: {
                                        p: Math.max(-1, Math.min(1, oldCharState.pad.p + delta.p)),
                                        a: Math.max(0, Math.min(1, oldCharState.pad.a + delta.a)),
                                        d: Math.max(-1, Math.min(1, oldCharState.pad.d + delta.d))
                                    },
                                    goalAchieved: newGoalAchieved
                                }
                            }
                        };
                    });

                    // F4: Update memory (background, after F3)
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
                        }).then(r => r.json()).then(memResult => {
                            if (memResult?.memory) {
                                setSession(prev => prev ? {
                                    ...prev,
                                    characterStates: {
                                        ...prev.characterStates,
                                        [chatId]: {
                                            ...prev.characterStates[chatId],
                                            memory: memResult.memory
                                        }
                                    }
                                } : null);
                            }
                        }).catch(e => console.error('[F4] Memory update failed', e));
                    }
                }).catch(e => console.error('[F3/F5] Analysis failed', e));
            }
            return;
        }

        // 3. Group Logic
        const group = groups.find(g => g.id === chatId);
        if (group) {
             // For group, we want to see if anyone wants to reply
             // This logic was previously manual prob check.
             // Now we should use vtScheduleGroup which handles this for all members
             const members = group.members.map(id => characters[id]).filter(Boolean);
             const memberStates = group.members.reduce((acc, id) => {
                 if(currentSession?.characterStates[id]) {
                     acc[id] = { pad: currentSession.characterStates[id].pad };
                 }
                 return acc;
             }, {} as Record<string, {pad: {a: number}}>);
             
             // Define base delays for members (can be random or fixed)
             const baseDelays = group.members.reduce((acc, id) => {
                 acc[id] = 2 + Math.random() * 3; // 2-5s base delay
                 return acc;
             }, {} as Record<string, number>);
             
             vtScheduleGroup(members, chatId, memberStates, baseDelays);
        }
    }, [vtScheduleDM, vtScheduleGroup, vtCancelNudge]);


    const advancePhase = useCallback(async () => {
        const currentSession = sessionRef.current;
        if (!currentSession) return;

        console.log('[Phase] Current phaseId:', currentSession.currentPhaseId);

        const currentPhase = storyPlot.phases.find(p => p.id === currentSession.currentPhaseId);
        if (!currentPhase) {
            console.error('[Phase] Current phase object not found in plot');
            return;
        }

        const nextPhaseId = determineNextPhase(currentPhase, storyPlot.phases, currentSession.characterStates);
        if (!nextPhaseId) {
            console.log('[Phase] No next phase determined (end of story or conditions not met)');
            return;
        }

        const nextPhase = storyPlot.phases.find(p => p.id === nextPhaseId);
        if (!nextPhase) {
             console.error(`[Phase] Next phase ${nextPhaseId} not found in plot`);
             return;
        }

        console.log('[Phase] Advancing to:', nextPhaseId, nextPhase.progressLabel);

        // 1. Update Session State locally
        const isEnding = nextPhase.id.startsWith('ending');
        setSession(prev => prev ? {
            ...prev,
            currentPhaseId: nextPhase.id,
            progressLabel: nextPhase.progressLabel,
            virtualTime: nextPhase.virtualTime,
            status: isEnding ? 'completed' : prev.status
        } : null);

        // 2. Trigger Phase Start API (Proactive messages)
        try {
            console.log('[Phase] Triggering phase-start API...');
            const res = await fetch('/api/event/phase-start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phaseId: nextPhase.id,
                    characterStates: currentSession.characterStates,
                    // Pass simplified history map to save bandwidth, or empty if too heavy
                    chatHistories: {}
                })
            });

            if (!res.ok) throw new Error(`API error ${res.status}`);

            const data = await res.json();
            console.log('[Phase] API Response messages:', data.messages);

            if (data.messages && Array.isArray(data.messages)) {
                data.messages.forEach((msg: { characterId: string; chatId: string; content: string; expressionKey?: string }, index: number) => {
                    const delay = 1500 + index * 2000;
                    setTimeout(() => {
                        setSession(prev => {
                            if (!prev) return null;
                            return {
                                ...prev,
                                messages: [...prev.messages, {
                                    id: `msg_${Date.now()}_${index}`,
                                    chatId: msg.chatId,
                                    senderType: 'character',
                                    senderId: msg.characterId,
                                    content: msg.content,
                                    expressionKey: msg.expressionKey,
                                    createdAt: new Date()
                                }]
                            };
                        });
                    }, delay);
                });
            }

        } catch (e) {
            console.error('[Phase] Failed to trigger phase-start events', e);
        }

    }, []);

    const debugFastForward = useCallback(() => {
        advancePhase();
    }, [advancePhase]);

    const getCurrentPhase = useCallback(() => {
        if (!session) return undefined;
        return storyPlot.phases.find(p => p.id === session.currentPhaseId);
    }, [session]);

    const toggleDebugMode = useCallback(() => {
        setDebugMode(prev => !prev);
    }, []);

    const getCharacterName = useCallback((characterId: string): string | null => {
        return characters[characterId]?.profile.name ?? null;
    }, []);

    const getTypingCharacters = useCallback((chatId: string): string[] => {
        return typingStates
            .filter(t => t.chatId === chatId)
            .map(t => t.characterId);
    }, [typingStates]);

    const chatRooms = React.useMemo(() => getChatRooms(session), [session]);
    const gameState = useMemo<GameState | null>(() => {
        if (!session) return null;
        return {
            session,
            story: storyPlot,
            characters,
            characterMissions: allCharacterMissions,
            groups,
            chatRooms,
            activeChatId,
            isLoading,
            canFastForward: (() => {
                const currentPhase = storyPlot.phases.find(p => p.id === session.currentPhaseId);
                return currentPhase ? areAllGoalsAchieved(currentPhase, session.characterStates) : false;
            })(),
            typingStates,
            pendingEvents: [], // TODO: Track pending events
            debugMode: debugMode
        };
    }, [session, chatRooms, activeChatId, isLoading, typingStates, debugMode]);

    const value: GameContextType = {
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
    };

    return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export const useGame = () => {
    const context = useContext(GameContext);
    if (context === undefined) {
        throw new Error('useGame must be used within a GameProvider');
    }
    return context;
};
