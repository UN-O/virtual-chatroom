"use client"
import { createContext, useContext } from 'react';
import type { GameSession, ClientSession, GameState, ChatRoom, TypingState, Phase } from '../types';

/**
 * GameContextType
 * 定義所有元件可以透過 useGame() 存取的狀態與操作。
 */
export interface GameContextType {
    // ── 唯讀狀態 ──────────────────────────────────────────
    session: GameSession | null;       // 完整的遊戲 session（含訊息、角色狀態）
    gameState: GameState | null;       // 衍生的 UI 狀態（canFastForward 等）
    sessions: ClientSession[];         // 所有已存 session 列表（首頁用）
    isLoading: boolean;
    activeChatId: string | null;       // 目前開啟的聊天室 ID
    chatRooms: ChatRoom[];             // DM + 群組的聊天室列表
    typingStates: TypingState[];       // 正在打字的角色（由 VirtualTime hook 維護）
    debugMode: boolean;

    // ── 操作 ──────────────────────────────────────────────
    /** 玩家發送訊息。chatId 可以是角色 ID（DM）或群組 ID */
    sendMessage: (chatId: string, content: string, type?: 'text' | 'sticker', stickerId?: string) => Promise<void>;

    createSession: () => string;
    loadSession: (sessionId: string) => void;
    deleteSession: (sessionId: string) => void;
    setActiveChat: (chatId: string | null) => void;

    /** Debug 用：強制推進到下一個 phase */
    debugFastForward: () => void;

    /** 排程 DM 角色回應（內部包裝 useVirtualTime） */
    scheduleDMResponse: (characterId: string, delayMs: number) => void;
    /** 排程群組角色回應（內部包裝 useVirtualTime） */
    scheduleGroupResponse: (groupId: string, characterId: string, delayMs: number) => void;

    getCurrentPhase: () => Phase | undefined;
    advancePhase: () => void;
    toggleDebugMode: () => void;

    getCharacterName: (characterId: string) => string | null;
    /** 回傳指定聊天室中目前正在打字的角色 ID 列表 */
    getTypingCharacters: (chatId: string) => string[];
}

export const GameContext = createContext<GameContextType | undefined>(undefined);

/** 在任意元件內存取遊戲狀態與操作 */
export const useGame = (): GameContextType => {
    const context = useContext(GameContext);
    if (context === undefined) {
        throw new Error('useGame 必須在 <GameProvider> 內使用');
    }
    return context;
};
