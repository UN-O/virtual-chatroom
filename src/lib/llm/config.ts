/**
 * LLM Configuration for AI SDK 6
 * 
 * Uses provider packages directly with your own API keys:
 * - OPENAI_API_KEY for OpenAI models
 * - GOOGLE_GENERATIVE_AI_API_KEY for Google models
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

export type LLMProvider = 'openai' | 'anthropic' | 'google';

// Configuration — priority: OpenAI > Anthropic > Google
export const LLM_CONFIG = {
  models: {
    openai: 'gpt-5-mini',
    anthropic: 'claude-sonnet-4-6',
    google: 'gemini-2.5-flash',
  },
} as const;

// Lazy provider instances
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _anthropic: ReturnType<typeof createAnthropic> | null = null;
let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getOpenAI() {
  if (!_openai) _openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getAnthropic() {
  if (!_anthropic) _anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

function getGoogle() {
  if (!_google) _google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
  return _google;
}

/**
 * Detect which provider to use based on environment variables.
 * Priority: OpenAI > Anthropic > Google
 */
export function getLLMProvider(): LLMProvider {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'google';
}

/**
 * Get the model instance for AI SDK 6.
 */
export function getModel(): LanguageModel {
  const provider = getLLMProvider();
  if (provider === 'openai') return getOpenAI()(LLM_CONFIG.models.openai);
  if (provider === 'anthropic') return getAnthropic()(LLM_CONFIG.models.anthropic);
  return getGoogle()(LLM_CONFIG.models.google);
}

/**
 * Get a specific provider's model.
 */
export function getModelByProvider(provider: LLMProvider): LanguageModel {
  if (provider === 'openai') return getOpenAI()(LLM_CONFIG.models.openai);
  if (provider === 'anthropic') return getAnthropic()(LLM_CONFIG.models.anthropic);
  return getGoogle()(LLM_CONFIG.models.google);
}

/**
 * Check if a fallback provider is available.
 */
export function hasFallbackProvider(): boolean {
  const primary = getLLMProvider();
  if (primary === 'openai') return !!(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  if (primary === 'anthropic') return !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
  return false;
}
