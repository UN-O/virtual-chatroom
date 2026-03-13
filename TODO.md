# TODO — Story Chat 距離 docs 的缺口分析

> 分析日期：2026-03-13（更新：2026-03-13）
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
| API Routes | ✅ 95% | 有小型欄位 bug（P0）|
| UI Shell | ✅ 90% | 結構完整，缺貼圖 / expression |
| useVirtualTime | ✅ 100% | 完整實作但**從未被呼叫** |
| 訊息虛擬時間戳記 | ❌ 0% | 全顯示真實時鐘 |
| LLM 非阻塞並行呼叫 | ⚠️ 30% | F1+F3 已有 Promise.all，但 F5 未並行、isLoading 粒度太粗 |
| 角色多則訊息 / 主動發訊 | ❌ 0% | F1 只返回單則，nudge 計時器未接 |
| GameProvider 狀態管理 | ⚠️ 30% | session 存取 OK，LLM 迴圈全未接線 |
| 核心遊戲迴圈（sendMessage → LLM → 更新）| ❌ 0% | 全 mock |
| Phase 推進 / 分支 | ❌ 10% | 線性跳 phase，branch 邏輯未接 |
| 群組對話 | ❌ 0% | stub only |
| Nudge 系統 | ❌ 0% | route 有，觸發沒有 |
