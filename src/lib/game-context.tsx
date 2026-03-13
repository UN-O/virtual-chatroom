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
    sendMessage: (content: string, type: 'text' | 'sticker', stickerId?: string) => Promise<void>;
    createSession: () => string;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    setActiveChat: (chatId: string) => void;
    debugFastForward: () => void;
    scheduleDMResponse: (characterId: string, delayMs: number) => void;
    scheduleGroupResponse: (groupId: string, characterId: string, delayMs: number) => void;
    getCurrentPhase: () => Phase | undefined;
    advancePhase: () => void;
    toggleDebugMode: () => void;
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
    // Initialize with the first character ID directly if possible, or null
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [typingStates, setTypingStates] = useState<TypingState[]>([]);
    const [debugMode, setDebugMode] = useState(false);

    // Timer Refs for scheduled events
    const timeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});

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

    const scheduleDMResponse = useCallback((characterId: string, delayMs: number) => {
        // Show typing
        setTypingStates(prev => {
            // Avoid duplicates
            if (prev.some(t => t.characterId === characterId)) return prev;
            return [...prev, { characterId, chatId: characterId, startedAt: new Date() }];
        });

        const timeoutId = setTimeout(() => {
            // Hide typing
            setTypingStates(prev => prev.filter(t => t.characterId !== characterId));

            // Generate response (Mock Logic)
            const char = characters[characterId];
            const responseMsg: Message = {
                id: generateId(),
                chatId: characterId,
                senderType: 'character',
                senderId: characterId,
                content: `Mock Response from ${char?.profile.name || characterId}...`,
                createdAt: new Date()
            };

            setSession(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    messages: [...prev.messages, responseMsg]
                };
            });

        }, delayMs);

        // Store timeout (for cleanup on unmount/session switch if needed)
        // timeoutsRef.current[characterId] = timeoutId; 

    }, []);

    const scheduleGroupResponse = useCallback((groupId: string, characterId: string, delayMs: number) => {
        // Similar to DM but for group chat logic
        console.log('Schedule group response', groupId, characterId);
    }, []);

    const sendMessage = useCallback(async (content: string, type: 'text' | 'sticker', stickerId?: string) => {
        // We need to use refs or functional updates to access latest state if not in dependency array
        // Here we use functional update on setSession

        // But we need activeChatId. If we include it in deps, sendMessage changes often.
        // That's fine for now.

        if (!activeChatId) return;

        const newMessage: Message = {
            id: generateId(),
            chatId: activeChatId,
            senderType: 'player',
            senderId: 'player',
            content,
            stickerId,
            createdAt: new Date()
        };

        // Update Session State
        setSession(prev => {
            if (!prev) return null;
            return {
                ...prev,
                messages: [...prev.messages, newMessage],
                lastActiveAt: new Date()
            };
        });

        console.log('Player sent:', content, 'to', activeChatId);

        // Mock Auto-Reply loop trigger from here?
        // Better to use an effect watching messages? 
        // For simplicity, trigger here directly if it's a DM.
        const char = characters[activeChatId];
        if (char) {
            scheduleDMResponse(activeChatId, 1500);
        }

    }, [activeChatId, scheduleDMResponse]);

    const advancePhase = useCallback(() => {
        if (!session) return;
        const currentPhaseIndex = storyPlot.phases.findIndex(p => p.id === session.currentPhaseId);
        if (currentPhaseIndex >= 0 && currentPhaseIndex < storyPlot.phases.length - 1) {
            const nextPhase = storyPlot.phases[currentPhaseIndex + 1];
            setSession(prev => prev ? {
                ...prev,
                currentPhaseId: nextPhase.id,
                progressLabel: nextPhase.progressLabel,
                virtualTime: nextPhase.virtualTime
            } : null);
        }
    }, [session]);

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
            canFastForward: false, // TODO: Implement check based on phase logic
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
        toggleDebugMode
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
