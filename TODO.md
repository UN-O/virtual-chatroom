# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13
> 基準：`files/STORY_DESIGN.md` 所描述的完整功能

---

## 現況總結

UI shell 已完整（GameLayout / ChatList / ChatWindow / TimeBar / DebugPanel）。
資料層完整（story-data、types、LLM functions F1–F6、API routes）。
**但核心遊戲迴圈完全斷線** — `sendMessage` 只存 mock 訊息，沒有任何 LLM 呼叫真正觸發。
`useVirtualTime` hook 雖然完整撰寫，卻從未被 `GameProvider` 使用。

---

## P0 — 會 crash 的 Bug（TypeScript 型別錯誤 / 執行期崩潰）

- [ ] **ChatWindow 呼叫不存在的 context 方法**
  - `getCharacterName(senderId)` — GameContextType 沒有此函數
  - `getTypingCharacters(chatId)` — GameContextType 沒有此函數
  - 需在 `game-context.tsx` 補上這兩個 helper，或在 ChatWindow 改成直接查 `characters[]`

- [ ] **ChatWindow `sendMessage` 簽名不符**
  - ChatWindow 呼叫：`sendMessage(gameState.activeChatId, message)`（2 個參數）
  - GameContextType 定義：`sendMessage(content, type, stickerId?)`
  - 兩者簽名完全不同，必須對齊

- [ ] **`/api/event/phase-start` 讀取不存在的欄位**
  - Route 使用 `phase.triggerOnStart`，但 `Phase` 型別（story-data）的欄位是 `characterMissions`
  - 執行時永遠拿不到觸發資料，所有 phase-start 訊息靜默失敗

- [ ] **`/api/event/char-respond` 和 `/api/event/nudge` 用錯欄位**
  - 兩個 route 都用 `character.initialPad` 作 fallback
  - 正確路徑是 `character.padConfig.initial`，否則執行期拋出 undefined

---

## P1 — 核心遊戲迴圈斷線（遊戲根本無法玩）

- [ ] **`sendMessage` 只儲存 mock 訊息，不呼叫任何 API**
  - 目前：存入玩家訊息 → 1500ms 後插入硬編碼的 "Mock Response from..."
  - 需要改成真正的流程：
    1. 存入玩家訊息
    2. 對 DM：呼叫 `/api/chat` action=`respond`（F1）取得角色回覆
    3. 平行呼叫 `/api/chat` action=`analyze`（F3）取得 PAD delta
    4. 平行呼叫 `/api/chat` action=`checkGoal`（F5）判斷 goal
    5. 根據 F3 結果更新 `session.characterStates[charId].pad`
    6. 根據 F5 結果更新 `session.characterStates[charId].goalAchieved`
    7. F3 完成後呼叫 F4（updateMemory）更新 memory

- [ ] **`useVirtualTime` hook 完全未整合進 `GameProvider`**
  - hook 實作完整但從未被呼叫
  - 需在 `GameProvider` 裡使用 `useVirtualTime`，替換現有的手動 `setTimeout` 邏輯
  - `onCharacterResponse` callback 應觸發真正的 LLM 呼叫

- [ ] **Phase start 訊息從未觸發**
  - 新遊戲開始 / phase 推進後，沒有任何地方呼叫 `/api/event/phase-start`
  - docs 規格：進入 `morning` → 陳副理 DM 說要報告（2s delay）、小林群組問你被找什麼事（5s delay）
  - 需在 `createSession` 後 和 `advancePhase` 後呼叫 phase-start API，再把回傳訊息插入 session

- [ ] **`canFastForward` 永遠是 `false`（hardcoded）**
  - `game-context.tsx` 第 327 行：`canFastForward: false, // TODO`
  - 需計算：當前 phase 所有 `characterMissions` 的 `goalAchieved` 全為 true 時才能快進
  - TimeBar 的快進按鈕因此永遠被 disabled

---

## P2 — Phase 推進邏輯錯誤（結局分支失效）

- [ ] **`advancePhase` 按索引線性推進，不評估 branch condition**
  - 目前：`storyPlot.phases[currentIndex + 1]`，直接跳下一個
  - 需改為呼叫 `/api/phase/advance`（傳入 characterStates），由 `phase.ts` 的 `evaluateCondition` 決定
  - 現在的邏輯永遠不會進到 `ending_good` / `ending_bad` 的分支

- [ ] **session `status` 永遠不會變成 `'completed'`**
  - ending phase 到底時沒有任何地方把 `status` 改成 `'completed'`
  - TimeBar 的「故事結束」badge 永遠不出現

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
| API Routes | ✅ 95% | 有小型欄位 bug（P0）|
| UI Shell | ✅ 90% | 結構完整，缺貼圖 / expression |
| useVirtualTime | ✅ 100% | 完整實作但**從未被呼叫** |
| GameProvider 狀態管理 | ⚠️ 30% | session 存取 OK，LLM 迴圈全未接線 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ❌ 0% | 全 mock |
| Phase 推進 / 分支 | ❌ 10% | 線性跳 phase，branch 邏輯未接 |
| 群組對話 | ❌ 0% | stub only |
| Nudge 系統 | ❌ 0% | route 有，觸發沒有 |
