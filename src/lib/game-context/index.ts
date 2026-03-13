/**
 * lib/game-context/index.ts — 統一出口
 *
 * 讓所有使用 `@/lib/game-context` 的元件不需要改 import 路徑。
 *
 * 模組結構：
 *   context.ts   — GameContextType interface + createContext + useGame hook
 *   helpers.ts   — 純函式工具（generateId, initializeNewSession, getChatRooms）
 *   provider.tsx — GameProvider React 元件（核心邏輯）
 */

export { GameContext, useGame } from './context';
export type { GameContextType } from './context';

export { GameProvider } from './provider';

export {
    generateId,
    initializeNewSession,
    getChatRooms,
} from './helpers';
