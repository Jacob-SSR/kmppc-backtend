// GeminiProvider — ไฟล์เดียวในโปรเจกต์ที่อนุญาตให้ import @google/genai
// (กติกาโปรเจกต์: AI ทุกอย่างเรียกผ่าน LlmProvider interface เท่านั้น)
//
// Env ที่ใช้:
// - GEMINI_API_KEY        (จำเป็น — เก็บใน .env ฝั่ง backend เท่านั้น)
// - GEMINI_CHAT_MODEL     (default: 'gemini-2.5-flash')
// - GEMINI_EMBEDDING_MODEL (default: 'gemini-embedding-001')

import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  GenerateAnswerParams,
  LlmProvider,
  LlmProviderInfo,
  WebAnswer,
  WebSource,
} from './llm.provider';

const DEFAULT_CHAT_MODEL = 'gemini-2.5-flash';
const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001';
// Gemini รับ batch embed ได้จำกัดต่อ request — แบ่งเป็นชุดเพื่อความปลอดภัย
const EMBED_BATCH_SIZE = 100;

@Injectable()
export class GeminiProvider implements LlmProvider {
  private client: GoogleGenAI | null = null;
  private readonly chatModel: string;
  private readonly embeddingModel: string;

  constructor(private readonly config: ConfigService) {
    this.chatModel =
      this.config.get<string>('GEMINI_CHAT_MODEL') ?? DEFAULT_CHAT_MODEL;
    this.embeddingModel =
      this.config.get<string>('GEMINI_EMBEDDING_MODEL') ??
      DEFAULT_EMBEDDING_MODEL;
  }

  info(): LlmProviderInfo {
    return {
      provider: 'gemini',
      chat_model: this.chatModel,
      embedding_model: this.embeddingModel,
    };
  }

  // lazy init — ไม่พังตอน boot ถ้ายังไม่ได้ตั้ง key แต่พังชัดเจนตอนเรียกใช้
  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.config.get<string>('GEMINI_API_KEY');
      if (!apiKey) {
        throw new InternalServerErrorException(
          'ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน .env — กรุณาติดต่อผู้ดูแลระบบ',
        );
      }
      this.client = new GoogleGenAI({ apiKey });
    }
    return this.client;
  }

  private buildContents({ question, context }: GenerateAnswerParams): string {
    return [
      'ข้อมูลอ้างอิงจากฐานความรู้ (context):',
      '---',
      context,
      '---',
      '',
      `คำถาม: ${question}`,
    ].join('\n');
  }

  async generateAnswer(params: GenerateAnswerParams): Promise<string> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: this.chatModel,
      contents: this.buildContents(params),
      config: { systemInstruction: params.system },
    });
    return response.text ?? '';
  }

  async *generateAnswerStream(
    params: GenerateAnswerParams,
  ): AsyncIterable<string> {
    const ai = this.getClient();
    const stream = await ai.models.generateContentStream({
      model: this.chatModel,
      contents: this.buildContents(params),
      config: { systemInstruction: params.system },
    });
    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
    }
  }

  /** ตอบคำถามด้วย Google Search grounding (built-in tool ของ Gemini) */
  async generateWebAnswer(question: string): Promise<WebAnswer> {
    const ai = this.getClient();
    const response = await ai.models.generateContent({
      model: this.chatModel,
      contents: question,
      config: {
        systemInstruction: [
          'คุณคือผู้ช่วย AI ของระบบจัดการความรู้ภายในโรงพยาบาล',
          'ตอบเป็นภาษาไทย สุภาพ กระชับ โดยอ้างอิงจากผลการค้นหาบนอินเทอร์เน็ต',
        ].join('\n'),
        tools: [{ googleSearch: {} }],
      },
    });

    const sources: WebSource[] = [];
    const chunks =
      response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      const uri = chunk.web?.uri;
      if (!uri) continue;
      if (sources.some((s) => s.url === uri)) continue;
      sources.push({ title: chunk.web?.title ?? uri, url: uri });
    }
    return { answer: response.text ?? '', sources };
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const ai = this.getClient();
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const response = await ai.models.embedContent({
        model: this.embeddingModel,
        contents: batch,
      });
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new InternalServerErrorException(
          'ระบบ AI ตอบกลับ embedding ไม่ครบ กรุณาลองใหม่อีกครั้ง',
        );
      }
      for (const e of embeddings) {
        results.push(e.values ?? []);
      }
    }
    return results;
  }
}
