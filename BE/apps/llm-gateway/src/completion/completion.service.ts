import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

export interface Message { role: 'user' | 'assistant'; content: string; }

@Injectable()
export class CompletionService {
  private genAI: GoogleGenerativeAI;
  private openai: OpenAI;

  constructor(private cfg: ConfigService) {
    this.genAI  = new GoogleGenerativeAI(cfg.get('GEMINI_API_KEY'));
    this.openai = new OpenAI({ apiKey: cfg.get('OPENAI_API_KEY') });
  }

  private maxAttempts(): number {
    return Math.max(1, +this.cfg.get('RETRY_ATTEMPTS') || 1);
  }

  // Exponential backoff with a 2s cap: 300ms, 600ms, 1200ms, ...
  private backoffMs(attempt: number): number {
    return Math.min(2000, 300 * 2 ** (attempt - 1));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Only transient failures are worth retrying — overload/rate-limit/network.
  // A permanent error (bad key, 400) should fall back immediately, not burn retries.
  private isRetryable(e: any): boolean {
    const msg = (e?.message || '').toLowerCase();
    return (
      msg.includes('503') || msg.includes('429') || msg.includes('500') ||
      msg.includes('unavailable') || msg.includes('overloaded') ||
      msg.includes('high demand') || msg.includes('rate limit') ||
      msg.includes('fetch') || msg.includes('timeout') || msg.includes('econnreset')
    );
  }

  private geminiModel(system: string) {
    return this.genAI.getGenerativeModel({
      model: this.cfg.get('GEMINI_MODEL') ?? 'gemini-2.0-flash',
      systemInstruction: system,
      generationConfig: { maxOutputTokens: +this.cfg.get('MAX_TOKENS') },
    });
  }

  private toGeminiContents(messages: Message[]) {
    return messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
  }

  // Full response — non-streaming
  async complete(system: string, messages: Message[]): Promise<{ response_text: string; tokens_used: number; provider: string }> {
    // Try Gemini first — retry transient errors (503 high demand, rate limits)
    // before falling back, so a temporary Google spike doesn't push every
    // request onto the OpenAI fallback.
    const maxAttempts = this.maxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.geminiModel(system).generateContent({
          contents: this.toGeminiContents(messages),
        });
        const usage = res.response.usageMetadata;
        return {
          response_text: res.response.text(),
          tokens_used:   (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0),
          provider:      'gemini',
        };
      } catch (e) {
        if (attempt < maxAttempts && this.isRetryable(e)) {
          const backoffMs = this.backoffMs(attempt);
          console.warn(`[LLMGateway] Gemini failed (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms:`, e.message);
          await this.delay(backoffMs);
          continue;
        }
        console.warn('[LLMGateway] Gemini failed, falling back to OpenAI:', e.message);
        break;
      }
    }

    // Fallback to OpenAI
    try {
      const res = await this.openai.chat.completions.create({
        model:      this.cfg.get('OPENAI_MODEL'),
        max_tokens: +this.cfg.get('MAX_TOKENS'),
        messages:   [{ role: 'system', content: system }, ...messages],
      });
      return {
        response_text: res.choices[0].message.content,
        tokens_used:   res.usage.prompt_tokens + res.usage.completion_tokens,
        provider:      'openai',
      };
    } catch (e) {
      console.error('[LLMGateway] Both providers failed:', e.message);
      throw new ServiceUnavailableException('LLM providers unavailable');
    }
  }

  // Streaming — yields text chunks
  async *stream(system: string, messages: Message[]): AsyncGenerator<string> {
    // Try Gemini streaming first. Retry transient failures (503 high demand,
    // rate limits) ONLY while nothing has been yielded yet — once a byte reaches
    // the client we can neither retry nor fall back without splicing two voices.
    let geminiYieldedAny = false;
    const maxAttempts = this.maxAttempts();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.geminiModel(system).generateContentStream({
          contents: this.toGeminiContents(messages),
        });
        // Gemini SDK returns { stream, response } where `response` is a parallel
        // Promise that resolves after the stream completes. If the stream errors
        // (e.g., "Failed to parse stream" from Google's overload returning HTML),
        // BOTH `stream` and `response` reject. Our try/catch handles the stream
        // rejection, but `response` would become an unhandled rejection and
        // crash the Node 20+ process. Attach a no-op catch immediately to silence it.
        void result.response.catch(() => {});

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            geminiYieldedAny = true;
            yield text;
          }
        }
        return;
      } catch (e) {
        // Mid-stream Gemini errors can leave a partial response on the client.
        // If we already yielded text, falling back to OpenAI would produce a
        // disjoint continuation. Better to stop cleanly than splice two voices.
        if (geminiYieldedAny) {
          console.warn('[LLMGateway] Gemini stream failed mid-response, NOT falling back:', e.message);
          return;
        }
        // Nothing emitted yet — safe to retry on a fresh stream before fallback.
        if (attempt < maxAttempts && this.isRetryable(e)) {
          const backoffMs = this.backoffMs(attempt);
          console.warn(`[LLMGateway] Gemini stream failed before any output (attempt ${attempt}/${maxAttempts}), retrying in ${backoffMs}ms:`, e.message);
          await this.delay(backoffMs);
          continue;
        }
        console.warn('[LLMGateway] Gemini stream failed before any output, falling back to OpenAI:', e.message);
        break;
      }
    }

    // Fallback — OpenAI streaming. Wrap in try/catch so a fallback failure
    // (rate limit, auth, network) becomes a clean error to the controller
    // rather than an unhandled rejection.
    try {
      const stream = await this.openai.chat.completions.create({
        model:      this.cfg.get('OPENAI_MODEL'),
        max_tokens: +this.cfg.get('MAX_TOKENS'),
        messages:   [{ role: 'system', content: system }, ...messages],
        stream:     true,
      });
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content;
        if (text) yield text;
      }
    } catch (e) {
      console.error('[LLMGateway] OpenAI fallback also failed:', e.message);
      throw new ServiceUnavailableException('LLM providers unavailable');
    }
  }
}
