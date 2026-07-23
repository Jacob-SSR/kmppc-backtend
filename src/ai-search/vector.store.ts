// VectorStoreService — in-memory vector cache สำหรับ semantic search
// โหลด embedding ของ KnowledgeChunk ทั้งหมดขึ้น memory ตอน boot
// (ปริมาณข้อมูลระดับองค์กรภายใน ยังไม่จำเป็นต้องใช้ vector DB แยก)
// เมื่อ indexing worker ทำงานเสร็จให้เรียก refresh() เพื่อโหลดใหม่

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ChunkSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface CachedChunk {
  id: string;
  source_type: ChunkSourceType;
  source_id: string;
  chunk_index: number;
  content: string;
  embedding: number[];
}

export interface ScoredChunk extends CachedChunk {
  score: number;
}

export interface VectorSearchOptions {
  topK?: number;
  minScore?: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

@Injectable()
export class VectorStoreService implements OnModuleInit {
  private readonly logger = new Logger(VectorStoreService.name);
  private chunks: CachedChunk[] = [];

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.refresh();
  }

  /** โหลด chunk ทั้งหมดจาก DB ขึ้น memory ใหม่ */
  async refresh(): Promise<void> {
    try {
      const rows = await this.prisma.knowledgeChunk.findMany({
        select: {
          id: true,
          source_type: true,
          source_id: true,
          chunk_index: true,
          content: true,
          embedding: true,
        },
      });
      this.chunks = rows.map((row) => ({
        id: row.id,
        source_type: row.source_type,
        source_id: row.source_id,
        chunk_index: row.chunk_index,
        content: row.content,
        embedding: Array.isArray(row.embedding)
          ? (row.embedding as number[])
          : [],
      }));
      this.logger.log(`Vector store loaded: ${this.chunks.length} chunks`);
    } catch (err) {
      this.logger.error('โหลด vector store ไม่สำเร็จ', err as Error);
    }
  }

  get size(): number {
    return this.chunks.length;
  }

  /** ค้นหา chunk ที่ใกล้เคียง query embedding มากที่สุด (cosine similarity) */
  search(
    queryEmbedding: number[],
    options: VectorSearchOptions = {},
  ): ScoredChunk[] {
    const topK = options.topK ?? 6;
    const minScore = options.minScore ?? 0.5;
    const scored: ScoredChunk[] = [];
    for (const chunk of this.chunks) {
      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (score >= minScore) {
        scored.push({ ...chunk, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
