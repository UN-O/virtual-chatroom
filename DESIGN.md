# Story Chat — Design & UX Guidelines

> Last updated: 2026-03-13

---

## Design Philosophy

Story Chat is a narrative game that must feel like a real messaging app that happens to tell a story — not a game that happens to look like a chat. The emotional stakes (workplace pressure, relationship management, time urgency) only land if the interface itself feels authentic, composed, and premium.

**Three design principles govern every decision:**

1. **Cinematic restraint** — Less chrome, more content. The UI should disappear; what remains is the conversation and the emotional weight of the clock.
2. **System feedback as storytelling** — Every UI state change (unread badge, avatar expression shift, typing indicator, time bar turning red) is a narrative beat. Treat them as such.
3. **Tension through affordance** — Players should feel time pressure without being told to feel it. The fast-forward button, the phase timer draining, the boss's avatar going cold — these are the tools. Use them precisely.

**Reference benchmark:** iMessage dark mode (bubble clarity), LINE (avatar + unread density), Arc Browser (sidebar elegance), Vercel dashboard (purposeful mono-weight type).

---

## Color System

The current palette uses OKLCH which is correct for perceptual uniformity. However the palette has a structural problem: it conflates the game's thematic identity (workplace dread/relief) with a generic SaaS green. The primary hue (`oklch(0.55 0.18 145)`) reads as "productivity app teal-green" rather than "cinematic narrative." The fix is to shift the accent identity while preserving the semantic token structure.

### Proposed Token Definitions

All tokens remain as CSS custom properties in `src/app/globals.css`. Changes are additive — the existing token names are preserved for shadcn compatibility.

```css
/* ── Neutral Base (both modes) ── */
--surface-0:    /* deepest background */
--surface-1:    /* card / sidebar */
--surface-2:    /* input / hover state */
--surface-3:    /* subtle divider / muted */

/* ── Brand Accent ── */
--accent-primary:   /* primary CTA, self bubble, active states */
--accent-secondary: /* soft tint for goal chips, badges */

/* ── Semantic ── */
--signal-time:      /* clock / timer — warm amber */
--signal-urgent:    /* phase timer >80%, destructive */
--signal-success:   /* goal achieved, ending good */
--signal-muted:     /* offline indicator, empty states */
```

### Light Mode (current → recommended)

| Token | Current | Recommended | Reason |
|---|---|---|---|
| `--background` | `oklch(0.97 0.005 240)` | `oklch(0.96 0.008 250)` | Slightly warmer blue-grey, less clinical |
| `--sidebar` | `oklch(1 0 0)` (pure white) | `oklch(0.985 0.004 250)` | Sidebar needs separation from chat window without a harsh border |
| `--primary` / `--accent` | `oklch(0.55 0.18 145)` | `oklch(0.52 0.16 160)` | Shift green → teal; cooler, more cinematic, less WhatsApp-green |
| `--chat-bubble-self` | `oklch(0.55 0.18 145)` | Inherit from `--primary` | Single source of truth |
| `--chat-bubble-other` | `oklch(1 0 0)` | `oklch(0.97 0.003 250)` | Pure white bubbles on white bg = invisible; needs subtle tint |
| `--time-badge` | `oklch(0.65 0.12 50)` (amber) | Keep | Correct — amber reads as "time" |

### Dark Mode (current → recommended)

| Token | Current | Recommended | Reason |
|---|---|---|---|
| `--background` | `oklch(0.15 0.01 260)` | `oklch(0.12 0.012 255)` | Deeper, more cinematic base |
| `--card` / `--sidebar` | `oklch(0.2 0.01 260)` | `oklch(0.17 0.01 255)` | Tighter elevation steps |
| `--chat-bubble-other` | `oklch(0.28 0.01 260)` | `oklch(0.22 0.015 255)` | Darker, glassier other bubble |
| `--chat-header` | `oklch(0.35 0.08 145)` | `oklch(0.20 0.012 255)` | Current header is a bright teal slab — in dark mode it should be surface-level, not a colored banner |

### New Tokens to Add

Add these to the `:root` block and `.dark` block in `globals.css`:

```css
/* Emotional state overlay colors (for PAD-driven glow) */
--pad-happy-glow:   oklch(0.75 0.15 100 / 0.4);   /* warm yellow-green */
--pad-angry-glow:   oklch(0.55 0.2 25 / 0.35);    /* red-orange */
--pad-sad-glow:     oklch(0.5 0.08 240 / 0.3);    /* muted blue */
--pad-neutral-glow: oklch(0.6 0.02 250 / 0.15);   /* barely visible */

/* Phase transition overlay */
--phase-transition-bg: oklch(0.08 0.01 255 / 0.85);
```

### Usage Rules

- `--primary` is used **only** for: self-message bubbles, active CTA buttons, focus rings, fast-forward button when enabled.
- `--signal-time` (amber) is used **only** for: clock icon, time badge, phase timer bar (early).
- `--signal-urgent` (destructive) is used **only** for: phase timer bar (>80%), remaining time label when ≤1 min.
- Never use `bg-gray-*` Tailwind classes directly. All grays must go through the token system. (Currently violated in `page.tsx` and `game/[sessionId]/page.tsx`.)

---

## Typography

The app uses Geist/Geist Mono (configured in `@theme inline`). That is the correct choice — Geist reads as premium and modern in CJK-adjacent contexts. However, the type scale is inconsistently applied.

### Hierarchy

| Level | Usage | Implementation |
|---|---|---|
| **Display** | Story title on lobby/selection | `text-3xl font-bold tracking-tight` |
| **Heading** | Section headers, chat room header name | `text-lg font-semibold` |
| **Body** | Chat message content | `text-sm leading-relaxed` (currently correct) |
| **Caption** | Timestamp, "already read", sender name above bubble | `text-[10px]` or `text-xs text-muted-foreground` |
| **Mono** | Session IDs, debug panel code, branch conditions | `font-mono text-[10px]` |
| **UI Label** | Button labels, badges, goal chips | `text-xs font-medium` |

### Current Problems

- `page.tsx` (home lobby) uses raw `text-4xl font-bold text-blue-900` — hardcoded color that ignores the token system and clashes with the game UI's design language.
- `page.tsx` session cards use `text-gray-800`, `text-gray-500`, `text-gray-400` — all hardcoded, none themed.
- Chat message content (`text-sm leading-relaxed`) is correct but the bubble `px-4 py-2.5` padding is slightly generous for dense conversation; `px-3.5 py-2` would be tighter without losing readability.
- Sender name label in group chat (`text-xs text-muted-foreground`) needs `font-medium` to differentiate it from timestamps — currently both are the same visual weight.

### Chinese Typography Rule

All Traditional Chinese text should use `tracking-wide` at body size and `tracking-normal` at heading size. Chinese characters at default letter-spacing (0) feel compressed on screen. This is not currently applied anywhere.

Add to `@layer base` in `globals.css`:
```css
body {
  @apply bg-background text-foreground;
  font-feature-settings: "kern" 1;
  -webkit-font-smoothing: antialiased;
}
```

---

## Component Design Tokens

### Spacing Scale

The current layout uses ad-hoc spacing. Establish these constants:

| Token Name | Value | Usage |
|---|---|---|
| `--gap-message` | `12px` (gap-3) | Between message bubble groups |
| `--gap-bubble-intra` | `4px` | Between consecutive bubbles from same sender |
| `--pad-bubble-x` | `14px` | Horizontal bubble padding |
| `--pad-bubble-y` | `8px` | Vertical bubble padding |
| `--sidebar-width` | `320px` | Fixed MD+ sidebar width (currently `w-80` = correct) |
| `--timebar-height` | Auto (variable due to goal chips) | Keep current approach |

### Border Radius

Current `--radius: 1rem` is too aggressive for chat bubbles — it makes the UI feel toy-like. The current `rounded-2xl` on bubbles looks like it belongs in a consumer lifestyle app, not a workplace drama.

**Recommended adjustments:**
- Chat bubbles: `rounded-xl` (12px) not `rounded-2xl` (16px) — more composed, still friendly
- The asymmetric "tail" corner (`rounded-br-md` for self, `rounded-bl-md` for other) is correct LINE-style — keep it
- Input field: `rounded-full` is appropriate for the pill-input look — keep
- Send button: `rounded-full` — keep

### Elevation / Shadow System

| Level | Usage | Value |
|---|---|---|
| `shadow-none` | Sidebar items, in-surface elements | — |
| `shadow-sm` | Character bubble (other), cards | `0 1px 3px rgba(0,0,0,0.08)` |
| `shadow-md` | Debug panel, floating elements | `0 4px 16px rgba(0,0,0,0.12)` |
| `shadow-lg` | Phase transition modal (proposed) | `0 8px 32px rgba(0,0,0,0.2)` |

Currently the `other` bubble has `shadow-sm` (correct). The `self` bubble has no shadow (correct — it's colored, doesn't need depth).

### Animation Durations

| Motion | Duration | Easing | Currently Implemented? |
|---|---|---|---|
| Message bubble enter | 180ms | `ease-out` | No — messages appear instantly |
| Typing indicator appear | 200ms | `ease-in-out` | No — not implemented |
| Unread badge pop | 150ms scale bounce | `cubic-bezier(0.34,1.56,0.64,1)` | No |
| Phase transition | 400ms | `ease-in-out` | No |
| Avatar expression swap | 300ms crossfade | `ease-in-out` | No |
| Fast-forward pulse | Currently `animate-pulse` | — | Yes — but pulse is too slow; needs 1s not 2s |
| Input send flash | 100ms opacity | `ease-out` | No |
| Goal chip check-in | 250ms scale + color | spring | No |

---

## Chat Bubble Design

### Current State

The current bubble design is structurally correct (asymmetric corners, right-aligned self bubbles, left-aligned other bubbles with avatar offset) but has several polish gaps.

### Self Bubble (Player)

```
Current:  rounded-2xl rounded-br-md bg-[var(--chat-bubble-self)] px-4 py-2.5
Proposed: rounded-xl rounded-br-sm bg-[var(--chat-bubble-self)] px-3.5 py-2 shadow-none
```

The `rounded-br-md` is the "tail" corner — this is correct. However `rounded-br-md` with `rounded-2xl` creates visual tension because the base radius is 16px and the corner drops to 8px. With `rounded-xl` (12px) base and `rounded-br-[4px]` tail, the contrast is more deliberate and LINE-like.

### Other Bubble (Character)

```
Current:  rounded-2xl rounded-bl-md bg-[var(--chat-bubble-other)] shadow-sm px-4 py-2.5
Proposed: rounded-xl rounded-bl-[4px] bg-[var(--chat-bubble-other)] shadow-sm px-3.5 py-2
```

**Critical missing behavior:** When a character sends multiple consecutive bubbles (burst messages), the intermediate bubbles should NOT show the tail corner. Only the last bubble in a burst gets the tail. This is standard LINE/iMessage behavior and creates rhythm in the conversation. Currently every bubble has a tail regardless of position.

Implementation: add a prop `isLastInBurst: boolean` to the bubble renderer. If `false`, render `rounded-xl` (no asymmetry). If `true`, render `rounded-xl rounded-bl-[4px]`.

### Sticker Bubble

Stickers exist in the type system (`MessageBubble.type === 'sticker'`, `emojiContent`) but there is no distinct visual treatment. A sticker from a character currently renders as a text bubble containing an emoji — indistinguishable from a text message that happens to start with an emoji.

**Required design:** Sticker bubbles must be distinguished:
- No background fill (transparent bubble)
- Emoji rendered at `text-4xl` (48px)
- No border radius box — just the emoji floating with a small drop shadow
- A subtle fade-in at 200ms

```tsx
// Proposed sticker bubble class
"flex items-center justify-center w-16 h-16 text-4xl drop-shadow-sm animate-in fade-in duration-200"
```

### System / Phase Transition Message

There is no system message design for phase transitions (e.g. "下午 14:00" appearing between messages as a timestamp divider). This is a critical missing element. LINE shows time dividers between message clusters — this provides temporal orientation.

**Required:** Add a `SystemMessage` bubble variant for:
- Phase entry dividers: `"--- 下午 14:00 ---"` centered, `text-xs text-muted-foreground`
- These should appear as the first message in a new phase's message group

---

## Emotional UI — PAD Integration

This is the most underexploited design opportunity in the current UI. PAD state changes are computed and stored in `characterStates`, and `CharacterAvatar` already reads PAD to swap expression images via `getExpressionFromPAD()`. But the emotional state is invisible to the player beyond the avatar image swap (which only works if expression images are provided, and currently falls back silently to the default avatar).

### Avatar Glow (PAD → Visual Signal)

Wrap `CharacterAvatar` in a `div` that applies a `box-shadow` ring based on current PAD `p` value. This communicates emotional temperature without text.

| Expression | Ring Color | CSS Value |
|---|---|---|
| `happy` (P > 0.4) | Warm yellow-green | `0 0 0 2px var(--pad-happy-glow)` |
| `angry` (P < -0.3 and A > 0.5) | Red-orange | `0 0 0 2px var(--pad-angry-glow)` |
| `sad` (P < -0.2) | Muted blue | `0 0 0 2px var(--pad-sad-glow)` |
| `surprised` (A > 0.6) | Bright yellow | `0 0 0 2px var(--pad-happy-glow)` |
| `neutral` | Barely visible | `0 0 0 2px var(--pad-neutral-glow)` |

The glow should transition with `transition: box-shadow 600ms ease-in-out` so it fades in slowly — making the emotional drift feel organic, not reactive.

Apply this glow in `CharacterAvatar` by computing the expression key and mapping it to the glow CSS variable:
```tsx
<Avatar
  className={cn(className, "transition-shadow duration-700")}
  style={{ boxShadow: `0 0 0 2.5px var(${glowVar})` }}
>
```

### Bubble Color Modulation (Advanced — P2)

As a character's `p` drops below -0.3, the `other` bubble background should subtly cool (blue-shift). This is a `P2` priority item, not a day-one feature. Implementation would require computing an `oklch` hue interpolation based on `pad.p` and applying it as an inline style on character bubbles.

### Chat Header — Emotional State

The current `ChatWindow` header shows a plain avatar + name. When a character's PAD state is unhappy, the header should carry a subtle signal. Options:
- A thin colored line (`border-t-2` in the angry/sad glow color) below the header border
- Or simply rely on the avatar glow, which is visible in the header avatar

Recommendation: rely on avatar glow only — adding a header border color risks being too noisy.

---

## Micro-interactions Spec

These are all currently absent. Listed with implementation specifics.

### 1. Message Bubble Enter Animation

**Trigger:** Any new message added to the messages array.

**Animation:** Slide up + fade in.

```css
@keyframes message-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

Apply via Tailwind: `animate-in slide-in-from-bottom-2 fade-in duration-[180ms] ease-out`

**Important:** Self-messages should appear immediately (0ms delay) to confirm the send action. Character messages should have the animation — but they already arrive after a real API delay, so the animation just needs to not be jarring.

### 2. Typing Indicator

**Trigger:** When a character response is in-flight (between `sendMessage()` call and response arrival).

**Design:** Three bouncing dots in a character bubble (other-bubble style, no tail corner). Position in the message list where the character's response will appear.

**Implementation:**
- Add `typingCharacters: TypingCharacter[]` to `GameState` (the type already exists in `types.ts`)
- In `ChatWindow`, filter `typingCharacters` for the current `chatId`
- Render a `<TypingBubble characterId={...} />` component at the bottom of the message list during loading

```css
@keyframes typing-dot {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30%           { transform: translateY(-4px); opacity: 1; }
}
```

Three dots staggered at `0ms`, `150ms`, `300ms` delay. Dots are `w-1.5 h-1.5 rounded-full bg-muted-foreground`.

Currently `isSending` only disables the input — there's no visual indication that the character is "thinking." This is a significant UX gap; players have no feedback that the system received their message.

### 3. Message Send Feedback

**Trigger:** Immediately when the player taps Send.

**Animation:** The send button does a brief `scale-95 → scale-100` press (100ms). The message appears in the list instantly with the slide-in animation. No additional "sending" spinner needed since the message is optimistically added.

**Current problem:** There is no optimistic message insertion. The `isSending` state disables the input but the player sees nothing until the full API round-trip completes. The self-message should appear immediately in the list (before the LLM responds), then the typing indicator appears.

### 4. Unread Badge Entry Animation

**Trigger:** `room.unreadCount` increases from 0 to N.

**Animation:** Scale from 0 to 1 with spring bounce.

```css
@keyframes badge-pop {
  0%   { transform: scale(0); }
  60%  { transform: scale(1.25); }
  100% { transform: scale(1); }
}
```

Apply via `animate-in zoom-in duration-150` on the `Badge` component in `ChatList`.

### 5. Avatar Expression Swap

**Trigger:** Character sends a message with an `expressionKey`, or PAD state crosses a threshold.

**Animation:** The `CharacterAvatar` `AvatarImage` src changes — but there's no crossfade. The swap is instantaneous and jarring.

**Fix:** Wrap the image in a `div` with `relative` positioning. When `resolvedSrc` changes, fade out the old image and fade in the new one using an opacity transition:

```tsx
// Use key prop to trigger re-mount animation
<AvatarImage
  key={resolvedSrc}
  src={resolvedSrc}
  className="animate-in fade-in duration-300"
/>
```

### 6. Phase Transition

**Trigger:** `advancePhase()` is called and the new phase loads.

**Current state:** There is no visual transition. The chat header updates, new messages appear, but nothing signals to the player that narrative time has jumped.

**Design:** A full-screen overlay that fades in for 300ms, holds for 800ms displaying the new virtual time (e.g., "下午 14:00"), then fades out over 400ms. This is the cinematic "chapter break" moment.

```
[fade in 300ms] → black overlay, centered text: "下午 14:00" in display size → [hold 800ms] → [fade out 400ms]
```

Implementation: add a `isPhaseTransitioning: boolean` state to `GameProvider`. Set it `true` in `advancePhase()`, then `false` after a 1500ms timeout. In `GameLayout`, render the overlay conditionally.

### 7. Fast-Forward Button — Goal Met State

**Current state:** The button uses `animate-pulse` (the default Tailwind pulse which fades opacity at 2s intervals). This is too slow and too subtle.

**Recommended:** When `canFastForward` becomes `true`:
1. The button does a single `scale(1) → scale(1.08) → scale(1)` pulse (400ms, spring easing) to draw attention
2. Then it enters a gentle continuous glow using `box-shadow` animation, not opacity pulse

```css
@keyframes ff-ready {
  0%, 100% { box-shadow: 0 0 0 0 var(--primary / 0); }
  50%       { box-shadow: 0 0 0 6px var(--primary / 0.3); }
}
animation: ff-ready 2s ease-in-out infinite;
```

Remove `animate-pulse`. Replace with the custom class above.

### 8. Goal Chip Achievement

**Trigger:** `charState.goalAchieved` changes from `false` to `true` in the TimeBar.

**Animation:** The goal chip scales up briefly (`scale-100 → scale-110 → scale-100`, 250ms) and transitions from `bg-muted text-muted-foreground` to `bg-primary/10 text-primary` with a 300ms color fade.

### 9. Read Receipt

**Current state:** "已讀" appears as plain `text-[10px] text-muted-foreground`. Sufficient, but could animate in (150ms fade) to signal the read event happening.

---

## User Journey — Pain Points & Fixes

| Step | Current State | Pain Point | Recommended Fix |
|---|---|---|---|
| **1. Landing / Home** | `page.tsx` uses hardcoded `bg-gray-50`, `text-blue-900`, raw Tailwind. Visually disconnected from the game UI. | Player encounters two completely different design systems: the raw lobby and the themed game. Kills immersion on entry. | Port `page.tsx` to use `StorySelection`-style design tokens. Replace `min-h-screen bg-gray-50` with `bg-background`, replace `text-blue-900` with `text-foreground` + token-driven colors. |
| **2. Story Selection** | `StorySelection.tsx` is the only properly themed surface. The gradient hero (`from-primary/20`) is pleasant but the `MessageCircle` icon placeholder is a non-answer — there's no art. | The story card doesn't feel like a narrative product. It looks like a SaaS feature card. | Add character silhouettes or a scene background image in the hero area. Replace the `MessageCircle` icon with character avatar previews at 40px. |
| **3. Game Start** | Navigation goes directly into `GameLayout`. No loading state communication. The `game/[sessionId]/page.tsx` loading state uses raw `bg-gray-100 text-gray-500`. | "Loading Session..." in English with hardcoded gray is jarring. | Replace loading state with themed spinner: `bg-background` + centered clock icon animation + Chinese copy "載入劇情中…" |
| **4. First AI Message** | Character message appears without animation. No typing indicator. Message simply materializes. | The first impression of "AI character is real and alive" is undermined by the instant appearance. | Add typing indicator (3-dot animation) that runs for the `responseDelaySeconds` duration before the message appears. Add slide-in animation on arrival. |
| **5. Sending First Reply** | Player types, presses send. Input clears. Nothing happens visually for the API round-trip duration. `isSending` disables the input. | Player has no confirmation their message was sent, no feedback that the character received it. Feels broken. | Optimistic message insertion: show player's message immediately, then show typing indicator for the character. |
| **6. Reading Response** | Bubbles have no entrance animation. Large text blocks just appear. | Reading rhythm is broken — no visual pacing between what you sent and what came back. | 180ms slide-in-from-bottom per bubble. In burst messages, stagger each bubble 120ms apart. |
| **7. Navigating DM ↔ Group** | Tab switching via `ChatList`. Active state uses `bg-sidebar-accent`. Mobile: full-screen swap with back arrow. | Unread badge is present but there's no notification-style pulse when new messages arrive in a non-active room. Players might miss group messages from the boss while in DM. | Add a 400ms ring-pulse animation to the unread badge on arrival. On mobile, consider a toast notification: "陳副理 在部門群組發了新訊息". |
| **8. Time Pressure** | Phase timer bar exists. Color shifts amber→red. Remaining minutes label turns red at ≤1 min. | The timer is in the `TimeBar` which sits at the top. Players focused on the chat miss the urgency signal. The bar itself is only `h-1.5` — nearly invisible. | Increase phase timer bar height to `h-2`. When `phaseElapsed >= 0.8`, add a subtle red tint to the entire TimeBar background (`bg-destructive/5`). Consider a toast-style nudge at 80% elapsed: "快沒時間了！". |
| **9. Fast-Forward** | Button is labeled "快進" with `FastForward` icon. It pulses with `animate-pulse` when enabled. Disabled state is `variant="secondary"`. | Players don't understand that "快進" requires goals to be met first. The disabled button gives no affordance — it just looks greyed out with no explanation. | Add a `title` tooltip to the disabled state: "完成所有目標後才能快進". When goals are met, replace the static pulse with the glow animation described above. |
| **10. Phase Transition** | No visual transition. Messages from the new phase appear immediately below the old ones. | There's no sense of time passing. The narrative jump from morning to afternoon is not marked. | Phase transition overlay (see Micro-interactions §6). Also insert a system message divider in the chat: a centered `"下午 14:00"` timestamp bar between old and new messages. |
| **11. Ending Screen** | The TimeBar shows a "故事結束" pill. The `canFastForward` / ending flow triggers the same UI as phase advance. | The ending is not special. After 20 minutes of emotional investment, the player gets a `CheckCircle2` icon and a chip that says "故事結束". No emotional resolution. | Add a dedicated ending screen component that replaces the `ChatWindow` area (or overlays it) after all ending phase messages are received. Show ending type (good/bad), character final expressions, a brief outcome summary in Traditional Chinese. |

---

## Navigation & Information Architecture

### Current Layout

```
[TimeBar — full width, variable height]
[ChatList 320px | ChatWindow flex-1]
```

The TimeBar lives above both panels, which is semantically correct (it's global game state, not per-chat). However:

**Problem 1: TimeBar height is variable.** When goal chips are present, the TimeBar is ~80px. When they're not (e.g., ending phase), it collapses. This causes the chat window content to jump in height, which shifts the message scroll position.

**Fix:** Give `TimeBar` a minimum height: add `min-h-[56px]` to the outer `div`. Goal chips can animate in without causing layout reflow by using `absolute` positioning within a fixed-height wrapper.

**Problem 2: Chat header duplicates the avatar.** The `ChatWindow` header shows an `Avatar` pulled from `room.avatarUrl`, but this is a plain `AvatarImage` — it doesn't use `CharacterAvatar`, so it never shows the PAD-driven expression. The header avatar and the sidebar avatar show different expressions.

**Fix:** Use `CharacterAvatar` in the `ChatWindow` header, passing the same `pad` and `avatarExpressions` props as in `ChatList`.

**Problem 3: "3 位成員" is hardcoded.** Line 121 of `ChatWindow.tsx`: `<span className="text-xs opacity-80">3 位成員</span>`. This is hardcoded English-adjacent metadata that will be wrong for any other group configuration.

**Fix:** Compute from `activeChatRoom.type === 'group'` → look up `groups` from game state → `group.members.length + 1` (player). Display as `${count} 位成員`.

**Problem 4: No back-button destination label.** On mobile, the back arrow in `ChatWindow` goes to the chat list, but there's no breadcrumb or label — players don't know where they're going.

**Fix:** Add the story/app name next to the back arrow: `← 聊天` in `text-sm font-medium`.

### Sidebar

The `ChatList` header has `<h2>聊天</h2>` with no logo or game identity. On a real messaging app (LINE, iMessage), the app name or avatar section fills this space.

**Proposed sidebar header:**
- Left: `MessageCircle` icon (18px) + "Story Chat" in `text-sm font-medium text-muted-foreground`
- Right: Phase label (e.g., "早上 09:00") in `text-xs text-muted-foreground` — this gives players temporal context without looking at the TimeBar

---

## Game UX — Time Pressure & Phase Design

### Virtual Time Legibility

The `TimeBar` shows:
1. A clock icon + bold virtual time (`09:00`) + progress label (`早上`)
2. Story progress bar (劇情進度 N/M)
3. Phase timer bar (本階段時間, remaining minutes)
4. Goal chips

This is information-dense and mostly correct, but suffers from **low visual hierarchy**. Everything in the TimeBar has similar visual weight, so nothing jumps out in moments of urgency.

**Hierarchy fix:**

- The virtual time (`09:00`) is the most important element — increase to `text-2xl font-bold` (currently `text-lg font-bold`)
- The phase timer bar is the most urgent element — currently `h-1.5` (6px). Increase to `h-2.5` (10px) with rounded ends. When >80%, add a subtle red `ring-1 ring-destructive/30` around the entire timer area
- The story progress bar is the least urgent — reduce its visual weight: `text-[10px]` labels (currently `text-xs`), keep `h-2` bar

### Phase Timer — Remaining Minutes Format

`剩 {remainingMins} 分鐘` shows ceiling-rounded minutes. At 30 seconds remaining, this shows "剩 1 分鐘" which is misleading. Show seconds when ≤1 minute:

```ts
const label = remainingMs <= 60000
  ? `剩 ${Math.ceil(remainingMs / 1000)} 秒`
  : `剩 ${remainingMins} 分鐘`;
```

### Fast-Forward UX

The fast-forward mechanic requires ALL character goals in the current phase to be met before the button enables. This is gated correctly, but the player doesn't see which goals are missing.

**Fix:** The goal chips already show achieved/not-achieved state. Make the unachieved goal chip text more descriptive — not just the character name (`陳副理`, `小林`) but a hint at the outstanding action. Use `mission.completionHint` from the phase mission data (it's already in the type system).

Chip label when not achieved: `陳副理 — 等待回應` (using `completionHint` truncated to 8 chars)
Chip label when achieved: `陳副理 ✓`

### Phase Transition — "章節感"

The current flow: player clicks 快進 → `advancePhase()` fires → new messages appear immediately. This has no dramatic weight.

**Proposed flow:**
1. Player clicks 快進
2. All input is disabled (`isSending = true` globally for 2s)
3. Phase transition overlay appears (see §Micro-interactions §6): full-screen fade with virtual time of new phase
4. Overlay fades out (1.5s total)
5. New phase messages begin arriving with their normal `responseDelaySeconds` timing
6. A system message divider appears in each chat room marking the time jump

### Ending — Narrative Resolution Design

The ending phases (`ending_good`, `ending_bad`) currently use the same UI as other phases. This misses a critical opportunity for emotional resonance.

**Proposed ending sequence:**

After all ending phase messages are received (or the player hits 結束):
1. The chat window fades to dark (400ms)
2. An ending card appears with:
   - Outcome title: `"你搞定了！"` (good) or `"本次報告未通過"`  (bad)
   - Character relationship summary: boss P value translated to human-readable (e.g., `"陳副理對你的印象：還不錯"`)
   - A replay button and a return-to-lobby button
3. The ending card uses a distinct background — `bg-card` with `shadow-xl` and `border border-border`, centered in the viewport

---

## Anti-patterns to Avoid

These are "vibe coding" patterns currently present in the UI that break the premium feel.

| Anti-pattern | Where | Fix |
|---|---|---|
| Hardcoded Tailwind colors outside the token system | `page.tsx` (`bg-gray-50`, `text-blue-900`, `bg-blue-600`, `text-gray-*`), `game/[sessionId]/page.tsx` (`bg-gray-100`, `bg-gray-50`, `bg-blue-600`) | Replace ALL instances with CSS variable tokens: `bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground` |
| English loading state in a Chinese-language game | `game/[sessionId]/page.tsx`: "Loading Session {sessionId}..." | Change to `載入劇情中…` — remove the session ID from user-visible text |
| `confirm()` dialog for delete | `page.tsx` `handleDelete` uses `window.confirm()` | Replace with a shadcn `AlertDialog` with "確定刪除？" / "確認" / "取消" |
| Hardcoded member count | `ChatWindow.tsx` line 121: `3 位成員` | Compute dynamically from group data |
| `animate-pulse` for CTA affordance | `TimeBar.tsx` fast-forward button | Replace with targeted glow animation — `animate-pulse` is generic and reads as "loading" not "ready to act" |
| `opacity-80` for secondary text | `ChatWindow.tsx` line 120 (`opacity-80`) | Use `text-muted-foreground` token — opacity hacks break in dark mode due to background bleed |
| Inline SVG for trash icon | `page.tsx` line 96: raw `<svg>` path string | Import from `lucide-react`: `import { Trash2 } from 'lucide-react'` |
| Missing key for optimistic UI | Player messages only appear after API completes, not optimistically | Show player's message immediately on send; add typing indicator for character response |
| `bg-green-500` / `bg-yellow-500` / `bg-blue-500` in DebugPanel | `DebugPanel.tsx` PADBar colors | These are internal dev tools — acceptable, but should use `--pad-happy-glow` etc. when those tokens exist |
| No `aria-label` on icon buttons | `TimeBar.tsx` debug toggle, `ChatWindow.tsx` MoreVertical button | Add `aria-label="切換偵錯面板"` and `aria-label="更多選項"` |
| TimeBar layout shift when goal chips appear/disappear | `TimeBar.tsx` goal chip section | Use `min-h` to prevent layout shift |

---

## Implementation Priority

### P0 — Critical (breaks immersion or usability)

1. **Optimistic message insertion + typing indicator**: Players have zero feedback between send and receive. This is the single most damaging UX gap. (`ChatWindow.tsx` + `use-send-message.ts` + new `TypingBubble` component)
2. **Fix loading / error states**: `game/[sessionId]/page.tsx` must use themed styles and Chinese copy. (`bg-gray-100`, "Loading Session...")
3. **Port `page.tsx` home lobby to token system**: Remove all hardcoded `gray-*` and `blue-*` classes. The design split between lobby and game is jarring.
4. **Phase transition divider messages**: Insert a system message in each chat room when phase advances. Players have no temporal anchor between morning and afternoon conversations.

### P1 — High (meaningfully degrades the experience)

5. **Message bubble entrance animation** (180ms slide-in): `ChatWindow.tsx` message list — add `animate-in slide-in-from-bottom-2 fade-in duration-[180ms]` to each message bubble wrapper `div`.
6. **Typing indicator component**: `TypingBubble.tsx` — three bouncing dots in a character bubble. Show when `isSending` is true for any character in the active chat.
7. **Avatar glow driven by PAD state**: `CharacterAvatar.tsx` — compute expression, map to `--pad-*-glow` CSS variable, apply as `box-shadow` with 600ms transition.
8. **Phase transition overlay**: `GameLayout.tsx` — full-screen dark overlay with virtual time displayed, triggered by `advancePhase()`. Duration: 1.5s total.
9. **Fix `ChatWindow` header to use `CharacterAvatar`**: Lines 106-115 of `ChatWindow.tsx` — replace `<Avatar>` with `<CharacterAvatar>` passing `pad` and `avatarExpressions`.

### P2 — Medium (polish, reduces premium feel)

10. **Sticker bubble distinct visual treatment**: No background, large emoji, fade-in animation.
11. **Goal chip achievement animation**: 250ms scale bounce + color transition in `TimeBar.tsx`.
12. **Fast-forward button glow animation**: Replace `animate-pulse` with custom `box-shadow` keyframe animation.
13. **Phase timer seconds display**: Show seconds when ≤60 seconds remaining (`剩 {n} 秒`).
14. **Sidebar header identity**: Add game name/logo and current phase label to `ChatList` header.
15. **`window.confirm()` → AlertDialog**: `page.tsx` delete session confirmation.
16. **Fix hardcoded "3 位成員"**: Compute from group data in `ChatWindow.tsx`.
17. **Unread badge pop animation**: `ChatList.tsx` — spring scale animation on badge appearance.
18. **Chinese typography tracking**: Add `tracking-wide` for body Chinese text globally in `globals.css`.

### P3 — Low (nice to have, brand-building)

19. **Ending screen component**: Dedicated resolution screen after ending phase completes. Outcome title, relationship summary, replay/exit actions.
20. **Character bio mini-cards**: On avatar tap in ChatWindow header, show a small popover with character name, description, current mood (PAD-derived). (`CharacterInfoPopover.tsx`)
21. **Dark mode as default**: The dark palette is stronger for the cinematic feel. Consider making dark mode the default or adding an explicit dark mode toggle to the sidebar header.
22. **Burst message staggering**: When a character sends 2-4 messages in a burst, stagger their appearance by 120ms each rather than all appearing simultaneously.
23. **PAD-driven bubble color modulation**: Character bubble background hue shifts subtly based on `pad.p` value — cool blue tint when P < -0.3, warm when P > 0.4.
24. **`aria-label` sweep**: Add labels to all icon-only buttons across the game UI.
