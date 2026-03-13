# lib/game-context

遊戲核心狀態管理模組。
透過 React Context 將遊戲狀態與操作提供給所有子元件。

---

## 目錄結構

```
lib/game-context/
├── README.md       ← 本文件
├── index.ts        ← 統一出口（re-exports）
├── context.ts      ← GameContextType 介面 + createContext + useGame hook
├── helpers.ts      ← 純函式工具（無 React 依賴）
└── provider.tsx    ← GameProvider 元件（核心邏輯）
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

### `provider.tsx`
`<GameProvider>` 元件，負責：

1. **Session CRUD** — 建立、載入、刪除進度（`LocalSessionAdapter` / LocalStorage）
2. **Virtual Time Engine** — 使用 `useVirtualTime` hook 管理所有計時排程：
   - `onCharacterResponse` → 呼叫 `/api/chat`（action: respond），寫入訊息 + 更新 PAD
   - `onNudge` → 呼叫 `/api/event/nudge`，在玩家久未回應時讓角色催促
3. **Schedule Wrappers** — 包裝 hook API，對外提供簡化介面 `(characterId, delayMs)`
4. **sendMessage** — 寫入玩家訊息 + 觸發 DM / 群組角色回應排程
5. **Phase Management** — `advancePhase`（評估 branch conditions + 呼叫 `/api/event/phase-start`）

### `index.ts`
統一出口，讓所有現有的 `@/lib/game-context` import 不需要改動路徑：

```ts
export { GameContext, useGame } from './context';
export type { GameContextType } from './context';
export { GameProvider } from './provider';
export { generateId, initializeNewSession, getChatRooms } from './helpers';
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
  const { session, sendMessage, activeChatId, typingStates } = useGame();
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
                           （onCharacterResponse, onNudge, advancePhase）
```

React 的 useState 在 async callback 內會捕捉到舊值（stale closure）。
`sessionRef` 透過 `useEffect` 即時同步，確保 callback 永遠讀到最新 session。

### Typing State 所有權

```
useVirtualTime hook ─── 內部管理 typingStates ───▶ 透過 context 傳出
                                                          │
                                              getTypingCharacters(chatId)
```

`typingStates` 完全由 `useVirtualTime` 管理，**不在 provider 另開 state**。
避免雙重來源造成的不一致問題。

### Virtual Time → LLM 流程

```
玩家發送訊息
  └─▶ sendMessage(chatId, content)
        ├─ DM：vtScheduleDM(char, chatId, 1.5s, arousal)
        │       └─▶ [1.5s 後] onCharacterResponse(charId, chatId)
        │                 └─▶ POST /api/chat { action: 'respond' }
        │                       └─▶ 寫入訊息 + 更新 PAD + 啟動 nudge(45s)
        │
        └─ Group：vtScheduleGroup(members, chatId, memberStates, baseDelays)
                  └─▶ 對各成員做 shouldRespond() 機率判斷
                        └─▶ [delay 後] onCharacterResponse(charId, groupId)
                                  └─▶ POST /api/chat { action: 'respond' }
```

---

## 外部依賴

| 模組 | 用途 |
|------|------|
| `@/hooks/useVirtualTime` | 計時排程與 typing indicator |
| `@/lib/engine/phase` | `determineNextPhase`, `areAllGoalsAchieved` |
| `@/lib/engine/pad` | PAD 計算（由 useVirtualTime 內部使用） |
| `@/lib/storage/local-adapter` | LocalStorage 持久化 |
| `@/lib/story-data` | 故事、角色、群組靜態資料 |
| `@/lib/types` | 所有 TypeScript 型別定義 |

---

## API Routes 呼叫清單

| Route | 觸發時機 | 傳入 |
|-------|----------|------|
| `POST /api/chat` | DM 或群組角色回應 | `{ action, characterId, chatHistory, currentPad, memory, phaseGoal, ... }` |
| `POST /api/event/nudge` | 玩家 45 秒未回應 | `{ characterId, chatId, chatHistory, characterState, phaseGoal, nudgeCount }` |
| `POST /api/event/phase-start` | phase 推進 | `{ phaseId, characterStates, chatHistories }` |
