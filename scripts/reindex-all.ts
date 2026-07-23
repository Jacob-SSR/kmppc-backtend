// สคริปต์ re-index ฐานความรู้ทั้งหมด (บทความ PUBLISHED / กระทู้ solved / เอกสาร active)
// รัน: pnpm ts-node scripts/reindex-all.ts   (ต้องมี Redis + MySQL รันอยู่
// และมี process หลัก pnpm start:dev รันอยู่เพื่อให้ worker ประมวลผลงานในคิว)
//
// Env: REDIS_HOST (default 'localhost'), REDIS_PORT (default 6379)

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AiSearchModule } from '../src/ai-search/ai-search.module';
import { IndexingService } from '../src/ai-search/indexing.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    AiSearchModule,
  ],
})
class ReindexScriptModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(ReindexScriptModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const indexing = app.get(IndexingService);
    const { total } = await indexing.reindexAll();
    console.log(`เข้าคิว re-index แล้ว ${total} รายการ`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('re-index ล้มเหลว:', err);
  process.exit(1);
});
