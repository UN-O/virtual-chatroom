import { useCallback, useRef, useEffect } from 'react';
import type { ScheduledEvent } from '@/lib/types';

interface UseVirtualTimeOptions {
  onNudge: (characterId: string, chatId: string) => void;
  enabled: boolean;
}

interface UseVirtualTimeReturn {
  scheduleNudge: (characterId: string, chatId: string, delaySeconds: number) => void;
  cancelNudge: (characterId: string) => void;
  cancelAllForCharacter: (characterId: string) => void;
  clearAllTimers: () => void;
  getPendingEvents: () => ScheduledEvent[];
}

/**
 * Virtual Time Engine Hook
 *
 * Manages nudge timers only. Character response delays are handled
 * directly in provider.tsx using the t_delay pattern:
 *   1. API fired immediately when player sends a message
 *   2. elapsed = time API took; remaining = max(0, t_delay - elapsed)
 *   3. Message shown + 已讀 marked after remaining ms
 */
export function useVirtualTime(options: UseVirtualTimeOptions): UseVirtualTimeReturn {
  const { onNudge, enabled } = options;

  const scheduledEventsRef = useRef<Map<string, ScheduledEvent>>(new Map());

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!enabled) clearAllTimers(); return () => clearAllTimers(); }, [enabled]);

  const clearAllTimers = useCallback(() => {
    scheduledEventsRef.current.forEach(event => {
      if (event.timeoutId) clearTimeout(event.timeoutId);
    });
    scheduledEventsRef.current.clear();
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
  }, []);

  const cancelAllForCharacter = useCallback((characterId: string) => {
    clearTimerForCharacter(characterId);
  }, [clearTimerForCharacter]);

  const scheduleNudge = useCallback((
    characterId: string,
    chatId: string,
    delaySeconds: number
  ) => {
    if (!enabled) return;
    clearTimerForCharacter(characterId, 'nudge');

    const eventId = `nudge_${characterId}_${Date.now()}`;
    const timeoutId = setTimeout(() => {
      scheduledEventsRef.current.delete(eventId);
      onNudge(characterId, chatId);
    }, delaySeconds * 1000);

    scheduledEventsRef.current.set(eventId, {
      id: eventId,
      characterId,
      chatId,
      type: 'nudge',
      scheduledFor: new Date(Date.now() + delaySeconds * 1000),
      timeoutId,
    });
  }, [enabled, clearTimerForCharacter, onNudge]);

  const cancelNudge = useCallback((characterId: string) => {
    clearTimerForCharacter(characterId, 'nudge');
  }, [clearTimerForCharacter]);

  const getPendingEvents = useCallback(() => {
    return Array.from(scheduledEventsRef.current.values());
  }, []);

  return {
    scheduleNudge,
    cancelNudge,
    cancelAllForCharacter,
    clearAllTimers,
    getPendingEvents,
  };
}
