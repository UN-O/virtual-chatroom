# lib/game-context

遊戲核心狀態管理模組。
透過 React Context 將遊戲狀態與操作提供給所有子元件。

---

## 目錄結構

```
lib/game-context/
├── README.md              ← 本文件
├── index.ts               ← 統一出口（re-exports）
├── context.ts             ← GameContextType 介面 + createContext + useGame hook
├── helpers.ts             ← 純函式工具（無 React 依賴）
├── provider.tsx           ← GameProvider 元件（組裝所有子 hook）
├── use-send-message.ts    ← useSendMessage hook（DM + 群組訊息發送邏輯）
└── use-phase-manager.ts   ← usePhaseManager hook（Phase 推進邏輯）
```

---

## 各檔案職責

### `context.ts`
定義 **GameContextType** 介面（所有可供元件存取的狀態與操作），
並建立 `GameContext`（`createContext`）與 `useGame` consumer hook。

無副作用，可在任何環境 import。

### `helpers.ts`
純函式工具集，不依賴 React：

| 函式 | 說明 |
|------|------|
| `generateId()` | 產生 7 碼隨機英數字 ID |
| `initializeNewSession()` | 建立全新 `ClientSession`，依 `storyPlot.phases[0]` 初始化 phase，依各角色 `padConfig.initial` 初始化 PAD |
| `getChatRooms(session)` | 從 session 衍生出 `ChatRoom[]`（DM + 群組），含 lastMessage、lastMessageTime |
| `computeVirtualTimeLabel(phaseVirtualTime, offsetMs)` | 以 phase 起始虛擬時間 + 真實偏移毫秒換算虛擬時間標籤（e.g. `"09:05"`） |

### `use-send-message.ts`
**`useSendMessage(options)`** — 封裝訊息發送的完整流程。

接受以下 options：
| 參數 | 型別 | 用途 |
|------|------|------|
| `sessionRef` | `MutableRefObject<ClientSession \| null>` | 避免 stale closure 讀取最新 session |
| `getVirtualTimeLabel` | `() => string` | 取得當前虛擬時間標籤 |
| `vtCancelNudge` | `(characterId) => void` | 取消 nudge 計時器 |
| `vtScheduleNudge` | `(characterId, chatId, seconds) => void` | 排程 nudge 計時器 |
| `setSession` | `Dispatch<SetStateAction<...>>` | 更新 session state |

**DM 流程（t_delay 模式）：**
```
玩家送出訊息
  ├─ 立即插入玩家訊息泡泡（樂觀更新）
  ├─ 立即打 F1 API（不等 t_delay）
  │     └─ 完成後 remaining = max(0, tDelay - elapsed)
  │           └─ setTimeout(remaining)：插入角色泡泡 + 標記已讀 + PAD delta
  │                 └─ 後續泡泡以 BUBBLE_GAP(800ms) 間隔 stagger
  │                       └─ 所有泡泡完成後 scheduleNudge(45s)
  └─ 同步平行打 F3（analyze PAD）+ F5（checkGoal）
        └─ F3 完成後背景打 F4（updateMemory）
```

**群組流程：**
```
玩家在群組送出訊息
  └─ 對每個成員做 shouldRespond() 機率判斷
        └─ Promise.all([F2 groupRespond, F3 analyze])
              ├─ F3 padDelta 靜默更新 characterStates
              └─ F2 content 在 remaining 後顯示
```

### `use-phase-manager.ts`
**`usePhaseManager(options)`** — 封裝 Phase 推進邏輯。

接受以下 options：
| 參數 | 型別 | 用途 |
|------|------|------|
| `sessionRef` | `MutableRefObject<ClientSession \| null>` | 讀取最新 session |
| `phaseStartedAtRef` | `MutableRefObject<number>` | Phase 開始時間，advancePhase 時 reset |
| `setSession` | `Dispatch<SetStateAction<...>>` | 更新 session state |

返回 `{ advancePhase }`。

流程：
1. `determineNextPhase()` 評估 branch conditions
2. Reset `phaseStartedAtRef`，更新 session（currentPhaseId / virtualTime / status）
3. 呼叫 `/api/event/phase-start`，依序用 stagger delay 插入角色主動開場訊息

### `provider.tsx`
**`<GameProvider>`** 元件，組裝所有子模組：

1. **狀態宣告** — session、sessions、activeChatId、isLoading、debugMode、unreadCounts
2. **Shared refs** — sessionRef、phaseStartedAtRef、activeChatIdRef、prevMsgCountRef
3. **getVirtualTimeLabel** — useCallback 封裝，供多個 hook 共用
4. **unreadCounts** — useEffect 偵測新角色訊息，切換 chat 時清零
5. **Session CRUD** — createSession、loadSession（含 phase-start on new game）、deleteSession
6. **Nudge Engine** — `useVirtualTime` hook + onNudge callback
7. **useSendMessage** — 組合注入依賴，得到 `sendMessage`
8. **usePhaseManager** — 組合注入依賴，得到 `advancePhase`
9. **Derived state** — chatRooms（含 unreadCount）、gameState

### `index.ts`
統一出口，讓所有現有的 `@/lib/game-context` import 不需要改動路徑：

```ts
export { GameContext, useGame } from './context';
export type { GameContextType } from './context';
export { GameProvider } from './provider';
export { generateId, initializeNewSession, getChatRooms, computeVirtualTimeLabel } from './helpers';
```

---

## 使用方式

### Provider 掛載（`app/layout.tsx` 或 root）

```tsx
import { GameProvider } from '@/lib/game-context';

export default function RootLayout({ children }) {
  return <GameProvider>{children}</GameProvider>;
}
```

### 任意元件內存取

```tsx
import { useGame } from '@/lib/game-context';

function ChatWindow() {
  const { session, sendMessage, activeChatId } = useGame();
  // ...
}
```

---

## 架構說明

### sessionRef 模式（stale closure 防護）

```
session state ──useEffect──▶ sessionRef.current
                                    │
                           async callbacks 讀取
                           （useSendMessage, usePhaseManager, onNudge）
```

React 的 useState 在 async callback 內會捕捉到舊值（stale closure）。
`sessionRef` 透過 `useEffect` 即時同步，確保 callback 永遠讀到最新 session。

### getVirtualTimeLabel 共用

```
phaseStartedAtRef (reset on loadSession / advancePhase)
        │
getVirtualTimeLabel() = computeVirtualTimeLabel(session.virtualTime, Date.now() - phaseStartedAt)
        │
useSendMessage ── 玩家訊息 / 角色回應泡泡 / nudge 訊息
usePhaseManager ── phase-start 訊息（直接用 computeVirtualTimeLabel）
```

### 模組依賴圖

```
provider.tsx
  ├─ useSendMessage   ← use-send-message.ts
  ├─ usePhaseManager  ← use-phase-manager.ts
  ├─ useVirtualTime   ← @/hooks/useVirtualTime
  ├─ helpers.ts
  └─ context.ts
```

---

## 外部依賴

| 模組 | 用途 |
|------|------|
| `@/hooks/useVirtualTime` | Nudge 計時排程 |
| `@/lib/engine/phase` | `determineNextPhase`, `areAllGoalsAchieved` |
| `@/lib/engine/pad` | `shouldRespond`（在 useSendMessage 群組邏輯使用） |
| `@/lib/storage/local-adapter` | LocalStorage 持久化 |
| `@/lib/story-data` | 故事、角色、群組靜態資料 |
| `@/lib/types` | 所有 TypeScript 型別定義 |

---

## API Routes 呼叫清單

| Route | 觸發時機 | 傳入 |
|-------|----------|------|
| `POST /api/chat` (respond) | DM 角色回應（F1） | characterId, playerMessage, chatHistory, pad, memory... |
| `POST /api/chat` (analyze) | PAD delta 分析（F3） | characterId, playerMessage, chatHistory, pad |
| `POST /api/chat` (checkGoal) | Goal 達成判斷（F5） | goal, completionHint, chatHistory |
| `POST /api/chat` (updateMemory) | 記憶更新（F4） | characterId, previousMemory, playerMessage... |
| `POST /api/chat` (groupRespond) | 群組角色回應（F2） | characterId, groupHistory, pad, memory... |
| `POST /api/event/nudge` | 玩家 45 秒未回應 | characterId, chatId, chatHistory, characterState, phaseGoal, nudgeCount |
| `POST /api/event/phase-start` | Phase 推進 / 新遊戲開場 | phaseId, characterStates, chatHistories |
