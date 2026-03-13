'use server';

import { generateText, Output } from 'ai';
import { z } from 'zod';
import { getModel } from '@/lib/llm/config';

export async function testLLM() {
  try {
    const { text } = await generateText({
      model: getModel(),
      prompt: 'Say "Hello, World!" in Traditional Chinese.',
    });
    return { success: true, text };
  } catch (error) {
    console.error('Test LLM failed:', error);
    return { success: false, error: String(error) };
  }
}

export async function testStructuredLLM() {
  try {
    const { output } = await generateText({
      model: getModel(),
      prompt: 'Analyze sentiment of: "I love coding so much!"',
      output: Output.object({
        schema: z.object({
          sentiment: z.enum(['positive', 'negative', 'neutral']),
          score: z.number().min(0).max(10).describe('Sentiment score from 0 to 10'),
          reason: z.string().describe('Short reason for the score'),
        }),
      }),
    });
    return { success: true, data: output };
  } catch (error) {
    console.error('Test Structured LLM failed:', error);
    return { success: false, error: String(error) };
  }
}
