import type { Character, PAD } from '../types';

/**
 * PAD Emotion Model Engine
 * 
 * P (Pleasure): -1.0 ~ 1.0 - Affects warmth/coldness of responses
 * A (Arousal): 0.0 ~ 1.0 - Controls response probability in groups
 * D (Dominance): -1.0 ~ 1.0 - Affects assertiveness of responses
 */

export interface PADDelta {
  p: number;
  a: number;
  d: number;
}

/**
 * Calculate whether a character should respond in a group chat
 * Pure frontend calculation, no LLM call needed
 */
export function shouldRespond(character: Character, currentA: number): boolean {
  const { arousalThreshold, responsivenessBase } = character.padConfig.sensitivity;
  
  // Apply fatigue penalty when arousal exceeds threshold
  const fatiguePenalty = currentA > arousalThreshold
    ? (currentA - arousalThreshold) * 2.0
    : 0;
  
  const probability = Math.max(0, responsivenessBase - fatiguePenalty);
  
  return Math.random() < probability;
}

/**
 * Apply PAD delta to current state, clamping to valid ranges
 */
export function applyPADDelta(current: PAD, delta: PADDelta): PAD {
  return {
    p: clamp(current.p + delta.p, -1, 1),
    a: clamp(current.a + delta.a, 0, 1),
    d: clamp(current.d + delta.d, -1, 1),
  };
}

/**
 * Decay PAD values over time (called when no interaction happens)
 */
export function decayPAD(current: PAD, character: Character, basePAD: PAD): PAD {
  const { arousalDecay, pleasureDecayToBase } = character.padConfig.decayRate;
  
  return {
    // P decays towards base value
    p: decayTowards(current.p, basePAD.p, pleasureDecayToBase),
    // A decays towards 0
    a: Math.max(0, current.a - arousalDecay),
    // D stays relatively stable
    d: current.d,
  };
}

/**
 * Calculate response delay in seconds based on character config and current state
 */
export function calculateResponseDelay(
  character: Character, 
  baseDelaySeconds: number,
  currentA: number
): number {
  // Higher arousal = faster (shorter) responses
  const arousalMultiplier = 1 - (currentA * 0.3);
  // Add some randomness
  const randomFactor = 0.8 + Math.random() * 0.4;
  
  return Math.max(1, baseDelaySeconds * arousalMultiplier * randomFactor);
}

/**
 * Get emotion expression key based on current PAD state
 */
export function getExpressionFromPAD(pad: PAD): string {
  if (pad.p > 0.4) return 'happy';
  if (pad.p < -0.3 && pad.a > 0.5) return 'angry';
  if (pad.p < -0.2) return 'sad';
  if (pad.a > 0.6) return 'surprised';
  return 'neutral';
}

/**
 * Describe PAD state in natural language (for LLM prompts)
 */
export function describePADState(pad: PAD): string {
  const pDesc = pad.p > 0.3 ? '心情不錯' : pad.p < -0.2 ? '心情不太好' : '心情平淡';
  const aDesc = pad.a > 0.5 ? '有點激動' : pad.a < 0.2 ? '很平靜' : '正常活躍';
  const dDesc = pad.d > 0.3 ? '感覺主導' : pad.d < -0.2 ? '感覺被動' : '正常互動';
  
  return `愉悅度 (P): ${pad.p.toFixed(2)} — ${pDesc}
激動度 (A): ${pad.a.toFixed(2)} — ${aDesc}
主導感 (D): ${pad.d.toFixed(2)} — ${dDesc}`;
}

// Helper functions
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function decayTowards(current: number, target: number, rate: number): number {
  const diff = target - current;
  if (Math.abs(diff) < rate) return target;
  return current + Math.sign(diff) * rate;
}
