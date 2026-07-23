// AiSearchModule — RAG stack: vector store, indexing worker, ask/feedback API
//
// หมายเหตุ: โมดูลนี้ทำแค่ BullModule.registerQueue('indexing')
// ส่วน BullModule.forRoot (Redis connection: REDIS_HOST/REDIS_PORT) เป็นหน้าที่ของ app.module
//
// โมดูลอื่นที่อยาก trigger การ index (เช่น article/discussion service)
// ให้ import โมดูลนี้แล้วใช้ IndexingService.enqueue(source_type, source_id)

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LlmModule } from '../llm/llm.module';
import { VectorStoreService } from './vector.store';
import { IndexingProcessor } from './indexing.processor';
import { INDEXING_QUEUE, IndexingService } from './indexing.service';
import { AiSearchService } from './ai-search.service';
import { AiSearchController } from './ai-search.controller';

@Module({
  imports: [BullModule.registerQueue({ name: INDEXING_QUEUE }), LlmModule],
  controllers: [AiSearchController],
  providers: [
    VectorStoreService,
    IndexingProcessor,
    IndexingService,
    AiSearchService,
  ],
  exports: [IndexingService],
})
export class AiSearchModule {}
