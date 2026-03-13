# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13（更新：2026-03-13 branch claude/review-commits-docs-RQ1pc）
> 基準：`files/STORY_DESIGN.md` 所描述的完整功能

---

## 現況總結

UI shell 已完整（GameLayout / ChatList / ChatWindow / TimeBar / DebugPanel）。
資料層完整（story-data、types、LLM functions F1–F6、API routes）。
核心遊戲迴圈已接線，DM 與群組均可觸發 LLM 回應，PAD/goal/memory 均會更新。
訊息現在顯示遊戲虛擬時間，ChatList 有未讀計數，群組訊息也會更新角色情緒。

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

- [ ] **nudgeCount 追蹤尚未實作**
  - 目前 nudge API 永遠收到 `nudgeCount: 1`，無法實現「第二次 nudge 加壓力」行為
  - 需在 provider 追蹤每個 chatId 的 nudge 次數（`nudgeCountRef`），每次 nudge 後 +1，玩家回覆後 reset

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

- [ ] **`isLoading` 粒度太粗**
  - `gameState.isLoading` 目前只用於初始載入（已改善），但 ChatWindow 仍有 `disabled={gameState?.isLoading}` 判斷
  - 如需更細粒度（per-chatRoom isSending），可在未來追加

---

## P4.7 — 角色主動發訊行為

- [x] **F1 多泡泡輸出已實作**
  - F1 回傳 `CharacterMessageBurst { messages: MessageBubble[], expressionKey }` 陣列
  - `GameProvider` 用 `BUBBLE_GAP=800ms` 間隔依序插入每則泡泡

- [ ] **nudgeCount 升壓邏輯（見 P4）**

---

## P5 — 細節 / 完整度缺口

- [x] **`unreadCount` 已實作**
  - `GameProvider` 使用 `useEffect` 偵測新角色訊息，若 `chatId !== activeChatId` 則 +1
  - `setActiveChat` 切換時自動清零對應 chatId 的計數
  - `chatRooms` useMemo 合併 `unreadCounts` 覆蓋 `getChatRooms()` 的預設值 0
  - commit: claude/review-commits-docs-RQ1pc

- [ ] **貼圖功能只有資料沒有 UI**
  - `Character.stickerPack` 有定義貼圖
  - `Message.stickerId` 有欄位
  - `sendMessage` 有 `type: 'sticker'` 參數
  - 但 ChatWindow 的輸入列沒有貼圖按鈕，訊息氣泡也沒有渲染貼圖圖片

- [ ] **角色表情（expressionKey）從未作用於 UI**
  - F1/F2 回傳 `expressionKey`（happy / angry / sad / neutral）
  - ChatList / ChatWindow 的 Avatar 圖片永遠是 `profile.avatarUrl`
  - 應改成根據當前 PAD（`getExpressionFromPAD`）動態選 `avatarExpressions[key]`

- [ ] **Phase 最長時間（`maxRealMinutes`）未強制執行**
  - `morning` = 7 分鐘、`afternoon` = 8 分鐘，超時應強制推進（或至少 nudge）
  - 目前沒有任何 timer 監控

- [ ] **在線時間表（`onlineSchedule`）未檢查**
  - 每個角色有 `onlineSchedule`（早中午下午...）
  - 排程回應前應確認角色「在線」，離線時不生成回覆

- [ ] **`src/styles/globals.css` 為死代碼**
  - 是 shadcn 預設模板，沒有 chat 的 CSS 變數
  - App 實際使用的是 `src/app/globals.css`（已有完整的 `--chat-*` 變數）
  - 這個檔案可以刪除，避免混淆

---

## 完成度概覽

| 層次 | 完成度 | 說明 |
|------|--------|------|
| 資料定義（types / story-data）| ✅ 100% | 完整 |
| LLM 函數 F1–F6 | ✅ 100% | 全部實作，有 fallback |
| API Routes | ✅ 100% | P0 欄位 bug 已修正 |
| UI Shell | ✅ 90% | 結構完整，缺貼圖 / expression |
| useVirtualTime | ✅ 100% | nudge 計時器接線，t_delay 模式運作 |
| 訊息虛擬時間戳記 | ✅ 100% | virtualTimeLabel 欄位 + phaseStartedAtRef 計算 |
| LLM 非阻塞並行呼叫 | ✅ 90% | F1 t_delay，F3+F5 Promise.all，F4 背景；isLoading 粒度尚可改進 |
| 角色多則訊息 / 主動發訊 | ✅ 80% | F1 多泡泡完成；nudgeCount 追蹤待補 |
| GameProvider 狀態管理 | ✅ 95% | 核心迴圈、canFastForward、unreadCount、virtualTimeLabel 均完整 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ✅ 90% | F1/F2/F3/F4/F5 均觸發，PAD/goal/memory 更新正確 |
| Phase 推進 / 分支 | ✅ 85% | branch 條件正確，phase timer 已 reset |
| 群組對話 | ✅ 85% | F2 回應 + F3 PAD 更新均已實作 |
| Nudge 系統 | ✅ 75% | 45 秒計時器接線；nudgeCount 升壓待補 |
| unreadCount | ✅ 100% | useEffect 偵測 + setActiveChat 清零 |
