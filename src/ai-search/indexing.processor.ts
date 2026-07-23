// IndexingProcessor — BullMQ worker ประมวลผลงาน index จาก queue 'indexing'
// หน้าที่: โหลดต้นทาง → สกัด/ทำความสะอาดข้อความ → หั่น chunk → embed → บันทึก KnowledgeChunk
//
// กติกาสำคัญ:
// - DISCUSSION: ใช้เฉพาะเนื้อหา (title + คำถาม + best answer) ห้ามใส่ชื่อผู้โพสต์/ผู้ตอบเด็ดขาด
//   (โพสต์ anonymous ต้องไม่ leak ตัวตน — ข้อมูล author ไม่ถูกดึงมาตั้งแต่ query)
// - ถ้าต้นทางไม่เข้าเงื่อนไขแล้ว (ลบ/unpublish/ปิดใช้งาน) = unindex → ลบ chunk เดิมทิ้ง
// - เรียก embedding ผ่าน LlmProvider เท่านั้น

import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PDFParse } from 'pdf-parse';
import * as mammoth from 'mammoth';
import { ChunkSourceType, IndexStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_PROVIDER } from '../llm/llm.provider';
import type { LlmProvider } from '../llm/llm.provider';
import { VectorStoreService } from './vector.store';
import { chunkText, stripHtml } from './chunking.util';
import { INDEXING_QUEUE, IndexingJobData } from './indexing.service';

// จำนวนข้อความต่อการเรียก embed หนึ่งครั้ง (provider แบ่ง batch ย่อยเองอีกชั้น)
const EMBED_CALL_BATCH = 32;

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(IndexingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    private readonly vectorStore: VectorStoreService,
  ) {
    super();
  }

  async process(job: Job<IndexingJobData>): Promise<void> {
    const { source_type, source_id } = job.data;
    this.logger.log(`Indexing ${source_type} ${source_id} (job ${job.id})`);
    try {
      let text: string | null;
      switch (source_type) {
        case ChunkSourceType.ARTICLE:
          text = await this.loadArticleText(source_id);
          break;
        case ChunkSourceType.DISCUSSION:
          text = await this.loadDiscussionText(source_id);
          break;
        case ChunkSourceType.DOCUMENT:
          text = await this.loadDocumentText(source_id);
          break;
        default:
          this.logger.warn(`ไม่รู้จัก source_type: ${String(source_type)}`);
          return;
      }

      if (text === null || !text.trim()) {
        // ต้นทางไม่เข้าเงื่อนไข index แล้ว → ลบ chunk เดิม (unindex)
        await this.prisma.knowledgeChunk.deleteMany({
          where: { source_type, source_id },
        });
        await this.vectorStore.refresh();
        this.logger.log(`Unindexed ${source_type} ${source_id}`);
        return;
      }

      const chunks = chunkText(text, { maxTokens: 650, overlapTokens: 100 });
      const embeddingModel =
        this.llm.info?.().embedding_model ??
        process.env.GEMINI_EMBEDDING_MODEL ??
        'gemini-embedding-001';

      // embed เป็นชุด ๆ
      const embeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += EMBED_CALL_BATCH) {
        const batch = chunks.slice(i, i + EMBED_CALL_BATCH);
        const vectors = await this.llm.embed(batch.map((c) => c.content));
        embeddings.push(...vectors);
      }

      // แทนที่ chunk เดิมทั้งชุดแบบ atomic
      await this.prisma.$transaction([
        this.prisma.knowledgeChunk.deleteMany({
          where: { source_type, source_id },
        }),
        this.prisma.knowledgeChunk.createMany({
          data: chunks.map((chunk, index) => ({
            source_type,
            source_id,
            chunk_index: index,
            content: chunk.content,
            embedding: embeddings[index],
            embedding_model: embeddingModel,
            token_count: chunk.token_count,
          })),
        }),
      ]);

      if (source_type === ChunkSourceType.DOCUMENT) {
        await this.prisma.knowledgeDocument.update({
          where: { id: source_id },
          data: { index_status: IndexStatus.DONE, indexed_at: new Date() },
        });
      }

      await this.vectorStore.refresh();
      this.logger.log(
        `Indexed ${source_type} ${source_id}: ${chunks.length} chunks`,
      );
    } catch (err) {
      this.logger.error(
        `Indexing ${source_type} ${source_id} ล้มเหลว`,
        err instanceof Error ? err.stack : String(err),
      );
      if (source_type === ChunkSourceType.DOCUMENT) {
        await this.prisma.knowledgeDocument
          .update({
            where: { id: source_id },
            data: { index_status: IndexStatus.FAILED },
          })
          .catch(() => undefined);
      }
      throw err; // ให้ BullMQ retry ตาม attempts/backoff
    }
  }

  // ---------- loaders ----------

  /** ARTICLE: เฉพาะบทความ PUBLISHED ที่ยังไม่ถูกลบ — title + เนื้อหา (strip HTML) */
  private async loadArticleText(id: string): Promise<string | null> {
    const article = await this.prisma.article.findFirst({
      where: { id, deleted_at: null, status: 'PUBLISHED' },
      select: { title: true, content: true, excerpt: true },
    });
    if (!article) return null;
    const body = stripHtml(article.content);
    return [article.title, article.excerpt ?? '', body]
      .filter(Boolean)
      .join('\n\n');
  }

  /**
   * DISCUSSION: เฉพาะกระทู้ solved ที่ยังไม่ถูกลบ + best answer
   * ใช้เนื้อหาอย่างเดียว — ห้ามรวมชื่อผู้โพสต์/ผู้ตอบ (กัน leak โพสต์ anonymous)
   */
  private async loadDiscussionText(id: string): Promise<string | null> {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id, deleted_at: null, is_solved: true },
      select: { id: true, title: true, content: true },
    });
    if (!discussion) return null;
    const bestAnswer = await this.prisma.reply.findFirst({
      where: {
        discussion_id: discussion.id,
        is_best_answer: true,
        deleted_at: null,
      },
      select: { content: true },
    });
    const parts = [`คำถาม: ${discussion.title}`, stripHtml(discussion.content)];
    if (bestAnswer) {
      parts.push(`คำตอบที่ถูกเลือก: ${stripHtml(bestAnswer.content)}`);
    }
    return parts.filter(Boolean).join('\n\n');
  }

  /**
   * DOCUMENT: เฉพาะเอกสาร active ที่ยังไม่ถูกลบ
   * ถ้า content ว่างแต่มี file_url → ดาวน์โหลดแล้วสกัดข้อความ (PDF/DOCX)
   * แล้วบันทึกกลับลง document.content พร้อมอัปเดต index_status
   */
  private async loadDocumentText(id: string): Promise<string | null> {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, deleted_at: null, is_active: true },
    });
    if (!doc) return null;

    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { index_status: IndexStatus.INDEXING },
    });

    let content = doc.content?.trim() ?? '';
    if (!content && doc.file_url) {
      content = (await this.extractFromFile(doc.file_url)).trim();
      if (content) {
        await this.prisma.knowledgeDocument.update({
          where: { id },
          data: { content },
        });
      }
    }
    if (!content) {
      throw new Error(
        'เอกสารไม่มีเนื้อหาให้ index (content ว่างและสกัดข้อความจากไฟล์ไม่ได้)',
      );
    }
    return [doc.title, doc.description ?? '', content]
      .filter(Boolean)
      .join('\n\n');
  }

  /** ดาวน์โหลดไฟล์ (https) แล้วสกัดข้อความตามชนิดไฟล์ */
  private async extractFromFile(fileUrl: string): Promise<string> {
    const res = await fetch(fileUrl);
    if (!res.ok) {
      throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ (HTTP ${res.status})`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? '';
    const urlPath = fileUrl.split('?')[0].toLowerCase();

    const isPdf =
      urlPath.endsWith('.pdf') || contentType.includes('application/pdf');
    const isDocx =
      urlPath.endsWith('.docx') ||
      contentType.includes('officedocument.wordprocessingml');

    if (isPdf) {
      // pdf-parse v2 API
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return result.text ?? '';
      } finally {
        await parser.destroy();
      }
    }
    if (isDocx) {
      const result = await mammoth.extractRawText({ buffer });
      return result.value ?? '';
    }
    throw new Error('ไม่รองรับชนิดไฟล์นี้ — รองรับเฉพาะ PDF และ DOCX เท่านั้น');
  }
}
