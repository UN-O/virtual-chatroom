"use client";

import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import type { GameState, Message, ChatRoom, CharacterState, TypingState, PADDelta, GenerateResponseResult } from './types';
import { storyPlot, characters, allCharacterMissions, groups } from './story-data';
import { applyPADDelta, shouldRespond, calculateResponseDelay } from './engine/pad';
import { determineNextPhase, areAllGoalsAchieved, getPhaseDebugInfo } from './engine/phase';
import { useVirtualTime } from '@/hooks/useVirtualTime';

interface GameContextType {
  gameState: GameState | null;
  startGame: () => void;
  sendMessage: (chatId: string, content: string) => Promise<void>;
  setActiveChat: (chatId: string | null) => void;
  advancePhase: () => void;
  getCharacterName: (characterId: string) => string;
  getCurrentPhase: () => typeof storyPlot.phases[0] | undefined;
  getTypingCharacters: (chatId: string) => string[];
  toggleDebugMode: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [gameState, setGameState] = useState<GameState | null>(null);
  
  // Track the latest player message for each chat (for response generation)
  const latestPlayerMessageRef = useRef<Record<string, string>>({});
  
  // Ref to access latest game state in callbacks
  const gameStateRef = useRef<GameState | null>(null);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  /**
   * Handle character response callback from virtual time engine
   * This is called when a scheduled response timer fires
   */
  const handleCharacterResponse = useCallback(async (characterId: string, chatId: string) => {
    const currentState = gameStateRef.current;
    if (!currentState) return;

    const char = characters[characterId];
    const charState = currentState.session.characterStates[characterId];
    const currentPhase = storyPlot.phases.find(p => p.id === currentState.session.currentPhaseId);
    const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);
    
    // Get recent chat history
    const chatHistory = currentState.session.messages
      .filter(m => m.chatId === chatId)
      .slice(-10);
    
    const playerMessage = latestPlayerMessageRef.current[chatId] || '';

    // Determine if this is a phase-triggered message or a reply
    const isPhaseMessage = chatHistory.length === 0 || !playerMessage;

    try {
      // Call API to generate response
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId,
          playerMessage,
          chatHistory,
          currentPad: charState.pad,
          phaseGoal: mission?.goal || '',
          triggerDirection: mission?.triggerDirection || '',
          location: chatId.startsWith('group_') ? 'group' : 'dm',
          action: 'respond'
        })
      });

      if (!response.ok) throw new Error('API error');

      const result: GenerateResponseResult = await response.json();
      
      // Update state with response
      setGameState(prev => {
        if (!prev) return prev;

        const newMessage: Message = {
          id: `msg_${Date.now()}_${characterId}`,
          chatId,
          senderType: 'character',
          senderId: characterId,
          content: result.content,
          createdAt: new Date()
        };

        // Apply PAD delta
        const newCharacterStates = { ...prev.session.characterStates };
        newCharacterStates[characterId] = {
          ...newCharacterStates[characterId],
          pad: applyPADDelta(newCharacterStates[characterId].pad, result.padDelta),
          goalAchieved: newCharacterStates[characterId].goalAchieved || result.goalAchieved
        };

        const updatedRooms = prev.chatRooms.map(room => {
          if (room.id === chatId) {
            return {
              ...room,
              lastMessage: result.content,
              lastMessageTime: new Date(),
              unreadCount: prev.activeChatId === chatId ? 0 : room.unreadCount + 1
            };
          }
          return room;
        });

        // Check if all goals for current phase are achieved
        const allGoalsAchieved = currentPhase?.characterMissions.every(
          m => newCharacterStates[m.characterId]?.goalAchieved
        ) || false;

        return {
          ...prev,
          session: {
            ...prev.session,
            messages: [...prev.session.messages, newMessage],
            characterStates: newCharacterStates,
            lastActiveAt: new Date()
          },
          chatRooms: updatedRooms,
          isLoading: false,
          canFastForward: allGoalsAchieved
        };
      });
    } catch (error) {
      console.error('[v0] Error generating response:', error);
      
      // Fallback to hardcoded responses
      const fallbackContent = generateFallbackResponse(characterId, playerMessage, charState.pad, isPhaseMessage, currentPhase?.id || '');
      
      setGameState(prev => {
        if (!prev) return prev;

        const newMessage: Message = {
          id: `msg_${Date.now()}_${characterId}`,
          chatId,
          senderType: 'character',
          senderId: characterId,
          content: fallbackContent.content,
          createdAt: new Date()
        };

        const newCharacterStates = { ...prev.session.characterStates };
        newCharacterStates[characterId] = {
          ...newCharacterStates[characterId],
          pad: applyPADDelta(newCharacterStates[characterId].pad, fallbackContent.padDelta),
          goalAchieved: newCharacterStates[characterId].goalAchieved || fallbackContent.goalAchieved
        };

        const updatedRooms = prev.chatRooms.map(room => {
          if (room.id === chatId) {
            return {
              ...room,
              lastMessage: fallbackContent.content,
              lastMessageTime: new Date(),
              unreadCount: prev.activeChatId === chatId ? 0 : room.unreadCount + 1
            };
          }
          return room;
        });

        const allGoalsAchieved = currentPhase?.characterMissions.every(
          m => newCharacterStates[m.characterId]?.goalAchieved
        ) || false;

        return {
          ...prev,
          session: {
            ...prev.session,
            messages: [...prev.session.messages, newMessage],
            characterStates: newCharacterStates,
            lastActiveAt: new Date()
          },
          chatRooms: updatedRooms,
          isLoading: false,
          canFastForward: allGoalsAchieved
        };
      });
    }
  }, []);

  /**
   * Handle nudge callback
   */
  const handleNudge = useCallback(async (characterId: string, chatId: string) => {
    const currentState = gameStateRef.current;
    if (!currentState) return;

    const currentPhase = storyPlot.phases.find(p => p.id === currentState.session.currentPhaseId);
    const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);
    
    if (!mission?.failNudge) return;

    const nudgeContent = mission.failNudge;

    setGameState(prev => {
      if (!prev) return prev;

      const newMessage: Message = {
        id: `msg_nudge_${Date.now()}_${characterId}`,
        chatId,
        senderType: 'character',
        senderId: characterId,
        content: nudgeContent,
        createdAt: new Date()
      };

      const updatedRooms = prev.chatRooms.map(room => {
        if (room.id === chatId) {
          return {
            ...room,
            lastMessage: nudgeContent,
            lastMessageTime: new Date(),
            unreadCount: prev.activeChatId === chatId ? 0 : room.unreadCount + 1
          };
        }
        return room;
      });

      return {
        ...prev,
        session: {
          ...prev.session,
          messages: [...prev.session.messages, newMessage],
          lastActiveAt: new Date()
        },
        chatRooms: updatedRooms
      };
    });
  }, []);

  /**
   * Handle typing start
   */
  const handleTypingStart = useCallback((characterId: string, chatId: string) => {
    setGameState(prev => {
      if (!prev) return prev;
      const alreadyTyping = prev.typingStates.some(
        s => s.characterId === characterId && s.chatId === chatId
      );
      if (alreadyTyping) return prev;
      
      return {
        ...prev,
        typingStates: [...prev.typingStates, { characterId, chatId, startedAt: new Date() }]
      };
    });
  }, []);

  /**
   * Handle typing end
   */
  const handleTypingEnd = useCallback((characterId: string, chatId: string) => {
    setGameState(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        typingStates: prev.typingStates.filter(
          s => !(s.characterId === characterId && s.chatId === chatId)
        )
      };
    });
  }, []);

  // Initialize virtual time engine
  const virtualTime = useVirtualTime({
    onCharacterResponse: handleCharacterResponse,
    onNudge: handleNudge,
    onTypingStart: handleTypingStart,
    onTypingEnd: handleTypingEnd,
    enabled: gameState !== null
  });

  const initializeChatRooms = useCallback((): ChatRoom[] => {
    const rooms: ChatRoom[] = [];

    // Add DM rooms for each character
    Object.values(characters).forEach((char) => {
      rooms.push({
        id: `dm_${char.id}`,
        type: 'dm',
        name: char.profile.name,
        avatarUrl: char.profile.avatarUrl,
        characterId: char.id,
        unreadCount: 0
      });
    });

    // Add group rooms
    groups.forEach((group) => {
      rooms.push({
        id: `group_${group.slug}`,
        type: 'group',
        name: group.name,
        avatarUrl: group.avatarUrl,
        groupId: group.id,
        unreadCount: 0
      });
    });

    return rooms;
  }, []);

  const initializeCharacterStates = useCallback((): Record<string, CharacterState> => {
    const states: Record<string, CharacterState> = {};

    Object.values(characters).forEach((char) => {
      states[char.id] = {
        characterId: char.id,
        pad: { ...char.padConfig.initial },
        memory: "",
        goalAchieved: false
      };
    });

    return states;
  }, []);

  const startGame = useCallback(() => {
    const initialPhase = storyPlot.phases[0];
    
    const session = {
      id: `session_${Date.now()}`,
      storyId: storyPlot.id,
      status: 'active' as const,
      currentPhaseId: initialPhase.id,
      progressLabel: initialPhase.progressLabel,
      virtualTime: initialPhase.virtualTime,
      characterStates: initializeCharacterStates(),
      messages: [],
      startedAt: new Date(),
      lastActiveAt: new Date()
    };

    const newState: GameState = {
      session,
      story: storyPlot,
      characters,
      characterMissions: allCharacterMissions,
      groups,
      chatRooms: initializeChatRooms(),
      activeChatId: null,
      isLoading: false,
      canFastForward: false,
      typingStates: [],
      pendingEvents: [],
      debugMode: false
    };

    setGameState(newState);

    // Schedule initial phase messages using virtual time engine
    setTimeout(() => {
      triggerPhaseMessages(initialPhase.id);
    }, 500);
  }, [initializeChatRooms, initializeCharacterStates]);

  /**
   * Trigger phase messages using the virtual time engine
   */
  const triggerPhaseMessages = useCallback((phaseId: string) => {
    const phase = storyPlot.phases.find(p => p.id === phaseId);
    if (!phase) return;

    // Build delays for each character
    const delays: Record<string, number> = {};
    phase.characterMissions.forEach((mission, index) => {
      delays[mission.characterId] = (index + 1) * 2000;
    });

    // Get chat IDs for each character
    const getChatId = (charId: string): string => {
      const mission = phase.characterMissions.find(m => m.characterId === charId);
      if (mission?.location === 'group') {
        return `group_${groups[0].slug}`;
      }
      return `dm_${charId}`;
    };

    // Clear any old player message refs
    latestPlayerMessageRef.current = {};

    // Schedule phase messages through virtual time engine
    const charsToSchedule = phase.characterMissions.map(m => characters[m.characterId]);
    virtualTime.schedulePhaseMessages(charsToSchedule, delays, getChatId);
  }, [virtualTime]);

  const sendMessage = useCallback(async (chatId: string, content: string) => {
    if (!gameState) return;

    // Store the player message for response generation
    latestPlayerMessageRef.current[chatId] = content;

    // Add player message to state
    const playerMessage: Message = {
      id: `msg_${Date.now()}`,
      chatId,
      senderType: 'player',
      senderId: null,
      content,
      createdAt: new Date()
    };

    setGameState(prev => {
      if (!prev) return prev;

      const updatedRooms = prev.chatRooms.map(room => {
        if (room.id === chatId) {
          return {
            ...room,
            lastMessage: content,
            lastMessageTime: new Date()
          };
        }
        return room;
      });

      return {
        ...prev,
        session: {
          ...prev.session,
          messages: [...prev.session.messages, playerMessage],
          lastActiveAt: new Date()
        },
        chatRooms: updatedRooms,
        isLoading: true
      };
    });

    // Cancel any pending nudge for this chat
    const chatRoom = gameState.chatRooms.find(r => r.id === chatId);
    if (chatRoom?.characterId) {
      virtualTime.cancelNudge(chatRoom.characterId);
    }

    // Determine who should respond
    if (!chatRoom) return;

    if (chatRoom.type === 'dm' && chatRoom.characterId) {
      // DM: the character responds
      const characterId = chatRoom.characterId;
      const char = characters[characterId];
      const charState = gameState.session.characterStates[characterId];
      
      const currentPhase = storyPlot.phases.find(p => p.id === gameState.session.currentPhaseId);
      const mission = currentPhase?.characterMissions.find(m => m.characterId === characterId);
      const baseDelay = mission?.responseDelaySeconds || 2;

      // Schedule response through virtual time engine
      virtualTime.scheduleDMResponse(char, chatId, baseDelay, charState.pad.a);

      // Schedule nudge if player doesn't respond
      if (mission?.failNudge) {
        virtualTime.scheduleNudge(characterId, chatId, 30);
      }
    } else if (chatRoom.type === 'group') {
      // Group: schedule responses for multiple characters
      const currentPhase = storyPlot.phases.find(p => p.id === gameState.session.currentPhaseId);
      
      // Build response delays
      const responseDelays: Record<string, number> = {};
      currentPhase?.characterMissions.forEach(mission => {
        responseDelays[mission.characterId] = mission.responseDelaySeconds;
      });

      // Schedule group responses through virtual time engine
      virtualTime.scheduleGroupResponses(
        Object.values(characters),
        chatId,
        gameState.session.characterStates,
        responseDelays
      );
      
      // Set a fallback timeout to clear loading state if no one responds
      setTimeout(() => {
        setGameState(prev => prev ? { ...prev, isLoading: false } : prev);
      }, 8000);
    }
  }, [gameState, virtualTime]);

  const setActiveChat = useCallback((chatId: string | null) => {
    setGameState(prev => {
      if (!prev) return prev;

      const updatedRooms = prev.chatRooms.map(room => {
        if (room.id === chatId) {
          return { ...room, unreadCount: 0 };
        }
        return room;
      });

      return {
        ...prev,
        activeChatId: chatId,
        chatRooms: updatedRooms
      };
    });
  }, []);

  const advancePhase = useCallback(() => {
    // Clear all pending timers
    virtualTime.clearAllTimers();

    setGameState(prev => {
      if (!prev) return prev;

      const currentPhase = storyPlot.phases.find(p => p.id === prev.session.currentPhaseId);
      if (!currentPhase) return prev;
      
      // Use the phase engine to determine next phase
      const nextPhaseId = determineNextPhase(
        currentPhase,
        storyPlot.phases,
        prev.session.characterStates
      );

      const nextPhase = nextPhaseId ? storyPlot.phases.find(p => p.id === nextPhaseId) : null;
      
      if (!nextPhase) {
        // Game over
        return {
          ...prev,
          session: {
            ...prev.session,
            status: 'completed' as const
          },
          typingStates: [],
          pendingEvents: []
        };
      }

      // Reset character goal states for new phase
      const newCharacterStates = { ...prev.session.characterStates };
      Object.keys(newCharacterStates).forEach(charId => {
        newCharacterStates[charId] = {
          ...newCharacterStates[charId],
          goalAchieved: false
        };
      });

      const newState = {
        ...prev,
        session: {
          ...prev.session,
          currentPhaseId: nextPhase.id,
          progressLabel: nextPhase.progressLabel,
          virtualTime: nextPhase.virtualTime,
          characterStates: newCharacterStates
        },
        canFastForward: false,
        typingStates: [],
        pendingEvents: []
      };

      // Trigger new phase messages
      setTimeout(() => {
        triggerPhaseMessages(nextPhase.id);
      }, 500);

      return newState;
    });
  }, [triggerPhaseMessages, virtualTime]);

  const getCharacterName = useCallback((characterId: string): string => {
    return characters[characterId]?.profile.name || "Unknown";
  }, []);

  const getCurrentPhase = useCallback(() => {
    if (!gameState) return undefined;
    return storyPlot.phases.find(p => p.id === gameState.session.currentPhaseId);
  }, [gameState]);

  const getTypingCharacters = useCallback((chatId: string): string[] => {
    if (!gameState) return [];
    return gameState.typingStates
      .filter(s => s.chatId === chatId)
      .map(s => s.characterId);
  }, [gameState]);

  const toggleDebugMode = useCallback(() => {
    setGameState(prev => {
      if (!prev) return prev;
      return { ...prev, debugMode: !prev.debugMode };
    });
  }, []);

  return (
    <GameContext.Provider value={{
      gameState,
      startGame,
      sendMessage,
      setActiveChat,
      advancePhase,
      getCharacterName,
      getCurrentPhase,
      getTypingCharacters,
      toggleDebugMode
    }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error("useGame must be used within a GameProvider");
  }
  return context;
}

/**
 * Fallback response generator (used when API fails)
 */
function generateFallbackResponse(
  characterId: string,
  playerMessage: string,
  currentPad: { p: number; a: number; d: number },
  isPhaseMessage: boolean,
  phaseId: string
): { content: string; padDelta: PADDelta; goalAchieved: boolean } {
  const lowerMsg = playerMessage.toLowerCase();
  let content = "";
  let padDelta: PADDelta = { p: 0, a: 0.05, d: 0 };
  let goalAchieved = false;

  if (characterId === "char_boss") {
    if (isPhaseMessage) {
      // Phase-triggered messages
      if (phaseId === "morning") {
        content = "你好，今天下午我要開部門會議，需要一份 Q3 業績摘要報告。今天下班前給我。";
      } else if (phaseId === "afternoon") {
        content = "報告進度？";
      } else if (phaseId === "ending_good") {
        content = "好，我看一下。還不錯。";
        goalAchieved = true;
      } else if (phaseId === "ending_bad") {
        content = "這份我不能用。下次再這樣我就找別人做。";
        goalAchieved = true;
      }
    } else {
      // Reply to player
      if (lowerMsg.includes("好") || lowerMsg.includes("可以") || lowerMsg.includes("沒問題")) {
        if (lowerMsg.includes("點") || lowerMsg.includes("時") || /\d/.test(playerMessage)) {
          content = "好。";
          padDelta = { p: 0.15, a: -0.05, d: 0.05 };
          goalAchieved = true;
        } else {
          content = "什麼時候可以給我？";
          padDelta = { p: -0.05, a: 0.1, d: 0.1 };
        }
      } else if (lowerMsg.includes("試") || lowerMsg.includes("應該") || lowerMsg.includes("盡量")) {
        content = "「試試看」是什麼意思？我需要明確的時間。";
        padDelta = { p: -0.25, a: 0.15, d: 0.1 };
      } else if (lowerMsg.includes("進度") || lowerMsg.includes("完成") || lowerMsg.includes("做好") || lowerMsg.includes("整理")) {
        content = currentPad.p > 0.2 ? "好，繼續。" : "嗯。";
        padDelta = { p: 0.1, a: -0.05, d: 0 };
        goalAchieved = true;
      } else if (lowerMsg.includes("問題") || lowerMsg.includes("確認")) {
        content = "說。";
        padDelta = { p: 0.05, a: 0.05, d: 0.05 };
      } else {
        content = currentPad.p > 0 ? "收到，有問題隨時說。" : "收到。";
        padDelta = { p: 0, a: 0.05, d: 0 };
      }
    }
  } else if (characterId === "char_coworker") {
    if (isPhaseMessage) {
      // Phase-triggered messages
      if (phaseId === "morning") {
        content = "欸我跟你說，我今天行程排超滿的，下午還有兩個 call。對了，陳副理剛才私訊你什麼事呀？";
      } else if (phaseId === "afternoon") {
        content = "我手上也有東西要弄，你那邊還好嗎？";
      } else if (phaseId === "ending_good") {
        content = "你搞定了呀，總算～";
        goalAchieved = true;
      } else if (phaseId === "ending_bad") {
        content = "欸你沒事吧？陳副理就這樣啦，別放心上。";
        goalAchieved = true;
      }
    } else {
      // Reply to player
      if (lowerMsg.includes("幫") || lowerMsg.includes("忙")) {
        content = "欸不是，我今天真的超忙的啦，下午還有兩個會議...你自己加油？";
        padDelta = { p: -0.1, a: 0.1, d: -0.1 };
      } else if (lowerMsg.includes("報告") || lowerMsg.includes("陳副理")) {
        content = "哦哦，他又要報告啊...辛苦了，我聽說這種東西很麻煩。";
        padDelta = { p: 0.05, a: 0.05, d: 0 };
      } else if (lowerMsg.includes("謝") || lowerMsg.includes("理解") || lowerMsg.includes("辛苦")) {
        content = "沒事啦～互相互相。";
        padDelta = { p: 0.15, a: -0.05, d: 0.05 };
      } else if (lowerMsg.includes("怎麼") || lowerMsg.includes("為什麼")) {
        content = "欸我也不知道欸，公司的事你也知道的...";
        padDelta = { p: 0, a: 0.05, d: -0.05 };
      } else {
        content = currentPad.p > 0.2 ? "嗯嗯～" : "嗯嗯，這樣喔。";
        padDelta = { p: 0, a: 0.05, d: 0 };
      }
      goalAchieved = true;
    }
  }

  return { content, padDelta, goalAchieved };
}
