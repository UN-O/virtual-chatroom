# CLAUDE.md — Virtual Chatroom (Story Chat)

This file describes the architecture, conventions, and development workflows for the **Story Chat** project — a local-first interactive narrative experience built with Next.js where the player converses with AI-driven characters inside a simulated workplace chat app.

---

## Project Overview

**Story Chat** is a browser-based game that simulates a messaging app (think LINE/WeChat). The player navigates a branching narrative by chatting with AI characters. Character behavior is governed by the **PAD emotion model** (Pleasure, Arousal, Dominance), and story progression is controlled by a **phase-based state machine**.

The first story (`story_001`, "這份報告今天要") is a ~20-minute scenario where the player must submit a report by end of day, managing relationships with two AI characters: a demanding boss (`char_boss`) and an evasive coworker (`char_coworker`).

---

## Repository Structure

```
/
├── CLAUDE.md                        ← This file
├── files/
│   ├── STORY_DESIGN.md              ← Story design spec & flowchart
│   └── story_001/                   ← Story content (JSON data, source of truth for design)
│       ├── plot.json
│       ├── groups.json
│       └── characters/
│           ├── char_boss.json
│           ├── char_boss_missions.json
│           ├── char_coworker.json
│           └── char_coworker_missions.json
└── src/                             ← Next.js app (all runnable code lives here)
    ├── package.json
    ├── next.config.mjs
    ├── tsconfig.json
    ├── app/
    │   ├── layout.tsx               ← Root layout (GameProvider wraps everything)
    │   ├── page.tsx                 ← Home / session lobby
    │   ├── actions.ts               ← Server Actions (LLM test utilities)
    │   ├── globals.css
    │   └── api/
    │       ├── chat/route.ts        ← Main LLM orchestration endpoint
    │       ├── event/
    │       │   ├── phase-start/route.ts   ← Fires proactive messages on phase entry
    │       │   ├── char-respond/route.ts  ← Decides + generates group response
    │       │   └── nudge/route.ts         ← Sends fail-nudge if player is silent
    │       └── phase/
    │           └── advance/route.ts       ← Evaluates branch conditions, returns next phase
    ├── components/
    │   ├── StorySelection.tsx
    │   ├── theme-provider.tsx
    │   ├── chat/
    │   │   ├── GameLayout.tsx       ← Top-level game UI wrapper
    │   │   ├── ChatList.tsx         ← Left-pane: list of DM / group rooms
    │   │   ├── ChatWindow.tsx       ← Right-pane: active conversation
    │   │   ├── TimeBar.tsx          ← Virtual time progress bar
    │   │   └── DebugPanel.tsx       ← Dev-only overlay (PAD values, phase state)
    │   └── ui/                      ← shadcn/ui primitives (do not edit directly)
    ├── hooks/
    │   ├── useVirtualTime.ts        ← Converts real time to story virtual time
    │   ├── use-mobile.ts
    │   └── use-toast.ts
    └── lib/
        ├── types.ts                 ← All TypeScript interfaces (single source of truth)
        ├── story-data.ts            ← Hard-coded story/character data (in-memory)
        ├── game-context.tsx         ← React context + GameProvider (central state)
        ├── utils.ts                 ← cn() + misc helpers
        ├── engine/
        │   ├── pad.ts               ← PAD math: apply delta, decay, shouldRespond
        │   └── phase.ts             ← Phase transition engine (evaluateCondition, determineNextPhase)
        ├── llm/
        │   ├── config.ts            ← LLM provider selection (OpenAI / Google)
        │   ├── generator.ts         ← F1, F2 — character message generators
        │   └── analyzer.ts          ← F3, F4, F5, F6 — analyzers & decision-makers
        └── storage/
            └── local-adapter.ts     ← localStorage persistence for game sessions
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5.9 (strict) |
| Styling | Tailwind CSS v4 |
| UI Components | shadcn/ui (Radix UI primitives) |
| LLM SDK | Vercel AI SDK 6 (`ai`, `@ai-sdk/openai`, `@ai-sdk/google`) |
| Structured Output | `ai` SDK `Output.object()` + Zod schemas |
| State | React Context (`GameProvider`) |
| Persistence | Browser `localStorage` via `LocalSessionAdapter` |
| Package Manager | pnpm |

### LLM Providers

The app supports **OpenAI** and **Google Gemini** interchangeably. Provider selection is automatic based on environment variables:

- `OPENAI_API_KEY` → uses `gpt-5-mini`
- `GOOGLE_GENERATIVE_AI_API_KEY` → uses `gemini-2.5-flash`

OpenAI takes priority if both are set. Configure in a `.env.local` file inside `src/`.

---

## Core Concepts

### PAD Emotion Model

Each AI character maintains a live emotional state with three dimensions:

| Dimension | Range | Effect |
|---|---|---|
| **P** (Pleasure) | -1.0 → 1.0 | Warmth/coldness of responses; controls ending branch |
| **A** (Arousal) | 0.0 → 1.0 | Probability of responding in group chat; response speed |
| **D** (Dominance) | -1.0 → 1.0 | Assertiveness of responses |

PAD state is updated after every player message (via F3 analysis). Values decay over time via `decayPAD()` in `src/lib/engine/pad.ts`.

### Phase-Based Story Engine

The story is divided into **phases** (defined in `src/lib/story-data.ts`):

| Phase ID | Virtual Time | Description |
|---|---|---|
| `morning` | 09:00 | Boss assigns report; coworker claims she's busy |
| `afternoon` | 14:00 | Boss checks progress; coworker sends sympathy sticker |
| `ending_good` | 17:30 | Positive resolution (boss P > 0.3 + goal met) |
| `ending_bad` | 17:30 | Negative resolution (boss P ≤ 0.3 or goal unmet) |

**Phase advance** is triggered by the fast-forward button when all goals are met. Branch conditions are evaluated by `determineNextPhase()` in `src/lib/engine/phase.ts`.

**Branch condition syntax:**
```
char_boss.p > 0.3 && goal_afternoon_char_boss_achieved
char_boss.p <= 0.3 || !goal_afternoon_char_boss_achieved
```

### LLM Functions (F1–F6)

All LLM calls are **non-streaming**. Six named functions map to specific behaviors:

| ID | Function | Location | Trigger |
|---|---|---|---|
| **F1** | `llmGenerateCharacterMessage` | `generator.ts` | Phase start (proactive DM) and DM reply |
| **F2** | `llmGenerateGroupResponse` | `generator.ts` | After F6 decides to respond |
| **F3** | `llmAnalyzePlayerMessage` | `analyzer.ts` | After every player message (parallel with F5) |
| **F4** | `llmUpdateMemory` | `analyzer.ts` | After F3 (depends on emotionTag) |
| **F5** | `llmCheckGoalAchieved` | `analyzer.ts` | After every player message (parallel with F3) |
| **F6** | `llmDecideGroupRespond` | `analyzer.ts` | When group receives a message |

F3 and F5 run in **parallel** using `Promise.all()` for efficiency (see `/api/chat/route.ts`).

### Chat Endpoint Actions

`POST /api/chat` accepts an `action` field:

| Action | LLM Function |
|---|---|
| `respond` (default) | F1 generate + F3 analyze (parallel) |
| `analyze` | F3 only |
| `checkGoal` | F5 only |
| `groupRespond` | F2 only |
| `decideGroup` | F6 only |
| `updateMemory` | F4 only |

---

## Data Conventions

### Story Data (`src/lib/story-data.ts`)

All story content is hardcoded in TypeScript (not loaded from JSON files at runtime). The `files/story_001/` directory contains the **design source** — when content changes, update `story-data.ts` to match.

Characters, missions, groups, and the story plot are exported as:
```ts
export const characters: Record<string, Character>
export const allCharacterMissions: Record<string, CharacterMissions>
export const groups: Group[]
export const storyPlot: StoryPlot
```

### TypeScript Types (`src/lib/types.ts`)

All shared interfaces live in `types.ts`. Key types:

- `Character` — full character config (profile, personality, speech, psychology, PAD config)
- `CharacterState` — runtime state (current PAD, memory string, goalAchieved)
- `GameSession` / `ClientSession` — full session with messages, phase, character states
- `Phase` / `CharacterPhaseMission` — phase definitions and per-character goals
- `Message` — chat message (player or character)
- `ChatRoom` — DM or group room descriptor

### Character Memory

Each character maintains a short-form `memory` string (2–3 sentences in Traditional Chinese) summarizing the player's behavior from that character's perspective. Updated by F4 (`llmUpdateMemory`) after interactions.

---

## TODO 維護規則

**每次完成任何程式碼修改後，必須同步更新 `TODO.md`。**

具體規則：
- 完成一個 TODO 項目 → 將對應條目改為 `- [x]`，並在後面補一行說明完成方式或 commit
- 發現新的缺口或 bug → 立刻加入對應優先級的區塊（P0–P5）
- 修改影響到完成度評估 → 更新底部「完成度概覽」表格的百分比與說明
- 文件開頭的「更新日期」也要同步改

不更新 TODO 的 PR 視為未完成。

---

## Development Workflow

### Setup

```bash
cd src
pnpm install
```

Create `src/.env.local`:
```
OPENAI_API_KEY=sk-...
# or
GOOGLE_GENERATIVE_AI_API_KEY=...
```

### Running Locally

```bash
cd src
pnpm dev      # starts Next.js at http://localhost:3000
```

### Building

```bash
cd src
pnpm build
pnpm start
```

### Linting

```bash
cd src
pnpm lint
```

**Note:** There is no test suite configured. Verify behavior through the in-app developer tools (LLM Test buttons on the home page) and the Debug Panel in-game.

### In-App Developer Tools

- **Home page** → "顯示開發工具 (LLM Test)" — tests raw LLM text and structured output
- **In-game** → `DebugPanel` component (toggled via `debugMode`) — shows live PAD values, goal states, and branch evaluations for each character

---

## Key Conventions

### Language

- All in-game text, LLM prompts, character dialogue, and UI labels are in **Traditional Chinese (繁體中文)**
- Code identifiers, comments, and this documentation are in **English**

### All commands must run from `src/`

The `package.json`, `tsconfig.json`, and `next.config.mjs` are all inside `src/`. Always `cd src` before running any npm/pnpm/next commands.

### Path Aliases

`@/` maps to `src/` (configured in `tsconfig.json`). Always use `@/` imports:
```ts
import { useGame } from '@/lib/game-context';
import type { Character } from '@/lib/types';
```

### Component Conventions

- `src/components/ui/` — shadcn/ui primitives. **Do not edit these directly.** If customization is needed, wrap them in a new component.
- `src/components/chat/` — game-specific components. Use `useGame()` hook for all state access.
- All game UI components are Client Components (`'use client'`). API routes are Server-side only.

### State Management

- All game state flows through `GameProvider` (`src/lib/game-context.tsx`)
- Access via `useGame()` hook — throws if used outside `GameProvider`
- Session data is persisted to `localStorage` automatically on every state change
- `localStorage` keys: `story-chat-session-{id}` and `story-chat-current-session-id`

### API Route Patterns

- All API routes use `export async function POST(req: Request)` (Next.js App Router style)
- Return `Response.json(data)` or `Response.json({ error }, { status })`
- No streaming — use `generateText()` not `streamText()`
- Always include fallback logic when LLM calls fail (see `getFallbackMessage` patterns in each route)

### Adding a New Story

1. Add character JSON files under `files/story_XXX/characters/`
2. Add plot, groups JSON under `files/story_XXX/`
3. Define all characters, missions, groups, and plot in `src/lib/story-data.ts` (following existing patterns)
4. Update `src/lib/types.ts` if new fields are needed
5. The `GameProvider` initializes from `storyPlot` — currently hardcoded to `story_001`

### PAD Delta Guidelines

When adding new interaction logic, follow these established delta ranges:

| Event | P delta | A delta | D delta |
|---|---|---|---|
| Player gives specific commitment | +0.2 | 0 | 0 |
| Vague / hedging response | -0.25 | +0.1 | 0 |
| Player reports progress proactively | +0.15 | +0.1 | 0 |
| Player ignores message | -0.1 | +0.15 | 0 |
| Trauma trigger activated | -0.2 to -0.3 | variable | -0.1 |

PAD deltas are clamped inside `applyPADDelta()`: P/D in [-1, 1], A in [0, 1].

---

## Files to Know Well

| File | Why it matters |
|---|---|
| `src/lib/types.ts` | All TypeScript types — check here before adding new fields |
| `src/lib/story-data.ts` | All story content, characters, missions — the in-memory database |
| `src/lib/game-context.tsx` | Central state machine — sendMessage, advancePhase, scheduling |
| `src/lib/engine/pad.ts` | PAD math — modify carefully, affects all character behavior |
| `src/lib/engine/phase.ts` | Phase/branch logic — condition syntax documented here |
| `src/lib/llm/config.ts` | LLM provider + model selection |
| `src/lib/llm/generator.ts` | F1, F2 — generator prompts live here |
| `src/lib/llm/analyzer.ts` | F3, F4, F5, F6 — analyzer prompts and Zod schemas |
| `src/app/api/chat/route.ts` | Main API endpoint — orchestrates all LLM calls |
| `files/STORY_DESIGN.md` | Story design doc — the narrative spec and flowchart |
