import type { NudgeDirection } from './types';

const DEFAULT_DIRECTION: NudgeDirection = {
  direction: '輕輕催促回覆。',
  fallback: '？',
  level: 0,
};

const STRATEGIES: Record<string, NudgeDirection[]> = {
  char_boss: [
    {
      direction: '稍微催促一下，但保持專業。詢問進度或確認是否收到。',
      fallback: '收到了嗎？',
      level: 0,
    },
    {
      direction: '更明確地催促，表達時間壓力。語氣可以更直接。',
      fallback: '我等你回覆。',
      level: 1,
    },
    {
      direction: '最後催促，語氣冷淡但不失禮。暗示可能有後果。',
      fallback: '？',
      level: 2,
    },
  ],
  char_coworker: [
    {
      direction: '自然地繼續話題，可以加點抱怨或分享。',
      fallback: '你有沒有在聽啊～',
      level: 0,
    },
    {
      direction: '稍微著急地問一下，但保持輕鬆。',
      fallback: '欸？',
      level: 1,
    },
  ],
};

export function resolveNudgeDirection(characterId: string, nudgeCount: number): NudgeDirection {
  const strategy = STRATEGIES[characterId];
  if (!strategy) {
    return {
      ...DEFAULT_DIRECTION,
      level: Math.max(0, Math.floor(nudgeCount)),
    };
  }

  const normalizedCount = Math.max(0, Math.floor(nudgeCount));
  const strategyIndex = Math.min(normalizedCount, strategy.length - 1);
  return strategy[strategyIndex];
}