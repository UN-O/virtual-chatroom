/**
 * LLM Configuration for AI SDK 6
 * 
 * Uses provider packages directly with your own API keys:
 * - OPENAI_API_KEY for OpenAI models
 * - GOOGLE_GENERATIVE_AI_API_KEY for Google models
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

export type LLMProvider = 'openai' | 'google';

// Configuration
export const LLM_CONFIG = {
  // Model IDs - using user specified models
  models: {
    openai: 'gpt-5-mini',
    google: 'gemini-2.5-flash',
  },
  
  // Generation settings
  temperature: 0.8,
} as const;

// Create provider instances (lazy initialization)
let _openai: ReturnType<typeof createOpenAI> | null = null;
let _google: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getOpenAI() {
  if (!_openai) {
    _openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return _openai;
}

function getGoogle() {
  if (!_google) {
    _google = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    });
  }
  return _google;
}

/**
 * Detect which provider is available based on environment variables
 */
export function getLLMProvider(): LLMProvider {
  if (process.env.OPENAI_API_KEY) {
    return 'openai';
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return 'google';
  }
  return 'google';
}

/**
 * Get the model instance for AI SDK 6
 * Returns a LanguageModel instance from the appropriate provider
 */
export function getModel(): LanguageModel {
  const provider = getLLMProvider();
  
  if (provider === 'openai') {
    return getOpenAI()(LLM_CONFIG.models.openai);
  }
  
  return getGoogle()(LLM_CONFIG.models.google);
}

/**
 * Get a specific provider's model (useful for fallback)
 */
export function getModelByProvider(provider: LLMProvider): LanguageModel {
  if (provider === 'openai') {
    return getOpenAI()(LLM_CONFIG.models.openai);
  }
  return getGoogle()(LLM_CONFIG.models.google);
}

/**
 * Check if both providers are available (for fallback support)
 */
export function hasFallbackProvider(): boolean {
  return !!(process.env.OPENAI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}
