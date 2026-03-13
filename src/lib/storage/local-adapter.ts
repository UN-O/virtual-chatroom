import { ClientSession, GameSession } from '@/lib/types';

const STORAGE_KEY_PREFIX = 'story-chat-session-';
const CURRENT_SESSION_KEY = 'story-chat-current-session-id';

export class LocalSessionAdapter {
  // Save a session to local storage
  static saveSession(session: ClientSession): void {
    if (typeof window === 'undefined') return;
    
    // Update active timestamp
    const updatedSession = { ...session, lastActiveAt: new Date() };
    
    // Serialization with Date handling
    const serialized = JSON.stringify(updatedSession);
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${session.id}`, serialized);
  }

  // Load a specific session by ID
  static loadSession(sessionId: string): ClientSession | null {
    if (typeof window === 'undefined') return null;

    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    if (!stored) return null;

    try {
      const session = JSON.parse(stored, (key, value) => {
        // Hydrate Date objects
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
          return new Date(value);
        }
        return value;
      });
      return session as ClientSession;
    } catch (e) {
      console.error('Failed to parse session', e);
      return null;
    }
  }

  // Get the ID of the last active session
  static getLastActiveSessionId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(CURRENT_SESSION_KEY);
  }

  // Set the current active session ID
  static setLastActiveSessionId(sessionId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(CURRENT_SESSION_KEY, sessionId);
  }

  // List all available sessions (simple scan)
  static listSessions(): ClientSession[] {
    if (typeof window === 'undefined') return [];
    
    const sessions: ClientSession[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        const sessionId = key.replace(STORAGE_KEY_PREFIX, '');
        const session = this.loadSession(sessionId);
        if (session) {
          sessions.push(session);
        }
      }
    }
    // Sort by last active descending
    return sessions.sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  }

  // Delete a session
  static deleteSession(sessionId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(`${STORAGE_KEY_PREFIX}${sessionId}`);
    
    // If it was the current one, clear the pointer
    const current = this.getLastActiveSessionId();
    if (current === sessionId) {
      localStorage.removeItem(CURRENT_SESSION_KEY);
    }
  }

  // Clear all sessions (Debug/Reset)
  static clearAll(): void {
    if (typeof window === 'undefined') return;
    
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX) || key === CURRENT_SESSION_KEY) {
        keysToRemove.push(key!);
      }
    }
    
    keysToRemove.forEach(k => localStorage.removeItem(k));
  }
}
