// AiSearchService — flow ถาม-ตอบด้วย RAG:
// embed คำถาม → vector search → สร้างคำตอบจาก context → source cards → log
//
// กติกาสำคัญ: source card ของ DISCUSSION ห้ามมีชื่อผู้โพสต์เด็ดขาด
// (ไม่ select ข้อมูล author มาตั้งแต่ query — กัน leak โพสต์ anonymous)

import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ChunkSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER } from '../llm/llm.provider';
import type { LlmProvider } from '../llm/llm.provider';
import { VectorStoreService } from './vector.store';
import type { ScoredChunk } from './vector.store';

const TOP_K = 6;
const MIN_SCORE = 0.5;

const SYSTEM_PROMPT = [
  'คุณคือผู้ช่วย AI ของระบบจัดการความรู้ (KM) ภายในองค์กร',
  'กติกาการตอบ:',
  '- ตอบเป็นภาษาไทยเสมอ สุภาพ กระชับ อ่านง่าย',
  '- ตอบโดยอ้างอิงจากข้อมูลใน context ที่ให้มาเท่านั้น ห้ามแต่งเติมความรู้ภายนอก',
  '- ถ้าข้อมูลใน context ไม่เพียงพอที่จะตอบ ให้บอกตรง ๆ ว่าข้อมูลในฐานความรู้ยังไม่ครอบคลุมคำถามนี้',
  '- ห้ามระบุหรือคาดเดาชื่อบุคคลผู้เขียน/ผู้ตอบเนื้อหาใน context',
].join('\n');

export interface AiSearchSource {
  source_type: ChunkSourceType;
  source_id: string;
  title: string;
  url: string;
  score: number;
}

export interface AiSearchResult {
  found: boolean;
  answer: string;
  sources: AiSearchSource[];
  log_id?: string;
}

@Injectable()
export class AiSearchService {
  private readonly logger = new Logger(AiSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly vectorStore: VectorStoreService,
  ) {}

  async ask(userId: string, query: string): Promise<AiSearchResult> {
    const startedAt = Date.now();
    const info = this.llm.info?.() ?? {
      provider: process.env.AI_PROVIDER ?? 'gemini',
      chat_model: process.env.GEMINI_CHAT_MODEL ?? 'gemini-2.5-flash',
      embedding_model:
        process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    };

    const [queryEmbedding] = await this.llm.embed([query]);
    const hits = this.vectorStore.search(queryEmbedding, {
      topK: TOP_K,
      minScore: MIN_SCORE,
    });

    if (hits.length === 0) {
      const answer =
        'ไม่พบข้อมูลในฐานความรู้ที่เกี่ยวข้องกับคำถามนี้ ลองปรับคำถามใหม่ หรือตั้งกระทู้ถามในชุมชนได้เลยครับ';
      const log = await this.saveLog(
        userId,
        query,
        answer,
        [],
        info,
        startedAt,
      );
      return { found: false, answer, sources: [], log_id: log.id };
    }

    const context = hits
      .map((hit, i) => `[แหล่งที่ ${i + 1}]\n${hit.content}`)
      .join('\n\n---\n\n');

    const answer = await this.llm.generateAnswer({
      system: SYSTEM_PROMPT,
      question: query,
      context,
    });

    const sources = await this.buildSources(hits);
    const log = await this.saveLog(
      userId,
      query,
      answer,
      sources,
      info,
      startedAt,
    );
    return { found: true, answer, sources, log_id: log.id };
  }

  /** บันทึก feedback ว่าคำตอบมีประโยชน์หรือไม่ — แก้ได้เฉพาะ log ของตัวเอง */
  async feedback(logId: string, userId: string, wasHelpful: boolean) {
    const log = await this.prisma.aiSearchLog.findUnique({
      where: { id: logId },
      select: { id: true, user_id: true },
    });
    if (!log) {
      throw new NotFoundException('ไม่พบประวัติการค้นหานี้');
    }
    if (log.user_id !== userId) {
      throw new ForbiddenException('ไม่สามารถให้ feedback แทนผู้อื่นได้');
    }
    await this.prisma.aiSearchLog.update({
      where: { id: logId },
      data: { was_helpful: wasHelpful },
    });
    return { success: true };
  }

  // ---------- helpers ----------

  /**
   * สร้าง source cards จาก chunk ที่เจอ (unique ตาม source เรียงตามคะแนน)
   * DISCUSSION: คืนเฉพาะ title + url — ไม่มีข้อมูลผู้โพสต์เด็ดขาด
   */
  private async buildSources(hits: ScoredChunk[]): Promise<AiSearchSource[]> {
    const seen = new Map<string, ScoredChunk>();
    for (const hit of hits) {
      const key = `${hit.source_type}:${hit.source_id}`;
      if (!seen.has(key)) seen.set(key, hit);
    }

    const sources: AiSearchSource[] = [];
    for (const hit of seen.values()) {
      if (hit.source_type === ChunkSourceType.ARTICLE) {
        const article = await this.prisma.article.findFirst({
          where: { id: hit.source_id, deleted_at: null, status: 'PUBLISHED' },
          select: { title: true, slug: true },
        });
        if (article) {
          sources.push({
            source_type: hit.source_type,
            source_id: hit.source_id,
            title: article.title,
            url: `/articles/${article.slug}`,
            score: hit.score,
          });
        }
      } else if (hit.source_type === ChunkSourceType.DISCUSSION) {
        const discussion = await this.prisma.discussion.findFirst({
          where: { id: hit.source_id, deleted_at: null },
          select: { title: true }, // ห้าม select author — กัน leak โพสต์ anonymous
        });
        if (discussion) {
          sources.push({
            source_type: hit.source_type,
            source_id: hit.source_id,
            title: discussion.title,
            url: `/discussions/${hit.source_id}`,
            score: hit.score,
          });
        }
      } else if (hit.source_type === ChunkSourceType.DOCUMENT) {
        const doc = await this.prisma.knowledgeDocument.findFirst({
          where: { id: hit.source_id, deleted_at: null, is_active: true },
          select: { title: true, file_url: true },
        });
        if (doc) {
          sources.push({
            source_type: hit.source_type,
            source_id: hit.source_id,
            title: doc.title,
            url: doc.file_url ?? `/knowledge-documents/${hit.source_id}`,
            score: hit.score,
          });
        }
      }
    }
    return sources;
  }

  private async saveLog(
    userId: string,
    query: string,
    answer: string,
    sources: AiSearchSource[],
    info: { provider: string; chat_model: string },
    startedAt: number,
  ) {
    return this.prisma.aiSearchLog.create({
      data: {
        user_id: userId,
        query,
        answer,
        sources: sources.map((s) => ({
          source_type: s.source_type,
          source_id: s.source_id,
          title: s.title,
          url: s.url,
        })),
        provider: info.provider,
        model: info.chat_model,
        latency_ms: Date.now() - startedAt,
      },
      select: { id: true },
    });
  }
}
