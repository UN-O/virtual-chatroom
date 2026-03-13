/**
 * helpers.ts — 純函式工具集（無 React 依賴）
 *
 * 包含：
 *  - generateId          隨機 ID 產生器
 *  - initializeNewSession 建立全新的遊戲 session
 *  - getChatRooms        從 session 衍生出 UI 用的聊天室列表
 */

import { storyPlot, characters, groups } from '../story-data';
import type { ClientSession, ChatRoom, GameSession } from '../types';

/** 產生 7 碼隨機英數字 ID */
export const generateId = (): string =>
    Math.random().toString(36).substring(2, 9);

/**
 * 建立一個全新的 ClientSession。
 * 依照 storyPlot.phases[0] 初始化 phase，
 * 依照各角色的 padConfig.initial 初始化 PAD 狀態。
 */
export const initializeNewSession = (): ClientSession => {
    const sessionId = generateId();
    const initialPhase = storyPlot.phases[0];

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
        userId: 'user-1',
        version: 1,
        status: 'active',
        currentPhaseId: initialPhase.id,
        progressLabel: initialPhase.progressLabel,
        virtualTime: initialPhase.virtualTime,
        characterStates: charStates,
        messages: [],
        startedAt: new Date(),
        lastActiveAt: new Date()
    };
};

/**
 * 從 session 衍生出 ChatRoom 列表（DM + 群組）。
 * 純計算，不含副作用。
 */
export const getChatRooms = (session: GameSession | null): ChatRoom[] => {
    if (!session) return [];

    // 每個角色對應一個 DM 聊天室
    const dmRooms: ChatRoom[] = Object.values(characters).map(char => {
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
            characterId: char.id,
            lastMessage: lastMsg?.content,
            lastMessageTime: lastMsg ? new Date(lastMsg.createdAt) : undefined,
            unreadCount: 0
        };
    });

    // 每個群組對應一個群組聊天室
    const groupRooms: ChatRoom[] = groups.map(group => {
        const lastMsg = session.messages
            .filter(m => m.chatId === group.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        return {
            id: group.id,
            type: 'group',
            name: group.name,
            avatarUrl: group.avatarUrl,
            groupId: group.id,
            lastMessage: lastMsg?.content,
            lastMessageTime: lastMsg ? new Date(lastMsg.createdAt) : undefined,
            unreadCount: 0
        };
    });

    return [...dmRooms, ...groupRooms];
};
