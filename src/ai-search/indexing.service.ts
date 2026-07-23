// IndexingService — จุดเดียวสำหรับสั่งคิวงาน index เข้าฐานความรู้ (queue 'indexing')
// โมดูลอื่น (article/discussion/knowledge หรือ orchestrator) import AiSearchModule
// แล้วเรียก enqueue()/reindexAll() — ห้ามยิง embedding ตรง ๆ นอก worker

import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChunkSourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const INDEXING_QUEUE = 'indexing';

export interface IndexingJobData {
  source_type: ChunkSourceType;
  source_id: string;
}

@Injectable()
export class IndexingService {
  private readonly logger = new Logger(IndexingService.name);

  constructor(
    @InjectQueue(INDEXING_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * สั่ง index (หรือ re-index) แหล่งข้อมูลหนึ่งรายการ
   * ถ้าต้นทางไม่เข้าเงื่อนไขแล้ว (ถูกลบ/unpublish/ปิดใช้งาน) worker จะลบ chunk เดิมออกให้เอง
   */
  async enqueue(
    source_type: ChunkSourceType,
    source_id: string,
  ): Promise<void> {
    await this.queue.add(
      'index',
      { source_type, source_id } satisfies IndexingJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
    this.logger.log(`Enqueued indexing: ${source_type} ${source_id}`);
  }

  /**
   * สั่ง re-index ทั้งระบบ: บทความที่เผยแพร่, กระทู้ที่ solved, เอกสารที่ active
   * คืนจำนวนงานที่เข้าคิว
   */
  async reindexAll(): Promise<{ total: number }> {
    const [articles, discussions, documents] = await Promise.all([
      this.prisma.article.findMany({
        where: { deleted_at: null, status: 'PUBLISHED' },
        select: { id: true },
      }),
      this.prisma.discussion.findMany({
        where: { deleted_at: null, is_solved: true },
        select: { id: true },
      }),
      this.prisma.knowledgeDocument.findMany({
        where: { deleted_at: null, is_active: true },
        select: { id: true },
      }),
    ]);

    const jobs: IndexingJobData[] = [
      ...articles.map((a) => ({
        source_type: ChunkSourceType.ARTICLE,
        source_id: a.id,
      })),
      ...discussions.map((d) => ({
        source_type: ChunkSourceType.DISCUSSION,
        source_id: d.id,
      })),
      ...documents.map((d) => ({
        source_type: ChunkSourceType.DOCUMENT,
        source_id: d.id,
      })),
    ];

    if (jobs.length > 0) {
      await this.queue.addBulk(
        jobs.map((data) => ({
          name: 'index',
          data,
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            removeOnComplete: 100,
            removeOnFail: 500,
          },
        })),
      );
    }
    this.logger.log(`reindexAll: enqueued ${jobs.length} jobs`);
    return { total: jobs.length };
  }
}
