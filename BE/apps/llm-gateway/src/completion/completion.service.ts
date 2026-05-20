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
    // Try Gemini first
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
      console.warn('[LLMGateway] Gemini failed, falling back to OpenAI:', e.message);
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
    // Try Gemini streaming first
    let geminiYieldedAny = false;
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
      console.warn('[LLMGateway] Gemini stream failed before any output, falling back to OpenAI:', e.message);
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
