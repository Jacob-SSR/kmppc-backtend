import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/redis-io.adapter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // ไฟล์อัปโหลดแบบ local (UPLOAD_STORAGE=local) เสิร์ฟที่ /uploads
  // ชื่อไฟล์สุ่มไม่ซ้ำ (ดู upload.module) — cache ยาวได้ ไม่ต้องโหลดรูปซ้ำทุกหน้า
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads',
    maxAge: '7d',
    immutable: true,
  });

  // Socket.IO ผ่าน Redis adapter (เผื่อ scale หลาย instance)
  const redisIoAdapter = new RedisIoAdapter(app);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  app.setGlobalPrefix('api');
  // gzip ตอบกลับ JSON/ข้อความ — เนื้อหาบทความภาษาไทยยาว ๆ ลดขนาดได้หลายเท่า
  app.use(compression());
  // อนุญาตให้ frontend (คนละ origin) โหลดรูป/ไฟล์จาก /uploads ได้
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
