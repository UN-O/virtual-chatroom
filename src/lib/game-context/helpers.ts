/**
 * helpers.ts — 純函式工具集（無 React 依賴）
 *
 * 包含：
 *  - generateId          隨機 ID 產生器
 *  - initializeNewSession 建立全新的遊戲 session
 *  - getChatRooms        從 session 衍生出 UI 用的聊天室列表
 */

import { storyPlot, characters, groups } from '../story-data';
import type { ClientSession, ChatRoom, GameSession, Phase } from '../types';

/** 產生 7 碼隨機英數字 ID */
export const generateId = (): string =>
    Math.random().toString(36).substring(2, 9);

/** 1 虛擬分鐘 = 幾毫秒真實時間（2 真實分鐘 = 60 虛擬分鐘） */
export const VIRTUAL_TIME_RATIO_MS = 2000;

/**
 * 根據 phase 的虛擬時間起點 + 真實偏移毫秒數，計算虛擬時間標籤。
 * 速率：1 虛擬分鐘 = VIRTUAL_TIME_RATIO_MS 真實毫秒
 */
export function computeVirtualTimeLabel(phaseVirtualTime: string, offsetMs: number): string {
    const [h, m] = phaseVirtualTime.split(':').map(Number);
    const total = h * 60 + m + Math.floor(offsetMs / VIRTUAL_TIME_RATIO_MS);
    const clamped = Math.max(0, Math.min(23 * 60 + 59, total));
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * 從虛擬時間 from → to 需要多少真實毫秒。
 * 例：from="09:00", to="14:00" → 300 虛擬分鐘 × 2000ms = 600000ms（10 真實分鐘）
 */
export function virtualTimeToRealMs(fromVirtualTime: string, toVirtualTime: string): number {
    const [fh, fm] = fromVirtualTime.split(':').map(Number);
    const [th, tm] = toVirtualTime.split(':').map(Number);
    const diffMins = (th * 60 + tm) - (fh * 60 + fm);
    return Math.max(0, diffMins) * VIRTUAL_TIME_RATIO_MS;
}

/**
 * 取得此 phase 自動推進的虛擬時間目標（所有 branch nextPhase 中最早的 virtualTime）。
 * 若沒有 branch（ending phase）則回傳 null。
 */
export function getPhaseCapVirtualTime(currentPhase: Phase, phases: Phase[]): string | null {
    if (!currentPhase.branches.length) return null;
    const nextVirtualTimes = currentPhase.branches
        .map(b => phases.find(p => p.id === b.nextPhaseId)?.virtualTime)
        .filter((vt): vt is string => vt != null);
    if (!nextVirtualTimes.length) return null;
    return nextVirtualTimes.reduce((min, vt) => {
        const [mh, mm] = min.split(':').map(Number);
        const [vh, vm] = vt.split(':').map(Number);
        return vh * 60 + vm < mh * 60 + mm ? vt : min;
    });
}

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

    // 將 phase ID 對應到 OnlineSchedule 的鍵名
    // phase IDs: morning, afternoon, ending_good, ending_bad
    // OnlineSchedule keys: dawn, morning, noon, afternoon, evening, night
    const phaseToScheduleKey = (phaseId: string): keyof import('../types').OnlineSchedule | null => {
        if (phaseId === 'morning') return 'morning';
        if (phaseId === 'afternoon') return 'afternoon';
        if (phaseId.startsWith('ending')) return 'evening';
        return null;
    };

    // 每個角色對應一個 DM 聊天室
    const dmRooms: ChatRoom[] = Object.values(characters).map(char => {
        const lastMsg = session.messages
            .filter(m =>
                (m.senderId === char.id && m.chatId === char.id) ||
                (m.senderType === 'player' && m.chatId === char.id)
            )
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

        const scheduleKey = phaseToScheduleKey(session.currentPhaseId);
        const isOnline = scheduleKey != null ? char.onlineSchedule[scheduleKey] : false;

        return {
            id: char.id,
            type: 'dm',
            name: char.profile.name,
            avatarUrl: char.profile.avatarUrl,
            characterId: char.id,
            lastMessage: lastMsg?.content,
            lastMessageTime: lastMsg ? new Date(lastMsg.createdAt) : undefined,
            unreadCount: 0,
            isOnline
        };
    });

    // 每個群組對應一個群組聊天室（群組永遠顯示為在線）
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
            unreadCount: 0,
            isOnline: true
        };
    });

    return [...dmRooms, ...groupRooms];
};
