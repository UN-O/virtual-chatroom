# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13（更新：2026-03-13 branch claude/start-todo-modifications-T0BHo）
> 基準：`files/STORY_DESIGN.md` 所描述的完整功能

---

## 現況總結

UI shell 已完整（GameLayout / ChatList / ChatWindow / TimeBar / DebugPanel）。
資料層完整（story-data、types、LLM functions F1–F6、API routes）。
**但核心遊戲迴圈完全斷線** — `sendMessage` 只存 mock 訊息，沒有任何 LLM 呼叫真正觸發。
`useVirtualTime` hook 雖然完整撰寫，卻從未被 `GameProvider` 使用。

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
  - 玩家送出訊息後：F1 透過 `useVirtualTime.scheduleDMResponse` 排程角色回覆
  - F3（analyze PAD）+ F5（checkGoal）平行在背景執行，完成後靜默更新 `characterStates`
  - F4（updateMemory）在 F3 完成後非同步執行
  - 已同時清除 `game-context.tsx` 中的孤立程式碼（TS1128 語法錯誤）

- [x] **`useVirtualTime` hook 已整合進 `GameProvider`**
  - `onCharacterResponse` callback 呼叫 `/api/chat?action=respond`（F1）生成角色回覆
  - 群組回覆透過 `scheduleGroupResponses` 管理
  - Nudge 透過 `onNudge` callback 呼叫 `/api/event/nudge`

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

## P3 — 群組對話靜默失敗

- [ ] **`scheduleGroupResponse` 只有 `console.log`，完全沒實作**
  - 群組聊天室裡角色永遠不會主動回應玩家
  - docs 規格：玩家在群組發訊 → 觸發 F6（decideGroup）→ 若 shouldRespond=true → F2（groupRespond）
  - 需連接 `useVirtualTime.scheduleGroupResponses` → `/api/event/char-respond`

- [ ] **群組的 PAD 更新邏輯未設計**
  - DM 的 F3/F4/F5 呼叫後會更新 charState，但群組訊息的情緒影響應套用到所有在線角色
  - 需決定：群組訊息是否也執行 F3 analyze（對每個角色分別）

---

## P4 — Nudge 系統未接線

- [ ] **玩家沉默時沒有任何 nudge 觸發**
  - `/api/event/nudge` route 已完整寫好，角色有 `failNudge` 文字
  - 但 `GameProvider` 裡完全沒有任何計時器監測玩家沉默
  - 需在 DM 回應排程後（F1），同時用 `useVirtualTime.scheduleNudge` 排入 nudge timer
  - 玩家有回應時，呼叫 `cancelNudge` 取消

---

## P4.5 — 訊息時間戳記顯示錯誤（顯示真實時間而非遊戲時間）

- [ ] **ChatWindow 訊息時間用 `new Date()` 的真實時鐘**
  - `formatMessageTime` 呼叫 `date.toLocaleTimeString()`，顯示的是系統時間（如 15:32）
  - 應顯示遊戲虛擬時間（如 09:05、09:12...），讓玩家沈浸在故事情境
  - 設計方案：`Message.createdAt` 繼續存 `Date`（方便排序），但額外存一個 `virtualTime: string` 欄位，或在渲染時根據 session 的 phase virtualTime + 訊息在 phase 內的相對偏移換算
  - 最簡做法：每則訊息加 `virtualTimeLabel: string`，在寫入 session 時由 `GameProvider` 填入（以當前 phase 的 `virtualTime` 為基礎，用真實經過時間推算偏移分鐘數）
  - `TimeBar` 顯示的 `session.virtualTime` 已是虛擬時間，兩者要一致

---

## P4.6 — LLM 呼叫應非阻塞、前端優先顯示

- [ ] **F1（生成角色回覆）阻塞住整個訊息流，其他動作都要等它**
  - 目前設計是：等 F1 完成 → 顯示訊息 → 再跑 F3/F4/F5
  - 應改成「打字中顯示 → F1 完成立刻插入訊息 → F3/F5 在背景平行跑，完成才更新 PAD/goal」
  - 前端感受：角色訊息儘早出現，情緒/goal 更新是後台靜默完成的

- [ ] **F3 / F5 應完全平行，不互相等待**
  - 目前 `/api/chat` 的 `respond` action 已有 `Promise.all([F1, F3])`，但 F5 沒有一起並發
  - 理想執行順序：
    ```
    玩家送出訊息
      ├─ [立刻] 顯示玩家訊息泡泡
      ├─ [立刻] 顯示角色打字中指示器
      ├─ [平行] F1 生成角色回覆  → 完成立刻渲染訊息泡泡
      ├─ [平行] F3 分析 PAD delta → 完成靜默更新 charState.pad
      ├─ [平行] F5 檢查 goal      → 完成靜默更新 charState.goalAchieved
      └─ [F3 完成後] F4 更新記憶   → 完成靜默更新 charState.memory
    ```
  - 關鍵：F1 的顯示不等 F3/F5，F3/F5 也不等 F1

- [ ] **`isLoading` 粒度太粗，整個輸入列會 freeze**
  - `gameState.isLoading` 全局為 true 期間，ChatWindow 的送出按鈕是 disabled
  - 應改成每個 chat room 有獨立的 `isSending` 狀態，或只在 F1 pending 時禁用，F3/F5 跑的期間不應阻擋輸入

---

## P4.7 — 角色主動發訊行為（Proactive / Nudge）

- [ ] **角色應能主動分多則訊息傳送（不是只有一個泡泡）**
  - 目前 F1 只生成一則訊息（一個 `content: string`）
  - 真實聊天體驗：角色可能先傳一句短的，停一下，再傳一句補充（LINE / WeChat 風格）
  - 設計方案：F1 回傳改成 `messages: string[]`，`GameProvider` 用 `schedulePhaseMessages` 把每則用不同 delay 依序插入
  - 每則訊息之間的 delay 參考 `speechStyle.verbosity`（話多的角色訊息更多、間隔更短）

- [ ] **玩家沉默超過一定時間，角色應主動打破沉默（非 nudge 類）**
  - 現有 nudge 是有 `failNudge` 文字的 phase-goal 相關催促
  - 但角色也應有更自然的「隔一段時間沒人說話，我來說點什麼」行為
  - 觸發時機應分成兩種：
    1. **Goal nudge（現有邏輯）**：玩家超過 X 秒沒回應，角色送出 `failNudge` 文字（已有 API route）
    2. **Idle chat（新）**：在 phase 內沒有特定目的的閒聊，增加自然感（選配，P5 等級）
  - 計時器應在每次**玩家送出訊息**或**角色送出訊息**後 reset

- [ ] **Nudge 計時器還未接線（原 P4 項目，在此補充細節）**
  - 每個 `CharacterPhaseMission` 有 `failNudge: string | null`
  - 觸發邏輯：
    - DM phase：角色送出第一則 phase-start 訊息後，開始計時（建議 60–90 秒）
    - 玩家回覆後：計時器 reset
    - 再次超時：呼叫 `/api/event/nudge` 傳入 `nudgeCount`（第幾次 nudge）
    - `nudgeCount >= 2` 且 goal 未達成：PAD P 應稍微下降（加壓力感）

---

## P5 — 細節 / 完整度缺口

- [ ] **`unreadCount` 永遠是 0**
  - `getChatRooms()` 算出來一律 0，切換聊天室時也不清零
  - 需在角色訊息進來時，若不是 activeChatId 則 +1；切換 chat 時清零

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
| API Routes | ✅ 100% | P0 欄位 bug 已修正，phase-start 孤立程式碼已清除 |
| UI Shell | ✅ 90% | 結構完整，缺貼圖 / expression |
| useVirtualTime | ✅ 100% | 已整合進 GameProvider，onCharacterResponse / onNudge 已接線 |
| 訊息虛擬時間戳記 | ❌ 0% | 全顯示真實時鐘（P4.5，待處理）|
| LLM 非阻塞並行呼叫 | ✅ 80% | F1 透過 vtScheduleDM 非阻塞，F3+F5 Promise.all 平行，F4 背景 |
| 角色多則訊息 / 主動發訊 | ❌ 0% | F1 只返回單則，nudge 計時器已接但計數未追蹤（P4.7）|
| GameProvider 狀態管理 | ✅ 90% | 核心迴圈已接線，canFastForward 已計算，status 已更新 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ✅ 85% | F1/F3/F4/F5 均已觸發，PAD/goal/memory 均會更新 |
| Phase 推進 / 分支 | ✅ 80% | branch 條件評估正確，ending status 已設，phase-start 已觸發 |
| 群組對話 | ⚠️ 50% | scheduleGroupResponses 已接，但群組 F3/F5 分析尚未處理 |
| Nudge 系統 | ✅ 70% | route 有，onNudge 已接線；nudgeCount 追蹤尚未實作 |
