# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13（更新：2026-03-13 branch claude/review-and-plan-4R7EZ — feat: emoji sticker system + P_BUG 深度掃描 + P_EDU 演練循環對齊計劃）
> 基準：`files/STORY_DESIGN.md` + **系統架構文件 v3**

---

## 現況總結

UI shell 已完整（GameLayout / ChatList / ChatWindow / TimeBar / DebugPanel）。
資料層完整（story-data、types、LLM functions F1–F6、API routes）。
核心遊戲迴圈已接線，DM 與群組均可觸發 LLM 回應，PAD/goal/memory 均會更新。
訊息現在顯示遊戲虛擬時間，ChatList 有未讀計數，群組訊息也會更新角色情緒。

**2026-03-13 v3 架構比對補充：**
已對照「系統架構文件 v3」做完整缺口分析，新增 P_v3 區塊（程式碼結構補齊）和 P_DB 區塊（資料庫遷移，需外部服務）。onlineSchedule 行為規格亦在此次分析中澄清（詳見 P5 更新）。

---

## P0 — 會 crash 的 Bug（TypeScript 型別錯誤 / 執行期崩潰）

- [x] **ChatWindow 呼叫不存在的 context 方法**
  - `getCharacterName` 和 `getTypingCharacters` 已在 `game-context.tsx` 實作並暴露於 `GameContextType`
  - 已確認 ChatWindow 正確呼叫這兩個函數

- [x] **ChatWindow `sendMessage` 簽名不符**
  - `sendMessage(chatId, content, type?, stickerId?)` 簽名已對齊，ChatWindow 正確呼叫

- [x] **`/api/event/phase-start` 讀取不存在的欄位**
  - 已改為使用 `phase.characterMissions`（正確欄位），並加入 try/catch + fallback
  - 同時修正 group chat ID：`'group_general'` → `groups[0].id`（`'group_office'`）
  - 清除 route 末端的孤立程式碼（TypeScript TS1128 語法錯誤）

- [x] **`/api/event/char-respond` 和 `/api/event/nudge` 用錯欄位**
  - 已將 `character.initialPad` 修正為 `character.padConfig.initial`

---

## P1 — 核心遊戲迴圈斷線（遊戲根本無法玩）

- [x] **`sendMessage` 已接線真實 LLM 流程（DM）**
  - 玩家送出訊息後：F1 透過 t_delay 模式非阻塞生成角色回覆
  - F3（analyze PAD）+ F5（checkGoal）平行在背景執行，完成後靜默更新 `characterStates`
  - F4（updateMemory）在 F3 完成後非同步執行

- [x] **`useVirtualTime` hook 已整合進 `GameProvider`**
  - Nudge 計時器由 `useVirtualTime` 管理，45 秒後觸發

- [x] **Phase start 訊息已觸發**
  - `loadSession` 若 session 無訊息（新遊戲），自動呼叫 `/api/event/phase-start`
  - `advancePhase` 推進後亦呼叫 `/api/event/phase-start`，回傳訊息依序插入 session

- [x] **`canFastForward` 已正確計算**
  - 使用 `areAllGoalsAchieved(currentPhase, session.characterStates)` 動態計算
  - 當前 phase 所有角色 `goalAchieved=true` 時，快進按鈕才啟用

---

## P2 — Phase 推進邏輯錯誤（結局分支失效）

- [x] **`advancePhase` 已正確評估 branch condition**
  - 使用 `determineNextPhase(currentPhase, storyPlot.phases, characterStates)` 評估分支條件
  - 可正確進入 `ending_good` / `ending_bad`

- [x] **session `status` 在 ending phase 設為 `'completed'`**
  - `advancePhase` 推進到 id 以 `'ending'` 開頭的 phase 時，自動設 `status: 'completed'`

---

## P3 — 群組對話

- [x] **群組回應已實作（F2 + shouldRespond）**
  - 玩家在群組發訊 → 對每個成員做 `shouldRespond()` 機率判斷 → F2（groupRespond）
  - t_delay 模式：立即打 API，完成後 remaining 才顯示
  - commit: claude/review-commits-docs-RQ1pc

- [x] **群組的 PAD 更新邏輯已實作**
  - 群組訊息後，對每個要回應的成員平行執行 F3（analyze）
  - F2 與 F3 以 `Promise.all()` 平行呼叫，PAD delta 靜默更新 characterStates
  - commit: claude/review-commits-docs-RQ1pc

---

## P4 — Nudge 系統

- [x] **Nudge 計時器已接線（45 秒）**
  - 角色所有泡泡顯示完後開始計時，玩家回覆後取消
  - 呼叫 `/api/event/nudge`，回傳訊息插入 session

- [x] **nudgeCount 追蹤尚未實作**
  - `nudgeCountRef` 已加入 `provider.tsx`，每次 nudge 觸發前 +1，玩家回覆 DM 後 reset
  - `UseSendMessageOptions` 新增 `resetNudgeCount` 選項；`handleDM` 頂部呼叫 `resetNudgeCount(chatId)`
  - commit: feat: Branch 2 — nudgeCount escalation, onlineSchedule UI, phase timeout enforcement

---

## P4.5 — 訊息時間戳記

- [x] **虛擬時間標籤已實作**
  - `Message` 加 `virtualTimeLabel?: string` 欄位
  - `GameProvider` 新增 `phaseStartedAtRef`（在 loadSession / advancePhase reset）
  - `computeVirtualTimeLabel(phaseVirtualTime, offsetMs)` 計算偏移虛擬時間
  - `ChatWindow` 優先顯示 `virtualTimeLabel`，fallback 到真實時鐘
  - commit: claude/review-commits-docs-RQ1pc

---

## P4.6 — LLM 呼叫非阻塞

- [x] **F1 非阻塞（t_delay 模式）**
  - 立即打 API，完成後 max(0, tDelay - elapsed) 才顯示訊息

- [x] **F3 + F5 平行執行**
  - `Promise.all([F3, F5])` 平行，F4 在 F3 完成後 fire-and-forget

- [x] **`isLoading` 粒度太粗**
  - ChatWindow 改用本地 `isSending` state，不再依賴 `gameState.isLoading`
  - commit: claude/review-and-plan-4R7EZ

---

## P4.7 — 角色主動發訊行為

- [x] **F1 多泡泡輸出已實作**
  - F1 回傳 `CharacterMessageBurst { messages: MessageBubble[], expressionKey }` 陣列
  - `GameProvider` 用 `BUBBLE_GAP=800ms` 間隔依序插入每則泡泡

- [x] **nudgeCount 升壓邏輯（見 P4）**
  - nudge API 現在收到正確的累計次數，LLM 可依次數調整施壓強度

---

## P5 — 細節 / 完整度缺口

- [x] **`unreadCount` 已實作**
  - `GameProvider` 使用 `useEffect` 偵測新角色訊息，若 `chatId !== activeChatId` 則 +1
  - `setActiveChat` 切換時自動清零對應 chatId 的計數
  - `chatRooms` useMemo 合併 `unreadCounts` 覆蓋 `getChatRooms()` 的預設值 0
  - commit: claude/review-commits-docs-RQ1pc

- [x] **TimeBar 需要重構成「劇情進度 + phase 時間」雙軌狀態**
  - 實作雙軌：Track 1（劇情總進度）+ Track 2（Phase 倒數計時器，amber色系）
  - `phaseStartedAt` 已作為 reactive state 暴露於 GameContextType，TimeBar 每 100ms 更新
  - 80%+ 時間消耗顯示紅色警示，剩餘分鐘數即時顯示
  - commit: Branch 3 feat

- [x] **聊天室 UI 存在重複送出風險，會一次送兩則相同玩家訊息**
  - `ChatWindow.handleSend()` 新增本地 `isSending` state 作為 re-entry guard
  - Enter / 送出按鈕統一走 `handleSend()`，開頭立即檢查 `isSending`，`finally` 中 reset
  - 送出按鈕與 Input 均 `disabled={isSending}`，完全消除雙重觸發風險
  - commit: claude/review-and-plan-4R7EZ

- [x] **聊天室捲動行為不穩**
  - 新增獨立的 `useEffect` 依賴 `activeChatId`：切換聊天室時立即（instant）捲到底
  - 原本依賴 `messages.length` 的 effect 保留並加 `messages.length > 0` 保護，新訊息用 smooth 捲動
  - commit: claude/review-and-plan-4R7EZ

- [x] **貼圖功能只有資料沒有 UI**
  - `Character.stickerPack` 有定義貼圖
  - `Message.stickerId` 有欄位
  - `sendMessage` 有 `type: 'sticker'` 參數
  - ChatWindow 現已加入貼圖按鈕（😊）、inline 貼圖選取面板（8 個 emoji），以及 sticker 訊息泡泡渲染（大字 emoji）
  - commit: feat: emoji sticker system — redesign from image-based to emoji-based

- [x] **貼圖規格應改為 emoji，不應再沿用圖片貼圖路線**
  - `Sticker` 介面已重定義：`emoji`, `label`, `tone`, `padCondition`（移除 `path`, `emotion`）
  - `stickerPack` 已更新：char_boss（7 個 emoji，職業/嚴肅系）、char_coworker（8 個 emoji，輕鬆/表情系）
  - `MessageBubble` 新增 `emojiContent?: string` 欄位，`messageBurstSchema` 同步更新
  - ChatWindow 玩家可用 8 個通用 emoji 貼圖，角色 sticker 訊息以大字 emoji 渲染
  - commit: feat: emoji sticker system — redesign from image-based to emoji-based

- [~] **角色表情（expressionKey）從未作用於 UI**（部分完成）
  - [x] `CharacterAvatar` 元件已建立，支援 `expressionKey` 覆蓋與 PAD 自動計算表情
  - [x] ChatList（DM 頭像）與 ChatWindow（訊息泡泡）均已改用 `<CharacterAvatar>`
  - [ ] `profile.avatarExpressions` 在 story-data 中目前是空物件 `{}`，需補充各表情圖片 URL 才能完整運作

- [x] **側邊欄沒有顯示角色上線狀態，`onlineSchedule` 尚未進入 UI state**
  - `ChatRoom` 新增 `isOnline?: boolean` 欄位（`types.ts`）
  - `getChatRooms()` 依 `currentPhaseId` 對應 `OnlineSchedule` 鍵名計算 `isOnline`；群組永遠為 `true`
  - `ChatList` 頭像容器疊加 online/offline 狀態點：綠色（在線）/ 灰色（離線），無未讀時才顯示
  - commit: feat: Branch 2 — nudgeCount escalation, onlineSchedule UI, phase timeout enforcement

- [x] **Phase 最長時間（`maxRealMinutes`）未強制執行**
  - `provider.tsx` 新增 `useEffect`：phase 切換時啟動 `phaseTimeoutRef` 計時器
  - 超時後自動呼叫 `advancePhase()`；ending phase 或 session 非 active 時不啟動
  - effect cleanup 清除計時器，避免 phase 提早快進後重複觸發
  - commit: feat: Branch 2 — nudgeCount escalation, onlineSchedule UI, phase timeout enforcement

- [x] **在線時間表（`onlineSchedule`）離線 PAD 懲罰邏輯已實作**
  - `use-send-message.ts` 的 `handleDM()` 新增 `getOnlineScheduleKey()` 判斷 phase → schedule 鍵名
  - 角色離線時，玩家傳訊立即施加 PAD P -0.15 懲罰（setSession 同步更新）
  - `isOnline` 旗標傳入 `/api/chat` route，再傳給 `llmGenerateCharacterMessage`
  - `generator.ts` 的 `buildScriptwriterPrompt()` 離線時在場景區塊顯示警示，指示 LLM 生成不悅/簡短語氣
  - commit: claude/review-and-plan-4R7EZ

- [x] **小林在群組裡仍有機率用 DM 語境回覆，存在頻道污染 / 頻道錯置**
  - `handleGroup()` 已修正：移除 `memberDmHistory` 混入，群組回應現在只使用同一 `groupId` 的歷史
  - F2 + F3 均只接收純群組歷史，消除跨頻道上下文污染
  - commit: claude/review-and-plan-4R7EZ

- [x] **`src/styles/globals.css` 為死代碼**
  - 已刪除，App 實際使用 `src/app/globals.css`
  - commit: claude/review-and-plan-4R7EZ

---

## P_v3 — v3 架構文件比對新增缺口（程式碼結構）

> 對照「系統架構文件 v3」發現，以下結構差距需補齊（不需外部服務）

- [x] **抽取 `lib/engine/memory.ts` 獨立模組**
  - `src/lib/engine/memory.ts` 已建立，包含 `llmUpdateMemory` (F4)
  - `src/lib/llm/analyzer.ts` 改為 `export { llmUpdateMemory } from '../engine/memory'` re-export
  - commit: refactor: extract llmUpdateMemory into lib/engine/memory.ts

- [x] **新增 `components/CharacterAvatar.tsx` 元件**
  - 已建立 `src/components/chat/CharacterAvatar.tsx`
  - props：`avatarUrl`, `name`, `pad?`, `expressionKey?`, `avatarExpressions?`, `className?`, `fallbackClassName?`
  - 使用 `getExpressionFromPAD(pad)` 計算表情，`expressionKey` 可覆蓋，fallback 到 `avatarUrl`
  - ChatList / ChatWindow 已全面替換
  - commit: Branch 3 feat

- [x] **支援 Claude Sonnet 作為 LLM provider**
  - 安裝 `@ai-sdk/anthropic`
  - `config.ts` 新增 Anthropic provider，優先順序：OpenAI > Anthropic > Google
  - model id：`claude-sonnet-4-6`（`ANTHROPIC_API_KEY` 環境變數）
  - `getLLMProvider()` / `getModel()` / `getModelByProvider()` 均已更新
  - commit: claude/review-and-plan-4R7EZ

---

## P_DB — v3 架構資料庫遷移（需外部服務，暫緩）

> v3 spec 要求 Neon PostgreSQL + Drizzle ORM，需外部帳號才能實作

- [ ] **建立 `lib/db/schema.ts`（Drizzle Schema）**
  - Tables：`users`, `stories`, `characters`, `game_sessions`, `character_states`, `messages`, `phase_progress`
  - 參考 v3 doc Section 7 的完整 SQL schema

- [ ] **建立 `lib/db/index.ts`（Neon 連線）**
  - 使用 `@neondatabase/serverless` + Drizzle ORM
  - 需 `DATABASE_URL` 環境變數（Neon connection string）

- [ ] **身份驗證（Clerk 或 NextAuth）**
  - v3 spec 提到 `auth_provider_id`（外部 user ID）
  - 需決定使用 Clerk SDK 或 NextAuth
  - 需外部帳號設定

- [ ] **從 localStorage 遷移至 DB**
  - 替換 `lib/storage/local-adapter.ts` 的所有呼叫點
  - GameProvider 改為呼叫 DB API routes 存取 session
  - 影響：`provider.tsx`, `use-send-message.ts`, `use-phase-manager.ts`

---

---

## P_BUG — 掃描發現的潛在問題（2026-03-13）

> 以下問題由深度靜態分析掃描發現，涵蓋 React 狀態管理、型別安全、LLM 呼叫、遊戲邏輯、持久化、效能六大面向。

---

### React 狀態管理 / 競態條件

- [ ] **[BUG] PAD delta 雙重套用：F1 與獨立 F3 各自對同一則玩家訊息套用 padDelta**
  - File: `src/lib/game-context/use-send-message.ts:192-248` (F1 result) and `:308-329` (F3 result)
  - Problem: `/api/chat?action=respond` (F1) 在 server 端內部已同時呼叫 `llmAnalyzePlayerMessage`（F3）並在回應中回傳 `padDelta`；client 在 F1 回應抵達後套用一次 padDelta（`:231-248`），然後 client 又另外平行發出 `action=analyze` 再做一次 F3 分析（`:283-293`），完成後再套用第二次 padDelta（`:312-325`）。同一則玩家訊息的情緒影響被計算並套用了兩次。
  - Impact: PAD 值偏移量是設計值的兩倍；角色情緒惡化或改善速度是預期的兩倍，ending 分支條件的觸發閾值會在錯誤的時機被達到，影響故事走向。
  - Fix: 二選一：(A) 讓 `action=respond` 的 server 不執行 F3（移除 `handleRespond` 內 Promise.all 中的 `llmAnalyzePlayerMessage`），把 F1 response 中的 padDelta 欄位移除；(B) 移除 client 端平行發出的獨立 `action=analyze` 呼叫，改為直接使用 F1 回傳的 padDelta 作為唯一來源。

- [ ] **[BUG] `goalAchieved` phase 切換後不重置，導致新 phase 的 goal 在開始時就是「已達成」**
  - File: `src/lib/game-context/use-phase-manager.ts:64-70`
  - Problem: `advancePhase` 的 `setSession` 更新 `currentPhaseId` / `virtualTime` / `status`，但沒有重置 `characterStates[x].goalAchieved`。每個 phase 的 goal 不同，但進入新 phase 時角色的 `goalAchieved` 帶著前一個 phase 的結果。導致：(a) `areAllGoalsAchieved` 在新 phase 開始時立即回傳 true；(b) `canFastForward` 在 afternoon phase 第一幀就可能為 true；(c) F5 的 `currentlyAchieved=true` early return 讓 goal check 永不再執行。
  - Impact: 玩家在 afternoon phase 開始的瞬間可以再次點快進，跳過整個 afternoon phase 直接進入 ending。這是核心遊戲迴圈的重大缺陷。
  - Fix: 在 `advancePhase` 的 `setSession` callback 中，重置所有 `characterStates[id].goalAchieved = false`（每次 phase 切換時）。

- [ ] **[RISK] loadSession 的 phase-start setTimeout 回調沒有 cleanup，若組件卸載後計時器仍觸發，setSession 會寫入已不存在的 session**
  - File: `src/lib/game-context/provider.tsx:127-162`
  - Problem: `loadSession` 啟動一系列 `setTimeout`（最長 `1500 + n*2000` ms），這些計時器沒有被任何 cleanup 機制追蹤。若使用者在訊息顯示完之前切換 session 或離開頁面，setSession 仍會被呼叫，`prev` 可能指向不同的 session 或 null。在 React Strict Mode 下 double-invoke 也會造成重複開場訊息。
  - Impact: 初始開場訊息可能被寫入錯誤的 session；重複呼叫 loadSession 後出現雙份開場訊息。
  - Fix: 用 `useRef` 追蹤這些計時器並在適當時機清除，或在 setSession 回調中加 `prev?.id === expectedSessionId` 的 guard。

- [ ] **[RISK] 群組多成員並行 F3 PAD delta 更新存在競態，後 resolve 的更新會覆蓋先 resolve 的**
  - File: `src/lib/game-context/use-send-message.ts:424-445`
  - Problem: `handleGroup` 對每個群組成員各自啟動一個 `Promise.all([F2, F3])`。當多個成員同時 resolve 時，每個成員的 `.then` 回調各自執行 `setSession(prev => ...)` 更新自己的 PAD。若角色 A 和角色 B 的 F3 同時 resolve，這兩個 setSession 回調都從 `prev.characterStates` 讀取後算出新值——但因為 React 的 setState 是 functional（不是 merged），兩個針對不同 characterId 的更新實際上是獨立的，不會互相覆蓋。然而若兩次 setSession 都試圖更新同一個 characterId（不太可能但 group 成員重疊時有機率），後者會覆蓋前者。
  - Impact: 在多成員群組同時回應的罕見場景下，其中一個成員的 PAD 更新可能丟失。
  - Fix: 將 F3 padDelta 合併到訊息插入的 setSession 回調（合為一次 setState）。

- [ ] **[RISK] `useVirtualTime` 的 useEffect 依賴陣列省略了 `clearAllTimers`，可能引用到過時的函式版本**
  - File: `src/hooks/useVirtualTime.ts:32`
  - Problem: `useEffect(() => { if (!enabled) clearAllTimers(); return () => clearAllTimers(); }, [enabled])` 故意省略了 `clearAllTimers`（用 eslint-disable 抑制警告）。`clearAllTimers` 用 `useCallback([])` 建立，ref 本身穩定，但這是「意外穩定」而非「設計穩定」——如果 `clearAllTimers` 的依賴陣列未來被修改，effect 會引用到舊版本的函式。
  - Impact: 目前無直接 bug，但這是脆弱的設計，未來修改 `clearAllTimers` 時可能造成計時器洩漏。
  - Fix: 在 effect 依賴陣列中明確加入 `clearAllTimers`，接受 effect 在 `clearAllTimers` ref 改變時重新執行。

---

### 型別安全

- [ ] **[RISK] `initializeNewSession` 的 charStates 使用 `Record<string, any>` 繞過型別檢查**
  - File: `src/lib/game-context/helpers.ts:37`
  - Problem: `const charStates: Record<string, any> = {}` 允許意外的欄位結構寫入 session，TypeScript 不會報錯。
  - Impact: 若 `CharacterState` 新增必填欄位，編譯器不會在此處報錯，runtime 會讀到 undefined。
  - Fix: 改為 `const charStates: Record<string, CharacterState> = {}`。

- [ ] **[RISK] F1 回應的 `data?.messages` 是 `any` 型別，cast 成 `Array<{ content: string }>` 沒有 runtime 保護**
  - File: `src/lib/game-context/use-send-message.ts:193`
  - Problem: `fetch().then(r => r.json())` 回傳 `any`，TypeScript 不會在 `const burst: Array<{ content: string }> = data?.messages` 的 cast 處報錯。若 API 回傳格式改變或 LLM 解析失敗，`burst[0].content` 會拋出 runtime TypeError。
  - Impact: API 回應格式不符時 client 端靜默崩潰，訊息不顯示也沒有使用者可見的錯誤提示。
  - Fix: 加入 `Array.isArray(data?.messages) && data.messages.length > 0` guard，或用 Zod 解析 API 回應。

- [ ] **[RISK] `phase.ts` 的 goal condition regex 忽略 phaseId 欄位，跨 phase 的 goal 狀態無法正確區分**
  - File: `src/lib/engine/phase.ts:67-73`
  - Problem: `goal_(\w+)_(\w+)_achieved` 解析後只用 `characterId` 查 `characterStates`，完全忽略 `phaseId`。`goalAchieved` 是 `CharacterState` 上的單一 boolean，前一個 phase 的達成狀態會被帶入新 phase 的分支條件評估。
  - Impact: 與上方 [BUG] goalAchieved 不重置的問題結合，導致 afternoon → ending 的分支條件在 afternoon 開場瞬間即可通過。
  - Fix: 在 `CharacterState` 加入 `goalAchievedByPhase: Record<string, boolean>` per-phase 追蹤，或在 phase 切換時重置 `goalAchieved`（見上方 BUG fix）。

- [ ] **[RISK] `ChatWindow` 的 `formatMessageTime` 假設 `createdAt` 一定是 Date 物件，localStorage 反序列化後若 reviver 失敗則為 string，呼叫 `.toLocaleTimeString()` 會 crash**
  - File: `src/components/chat/ChatWindow.tsx:249-251`
  - Problem: `local-adapter.ts` 用 regex reviver 嘗試將 ISO date string 還原成 Date，但若任何訊息的 `createdAt` 因格式不符 regex 而殘留為 string，`formatMessageTime(date)` 會拋出 `TypeError: date.toLocaleTimeString is not a function`。
  - Impact: 頁面 refresh 後的 session 載入可能造成 ChatWindow 整個崩潰（白畫面）。
  - Fix: `const d = date instanceof Date ? date : new Date(date as string); return d.toLocaleTimeString(...)`。

---

### LLM 呼叫問題

- [ ] **[BUG] 每則 DM 訊息觸發兩次 F3 LLM 呼叫（server 端 F1 內部 + client 端獨立 analyze），造成雙倍 API 費用**
  - File: `src/app/api/chat/route.ts:101-126` (server F3) and `src/lib/game-context/use-send-message.ts:281-293` (client F3)
  - Problem: `handleRespond` server 端用 `Promise.all([llmGenerateCharacterMessage, llmAnalyzePlayerMessage])` 同時執行 F1 和 F3，並回傳 padDelta。client 的 `handleDM` 又對同一訊息另外發出 `action=analyze` 執行第二次 F3。這與「PAD delta 雙重套用」是同一根本原因：兩條路徑完全獨立運作。
  - Impact: 每則 DM 訊息耗費兩份 F3 的 LLM API token，在高流量下費用可能翻倍。
  - Fix: 與 PAD delta 雙重套用的 fix 相同——統一只用一條路徑執行 F3。

- [ ] **[RISK] `llmCheckGoalAchieved` (F5) fallback 的 default 分支過於寬鬆——「玩家說超過 5 字元」即視為 goal 達成**
  - File: `src/lib/llm/analyzer.ts:287-291`
  - Problem: `checkGoalFallback` 的 default 分支 `achieved: recentPlayerMessages.length > 5`——只要玩家最近說了超過 5 個字元，goal 就算達成。當 LLM API 失敗（rate limit、key 過期等），fallback 邏輯會讓 `goalAchieved` 被設為 true，進而解鎖 `canFastForward`。
  - Impact: API 故障期間玩家可以直接快進到 ending，完全繞過敘事進程。
  - Fix: 將 default fallback 改為保守策略 `achieved: false`（等 LLM 恢復再判斷）。

- [ ] **[RISK] `llmGenerateCharacterMessage` (F1) 的 `providerOptions` 有 Google 特有的 `thinkingConfig`，但 F2 沒有，兩個函式行為不一致**
  - File: `src/lib/llm/generator.ts:53-57`
  - Problem: F1 傳入 `providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } }` 停用 Google Gemini 的 thinking，F2 沒有這個設定（使用 model 預設）。在 Google provider 下，F1 和 F2 的推理能力不一致。
  - Impact: Google provider 下 F2 群組回應可能使用 thinking（消耗更多 token / 時間），而 F1 DM 回應不使用；兩者成本與延遲不一致。
  - Fix: 在 `config.ts` 的 `getModel()` 統一處理 provider-specific options，或確保 F1/F2 都有相同設定。

- [ ] **[RISK] Nudge 不檢查 `goalAchieved` 狀態，goal 已達成的角色仍會繼續催促玩家**
  - File: `src/lib/game-context/provider.tsx:245-288`
  - Problem: nudge `onNudge` callback 只檢查 `session.status === 'active'`，不檢查 `characterStates[characterId].goalAchieved`。goal 達成後角色沒有理由繼續催促，但 nudge 計時器 45 秒後仍會觸發並生成催促訊息。
  - Impact: Goal 達成後角色仍傳出催促訊息，破壞敘事邏輯（boss 說「你交報告了嗎」但其實已收到）。
  - Fix: 在 `onNudge` callback 開頭加入 `if (cur.characterStates[characterId]?.goalAchieved) return;`。

---

### 遊戲邏輯問題

- [ ] **[RISK] Phase timeout useEffect 不含 `advancePhase` 於依賴陣列，存在 stale closure 風險**
  - File: `src/lib/game-context/provider.tsx:220-232`
  - Problem: `phaseTimeoutRef` 的 setTimeout 呼叫 `advancePhase`，但 `useEffect` 的依賴陣列是 `[session?.currentPhaseId, session?.status]`，`advancePhase` 不在其中（並用 eslint-disable 抑制）。若未來 `advancePhase` 的 `useCallback` 依賴改變，timeout 引用的是舊版本。
  - Impact: 目前因為 `sessionRef` 是穩定 ref 且 `setSession` 是穩定 dispatch，實際不會觸發，但這是脆弱假設，未來重構時容易造成無聲 bug。
  - Fix: 將 `advancePhase` 加入 useEffect 依賴陣列。

- [ ] **[RISK] `shouldRespond()` 使用 `Math.random()` 做群組回應決策，無法重現，debug 困難**
  - File: `src/lib/engine/pad.ts:35-38`
  - Problem: 純隨機決策使得同一個 session 狀態無法重現相同的群組回應行為。在 `responsivenessBase` 較低時（如 0.3），boss 可能在大部分情況下完全不回應群組，造成敘事斷裂。
  - Impact: 玩家在群組的互動效果不可預測；debug 時無法穩定重現問題場景。
  - Fix: 在 DebugPanel 顯示目前的 shouldRespond 機率值；或考慮用確定性 threshold 取代隨機數。

---

### localStorage 持久化問題

- [ ] **[RISK] `listSessions()` 在迭代 localStorage 時呼叫 `loadSession()`，若另一個 tab 同時寫入，迭代中的 length 可能改變**
  - File: `src/lib/storage/local-adapter.ts:54-70`
  - Problem: `for (let i = 0; i < localStorage.length; i++)` 迭代期間呼叫 `this.loadSession()`，多 tab 場景下 localStorage 的 key 順序可能因外部寫入變動，導致某些 session 被跳過或重複讀取。
  - Impact: 多 tab 使用時 session 列表可能不完整。低優先度，但多 tab 下容易造成困惑。
  - Fix: 先用 `for (let i = 0; i < localStorage.length; i++) { keys.push(localStorage.key(i)!); }` 收集所有 key 到陣列後再迭代。

- [ ] **[PERF] session state 任何變動（PAD delta、新訊息）都觸發整個 session 序列化寫入 localStorage，高頻同步寫入可能造成 UI jank**
  - File: `src/lib/game-context/provider.tsx:182-194`
  - Problem: `useEffect([session])` 在每次 session 有任何變動時呼叫 `LocalSessionAdapter.saveSession()`，序列化整個 session 物件（包含所有歷史訊息）。`localStorage.setItem` 是同步阻塞的。F3+F5 是並行的各自觸發一次 setSession，每次訊息插入又觸發一次；每秒可能有 3-4 次大型同步寫入。
  - Impact: 低階裝置或訊息量大（>50 則）時，頻繁同步序列化可能造成明顯 UI jank（輸入框延遲、動畫卡頓）。
  - Fix: 對 `saveSession` 呼叫加 debounce（建議 500ms），確保快速連續的狀態更新只觸發一次寫入。

- [ ] **[RISK] `getChatRooms` sort 使用 `new Date(m.createdAt)` 做比較，若 createdAt 反序列化失敗殘留為非標準 string，sort comparator 會得到 NaN 導致排序行為未定義**
  - File: `src/lib/game-context/helpers.ts:87`
  - Problem: `new Date(nonStandardString).getTime()` 回傳 `NaN`，sort comparator 回傳 `NaN`，等同於 0，排序行為依 JS engine 實作而定（不保證穩定）。
  - Impact: ChatList 的最後訊息時間排序可能在 localStorage 資料不完整時顯示亂序。
  - Fix: 在 sort comparator 加入 `isNaN(time) ? 0 : time` 保護。

---

### 效能問題

- [ ] **[PERF] `chatRooms` useMemo 依賴整個 `session` 物件，任何訊息或 PAD 更新都會重新計算所有 ChatRoom（含 O(n) filter+sort）**
  - File: `src/lib/game-context/provider.tsx:326-329`
  - Problem: `useMemo(() => getChatRooms(session), [session, unreadCounts])` 依賴整個 session，`getChatRooms` 對每個角色/群組執行 filter+sort 計算 `lastMessage`，複雜度隨訊息數量 O(n) 增長。每次 PAD delta 更新都觸發此計算。
  - Impact: 高訊息量時（>100 則），每次 PAD 更新造成不必要的 ChatRoom 重計算。
  - Fix: 將 useMemo 依賴改為 `[session?.messages.length, session?.currentPhaseId, unreadCounts]`，只在真正影響 ChatRoom 顯示的狀態改變時重算。

- [ ] **[PERF] `gameState` useMemo 包含整個 `session` 物件，任何 session 變動都導致所有消費 `useGame()` 的組件重渲染**
  - File: `src/lib/game-context/provider.tsx:331-349`
  - Problem: `gameState` 包含 `session`（大物件）。session 任何變動（PAD、訊息、goal）都建立新的 `gameState` reference，所有消費 `useGame()` 的組件（GameLayout、ChatList、ChatWindow、TimeBar、DebugPanel）全部重渲染。目前沒有任何 `React.memo` 保護。
  - Impact: 每次 PAD 更新或訊息插入造成整個遊戲 UI 全體重渲染，在低階裝置或動畫密集場景下可能造成輸入延遲。
  - Fix: 考慮拆分 context（session context、ui context）或使用 context selector；至少對 `ChatList` 加 `React.memo`（不需要每次 PAD 更新都重渲染）。

---

## 完成度概覽

| 層次 | 完成度 | 說明 |
|------|--------|------|
| 資料定義（types / story-data）| ✅ 100% | 完整 |
| LLM 函數 F1–F6 | ✅ 100% | 全部實作，有 fallback |
| API Routes | ✅ 100% | P0 欄位 bug 已修正 |
| UI Shell | ✅ 95% | TimeBar 雙軌重構完成；CharacterAvatar 元件完成；貼圖系統改為 emoji，ChatWindow 貼圖選取面板 + sticker 泡泡渲染完成；online status UI 已接線 |
| useVirtualTime | ✅ 100% | nudge 計時器接線，t_delay 模式運作 |
| 訊息虛擬時間戳記 | ✅ 100% | virtualTimeLabel 欄位 + phaseStartedAtRef 計算 |
| LLM 非阻塞並行呼叫 | ✅ 95% | F1 t_delay，F3+F5 Promise.all，F4 背景；isLoading 粒度已改為 per-ChatWindow isSending |
| 角色多則訊息 / 主動發訊 | ✅ 95% | F1 多泡泡完成；nudgeCount 追蹤已實作 |
| GameProvider 狀態管理 | ✅ 95% | 核心迴圈、canFastForward、unreadCount、virtualTimeLabel 均完整 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ⚠️ 75% | F1/F2/F3/F4/F5 均觸發，但 PAD delta 雙重套用 BUG + goalAchieved 不重置 BUG 使遊戲邏輯嚴重偏差（見 P_BUG） |
| Phase 推進 / 分支 | ⚠️ 80% | branch 條件正確，maxRealMinutes 強制執行；goalAchieved 不重置導致 afternoon phase 可被立即跳過（見 P_BUG） |
| 群組對話 | ✅ 90% | F2 回應 + F3 PAD 更新已接線；群組/DM 頻道污染已修正（只使用群組歷史） |
| Nudge 系統 | ⚠️ 85% | 45 秒計時器接線；nudgeCount 升壓已實作；但 goalAchieved 後仍會觸發 nudge（見 P_BUG） |
| unreadCount | ✅ 100% | useEffect 偵測 + setActiveChat 清零 |
| 程式碼結構（v3 對齊）| ✅ 100% | CharacterAvatar 元件完成；Claude Sonnet provider 完成；memory.ts 模組已抽取 |
| 在線時間表（onlineSchedule）| ✅ 95% | isOnline 接線、離線 PAD -0.15 懲罰、F1 prompt 離線旗標均已完成 |
| 資料庫遷移（v3 DB）| 🔲 0% | 需 Neon + Clerk，暫緩 |
