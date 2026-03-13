import { useCallback, useRef, useEffect, useState } from 'react';
import type { Character, ScheduledEvent, TypingState } from '@/lib/types';
import { shouldRespond, calculateResponseDelay } from '@/lib/engine/pad';

interface UseVirtualTimeOptions {
  onCharacterResponse: (characterId: string, chatId: string) => void;
  onNudge: (characterId: string, chatId: string) => void;
  onTypingStart: (characterId: string, chatId: string) => void;
  onTypingEnd: (characterId: string, chatId: string) => void;
  enabled: boolean;
}

interface UseVirtualTimeReturn {
  // Schedule functions
  scheduleDMResponse: (character: Character, chatId: string, baseDelaySeconds: number, currentArousal: number) => void;
  scheduleGroupResponses: (characters: Character[], chatId: string, characterStates: Record<string, { pad: { a: number } }>, responseDelays: Record<string, number>) => void;
  scheduleNudge: (characterId: string, chatId: string, delaySeconds: number) => void;
  schedulePhaseMessages: (characters: Character[], delays: Record<string, number>, getChatId: (charId: string) => string) => void;
  
  // Cancel functions
  cancelNudge: (characterId: string) => void;
  cancelAllForCharacter: (characterId: string) => void;
  clearAllTimers: () => void;
  
  // State
  typingStates: TypingState[];
  pendingEvents: ScheduledEvent[];
  
  // Debug
  getPendingEvents: () => ScheduledEvent[];
}

/**
 * Virtual Time Engine Hook
 * 
 * Manages all time-based scheduling in the frontend:
 * - Character response delays with typing indicators
 * - Nudge timers for player timeout
 * - Group message response chains with probability-based convergence
 * - Phase start message scheduling
 * 
 * Flow:
 * 1. Event scheduled -> setTimeout created
 * 2. Typing indicator starts (response delay - 1s before actual response)
 * 3. Response callback fires
 * 4. Typing indicator ends
 * 5. Arousal increases -> next response probability decreases (natural convergence)
 */
export function useVirtualTime(options: UseVirtualTimeOptions): UseVirtualTimeReturn {
  const { onCharacterResponse, onNudge, onTypingStart, onTypingEnd, enabled } = options;
  
  const scheduledEventsRef = useRef<Map<string, ScheduledEvent>>(new Map());
  const typingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  
  const [typingStates, setTypingStates] = useState<TypingState[]>([]);
  const [pendingEvents, setPendingEvents] = useState<ScheduledEvent[]>([]);

  // Update pending events state for UI
  const syncPendingEvents = useCallback(() => {
    const events = Array.from(scheduledEventsRef.current.values());
    setPendingEvents(events);
  }, []);

  // Cleanup all timers on unmount or disable
  useEffect(() => {
    if (!enabled) {
      clearAllTimers();
    }
    return () => clearAllTimers();
  }, [enabled]);

  const clearAllTimers = useCallback(() => {
    // Clear all scheduled events
    scheduledEventsRef.current.forEach(event => {
      if (event.timeoutId) clearTimeout(event.timeoutId);
    });
    scheduledEventsRef.current.clear();
    
    // Clear all typing timers
    typingTimersRef.current.forEach(timerId => clearTimeout(timerId));
    typingTimersRef.current.clear();
    
    setTypingStates([]);
    setPendingEvents([]);
  }, []);

  const clearTimerForCharacter = useCallback((characterId: string, type?: ScheduledEvent['type']) => {
    const keysToDelete: string[] = [];
    
    scheduledEventsRef.current.forEach((event, key) => {
      if (event.characterId === characterId && (!type || event.type === type)) {
        if (event.timeoutId) clearTimeout(event.timeoutId);
        keysToDelete.push(key);
      }
    });
    
    keysToDelete.forEach(key => scheduledEventsRef.current.delete(key));
    
    // Also clear any typing timer for this character
    const typingKey = `typing_${characterId}`;
    const typingTimer = typingTimersRef.current.get(typingKey);
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimersRef.current.delete(typingKey);
    }
    
    // Remove from typing states
    setTypingStates(prev => prev.filter(s => s.characterId !== characterId));
    
    syncPendingEvents();
  }, [syncPendingEvents]);

  const cancelAllForCharacter = useCallback((characterId: string) => {
    clearTimerForCharacter(characterId);
  }, [clearTimerForCharacter]);

  /**
   * Start typing indicator for a character
   */
  const startTyping = useCallback((characterId: string, chatId: string) => {
    setTypingStates(prev => {
      // Check if already typing
      if (prev.some(s => s.characterId === characterId && s.chatId === chatId)) {
        return prev;
      }
      return [...prev, { characterId, chatId, startedAt: new Date() }];
    });
    onTypingStart(characterId, chatId);
  }, [onTypingStart]);

  /**
   * Stop typing indicator for a character
   */
  const stopTyping = useCallback((characterId: string, chatId: string) => {
    setTypingStates(prev => prev.filter(
      s => !(s.characterId === characterId && s.chatId === chatId)
    ));
    onTypingEnd(characterId, chatId);
  }, [onTypingEnd]);

  /**
   * Schedule a character's response in DM
   * Called after player sends a DM message
   */
  const scheduleDMResponse = useCallback((
    character: Character,
    chatId: string,
    baseDelaySeconds: number,
    currentArousal: number
  ) => {
    if (!enabled) return;

    // Clear any existing response timer for this character
    clearTimerForCharacter(character.id, 'response');

    const delayMs = calculateResponseDelay(character, baseDelaySeconds, currentArousal) * 1000;
    const eventId = `dm_response_${character.id}_${Date.now()}`;
    const scheduledFor = new Date(Date.now() + delayMs);

    // Start typing indicator slightly before the response
    const typingLeadTime = Math.min(delayMs * 0.7, 2000); // 70% of delay or 2s max
    const typingStartDelay = Math.max(0, delayMs - typingLeadTime);

    const typingTimerId = setTimeout(() => {
      startTyping(character.id, chatId);
    }, typingStartDelay);
    typingTimersRef.current.set(`typing_${character.id}`, typingTimerId);

    const timeoutId = setTimeout(() => {
      scheduledEventsRef.current.delete(eventId);
      stopTyping(character.id, chatId);
      onCharacterResponse(character.id, chatId);
      syncPendingEvents();
    }, delayMs);

    const event: ScheduledEvent = {
      id: eventId,
      characterId: character.id,
      chatId,
      type: 'response',
      scheduledFor,
      timeoutId,
    };

    scheduledEventsRef.current.set(eventId, event);
    syncPendingEvents();
  }, [enabled, clearTimerForCharacter, startTyping, stopTyping, onCharacterResponse, syncPendingEvents]);

  /**
   * Schedule group response chain
   * Called when a new message appears in group chat
   * Each character has their own delay based on config + arousal
   * 
   * Key behavior for natural convergence:
   * - Each response increases the speaker's arousal
   * - Higher arousal = lower probability of responding next time
   * - This naturally causes conversation to settle
   */
  const scheduleGroupResponses = useCallback((
    characters: Character[],
    chatId: string,
    characterStates: Record<string, { pad: { a: number } }>,
    responseDelays: Record<string, number>
  ) => {
    if (!enabled) return;

    characters.forEach(character => {
      const currentArousal = characterStates[character.id]?.pad.a || 0;
      
      // First check probability (pure frontend, no LLM)
      // This is the key to natural convergence - arousal affects probability
      if (!shouldRespond(character, currentArousal)) {
        return;
      }

      // Clear any existing response timer
      clearTimerForCharacter(character.id, 'response');

      const baseDelay = responseDelays[character.id] || 5;
      const delayMs = calculateResponseDelay(character, baseDelay, currentArousal) * 1000;
      const eventId = `group_response_${character.id}_${Date.now()}`;
      const scheduledFor = new Date(Date.now() + delayMs);

      // Start typing indicator
      const typingLeadTime = Math.min(delayMs * 0.6, 1500);
      const typingStartDelay = Math.max(0, delayMs - typingLeadTime);

      const typingTimerId = setTimeout(() => {
        startTyping(character.id, chatId);
      }, typingStartDelay);
      typingTimersRef.current.set(`typing_${character.id}`, typingTimerId);

      const timeoutId = setTimeout(() => {
        scheduledEventsRef.current.delete(eventId);
        stopTyping(character.id, chatId);
        onCharacterResponse(character.id, chatId);
        syncPendingEvents();
      }, delayMs);

      const event: ScheduledEvent = {
        id: eventId,
        characterId: character.id,
        chatId,
        type: 'response',
        scheduledFor,
        timeoutId,
      };

      scheduledEventsRef.current.set(eventId, event);
    });

    syncPendingEvents();
  }, [enabled, clearTimerForCharacter, startTyping, stopTyping, onCharacterResponse, syncPendingEvents]);

  /**
   * Schedule phase start messages
   * Called when entering a new phase
   */
  const schedulePhaseMessages = useCallback((
    characters: Character[],
    delays: Record<string, number>,
    getChatId: (charId: string) => string
  ) => {
    if (!enabled) return;

    characters.forEach(character => {
      const delay = delays[character.id] || 2000;
      const chatId = getChatId(character.id);
      const eventId = `phase_msg_${character.id}_${Date.now()}`;
      const scheduledFor = new Date(Date.now() + delay);

      // Start typing a bit before
      const typingStartDelay = Math.max(0, delay - 1500);
      const typingTimerId = setTimeout(() => {
        startTyping(character.id, chatId);
      }, typingStartDelay);
      typingTimersRef.current.set(`typing_${character.id}`, typingTimerId);

      const timeoutId = setTimeout(() => {
        scheduledEventsRef.current.delete(eventId);
        stopTyping(character.id, chatId);
        onCharacterResponse(character.id, chatId);
        syncPendingEvents();
      }, delay);

      const event: ScheduledEvent = {
        id: eventId,
        characterId: character.id,
        chatId,
        type: 'phase-message',
        scheduledFor,
        timeoutId,
      };

      scheduledEventsRef.current.set(eventId, event);
    });

    syncPendingEvents();
  }, [enabled, startTyping, stopTyping, onCharacterResponse, syncPendingEvents]);

  /**
   * Schedule a nudge (player timeout reminder)
   */
  const scheduleNudge = useCallback((
    characterId: string,
    chatId: string,
    delaySeconds: number
  ) => {
    if (!enabled) return;

    clearTimerForCharacter(characterId, 'nudge');

    const eventId = `nudge_${characterId}_${Date.now()}`;
    const scheduledFor = new Date(Date.now() + delaySeconds * 1000);

    const timeoutId = setTimeout(() => {
      scheduledEventsRef.current.delete(eventId);
      onNudge(characterId, chatId);
      syncPendingEvents();
    }, delaySeconds * 1000);

    const event: ScheduledEvent = {
      id: eventId,
      characterId,
      chatId,
      type: 'nudge',
      scheduledFor,
      timeoutId,
    };

    scheduledEventsRef.current.set(eventId, event);
    syncPendingEvents();
  }, [enabled, clearTimerForCharacter, onNudge, syncPendingEvents]);

  /**
   * Cancel a scheduled nudge (player responded in time)
   */
  const cancelNudge = useCallback((characterId: string) => {
    clearTimerForCharacter(characterId, 'nudge');
  }, [clearTimerForCharacter]);

  /**
   * Get list of pending scheduled events (for debugging)
   */
  const getPendingEvents = useCallback(() => {
    return Array.from(scheduledEventsRef.current.values());
  }, []);

  return {
    scheduleDMResponse,
    scheduleGroupResponses,
    scheduleNudge,
    schedulePhaseMessages,
    cancelNudge,
    cancelAllForCharacter,
    clearAllTimers,
    typingStates,
    pendingEvents,
    getPendingEvents,
  };
}
