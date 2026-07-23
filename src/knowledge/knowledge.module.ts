// KnowledgeModule — จัดการเอกสารความรู้ (KnowledgeDocument) ฝั่ง ADMIN
// ลงทะเบียนแค่ queue 'indexing' (BullModule.forRoot เป็นหน้าที่ของ app.module)

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'indexing' })],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
