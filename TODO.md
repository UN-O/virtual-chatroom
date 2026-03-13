# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13（更新：2026-03-13 branch agent-afad26f8 — Branch 3: TimeBar + CharacterAvatar）
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

- [ ] **貼圖功能只有資料沒有 UI**
  - `Character.stickerPack` 有定義貼圖
  - `Message.stickerId` 有欄位
  - `sendMessage` 有 `type: 'sticker'` 參數
  - 但 ChatWindow 的輸入列沒有貼圖按鈕，訊息氣泡也沒有渲染貼圖圖片

- [ ] **貼圖規格應改為 emoji，不應再沿用圖片貼圖路線**
  - 目前 `Sticker.path` 與 `stickerPack` 都是 PNG 路徑設計，較接近 LINE 圖片貼圖，不符合目前產品方向「表情貼圖 = emoji」
  - `MessageBubble.type` 雖支援 `sticker`，但 generator / UI 都沒有 emoji payload 與顯示規格
  - 若要改成 emoji，需重定義資料模型（例如 `emoji`, `label`, `tone`, `padCondition`），並讓輸入列與訊息泡泡直接渲染 emoji，而不是讀取圖檔
  - 相關位置：`src/lib/types.ts`、`src/lib/story-data.ts`、`src/lib/llm/generator.ts`、`src/components/chat/ChatWindow.tsx`

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

- [ ] **在線時間表（`onlineSchedule`）已確認行為規格**
  - 每個角色有 `onlineSchedule`（早中午下午...）
  - **行為規格（v3 澄清）**：離線時玩家仍可傳訊，角色**仍會回應**，但：
    1. 自動施加 PAD Pleasure 負向 delta（建議 p: -0.15，被打擾懲罰）
    2. F1 prompt 加入 `isOnline: false` + `wantToBeDisturbed: false` 旗標
    3. LLM 生成語氣帶不悅/不情願，符合角色個性（e.g. 老闆：冷淡簡短；同事：抱怨）
  - 需修改：`use-send-message.ts`（判斷在線 + 施加 PAD 懲罰）、`generator.ts`（F1 prompt 加旗標）、`types.ts`（F1 input 型別）

- [ ] **小林在群組裡仍有機率用 DM 語境回覆，存在頻道污染 / 頻道錯置**
  - `handleGroup()` 目前把 `groupHistory` 與該角色的 `memberDmHistory` 混成 `combinedHistory` 後直接送進 F2，群組 prompt 因此收到跨頻道上下文
  - `generator.ts` 的 `formatChatHistory()` 是用 `msg.chatId === character.id` 判斷 `[私訊]`，其餘一律標成 `[群組]`；在混合歷史下，模型很容易延續私訊語氣或把對象當成一對一
  - 這個問題對小林特別明顯，因為她在不同 phase 同時有 `group` 與 `dm` 任務，語氣本來就差異大，混用歷史會放大錯置
  - 需釐清策略：
    1. 群組回應只吃同一 `groupId` 的歷史
    2. DM 歷史若要參考，只能以獨立 memory/summarized context 注入，不可直接混在 group transcript
    3. F2 prompt 應明確標記當前回覆目標頻道與收件對象
  - 相關位置：`src/lib/game-context/use-send-message.ts`、`src/lib/llm/generator.ts`、`src/app/api/chat/route.ts`

- [x] **`src/styles/globals.css` 為死代碼**
  - 已刪除，App 實際使用 `src/app/globals.css`
  - commit: claude/review-and-plan-4R7EZ

---

## P_v3 — v3 架構文件比對新增缺口（程式碼結構）

> 對照「系統架構文件 v3」發現，以下結構差距需補齊（不需外部服務）

- [ ] **抽取 `lib/engine/memory.ts` 獨立模組**
  - v3 spec 明確列出 `lib/engine/memory.ts` 作為獨立引擎檔案
  - 目前 F4 `llmUpdateMemory` 混在 `lib/llm/analyzer.ts` 中
  - 應遷移至 `src/lib/engine/memory.ts`，`analyzer.ts` 改為呼叫它

- [x] **新增 `components/CharacterAvatar.tsx` 元件**
  - 已建立 `src/components/chat/CharacterAvatar.tsx`
  - props：`avatarUrl`, `name`, `pad?`, `expressionKey?`, `avatarExpressions?`, `className?`, `fallbackClassName?`
  - 使用 `getExpressionFromPAD(pad)` 計算表情，`expressionKey` 可覆蓋，fallback 到 `avatarUrl`
  - ChatList / ChatWindow 已全面替換
  - commit: Branch 3 feat

- [ ] **支援 Claude Sonnet 作為 LLM provider**
  - v3 spec 指定使用 Claude Sonnet（Vercel AI SDK）
  - 目前 `config.ts` 只支援 OpenAI / Google
  - 新增 `ANTHROPIC_API_KEY` 判斷，優先順序：OpenAI > Anthropic > Google
  - model id：`claude-sonnet-4-6`
  - **需要**：`ANTHROPIC_API_KEY` 環境變數 + `@ai-sdk/anthropic` 套件

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

## 完成度概覽

| 層次 | 完成度 | 說明 |
|------|--------|------|
| 資料定義（types / story-data）| ✅ 100% | 完整 |
| LLM 函數 F1–F6 | ✅ 100% | 全部實作，有 fallback |
| API Routes | ✅ 100% | P0 欄位 bug 已修正 |
| UI Shell | ✅ 85% | re-entry guard、scroll 已修；online status dot 已接線；TimeBar 狀態模型、貼圖/emoji、expression 仍未完成 |
| useVirtualTime | ✅ 100% | nudge 計時器接線，t_delay 模式運作 |
| 訊息虛擬時間戳記 | ✅ 100% | virtualTimeLabel 欄位 + phaseStartedAtRef 計算 |
| LLM 非阻塞並行呼叫 | ✅ 95% | F1 t_delay，F3+F5 Promise.all，F4 背景；isLoading 粒度已改為 per-ChatWindow isSending |
| 角色多則訊息 / 主動發訊 | ✅ 95% | F1 多泡泡完成；nudgeCount 追蹤已實作 |
| GameProvider 狀態管理 | ✅ 95% | 核心迴圈、canFastForward、unreadCount、virtualTimeLabel 均完整 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ✅ 90% | F1/F2/F3/F4/F5 均觸發，PAD/goal/memory 更新正確 |
| Phase 推進 / 分支 | ✅ 90% | branch 條件正確，phase timer reset，maxRealMinutes 強制執行 |
| 群組對話 | ✅ 75% | F2 回應 + F3 PAD 更新已接線，但仍有群組 / DM 頻道污染風險 |
| Nudge 系統 | ✅ 95% | 45 秒計時器接線；nudgeCount 升壓已實作 |
| unreadCount | ✅ 100% | useEffect 偵測 + setActiveChat 清零 |
| 程式碼結構（v3 對齊）| 🔲 60% | 缺 memory.ts 模組、CharacterAvatar 元件、Claude provider |
| 在線時間表（onlineSchedule）| 🔲 70% | isOnline 欄位已接線至 ChatRoom + ChatList 狀態點；離線 PAD 懲罰邏輯待補 |
| 資料庫遷移（v3 DB）| 🔲 0% | 需 Neon + Clerk，暫緩 |
