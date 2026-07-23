import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { DepartmentModule } from './department/department.module';
import { ArticleModule } from './article/article.module';
import { DiscussionModule } from './discussion/discussion.module';
import { NotificationModule } from './notification/notification.module';
import { UserModule } from './user/user.module';
import { UploadModule } from './upload/upload.module';
import { BookmarkModule } from './bookmark/bookmark.module';
import { TagModule } from './tag/tag.module';
import { ReportModule } from './report/report.module';
import { SettingModule } from './setting/setting.module';
import { SearchModule } from './search/search.module';
import { ChatModule } from './chat/chat.module';
import { CommonModule } from './common/common.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { AiSearchModule } from './ai-search/ai-search.module';
import { ActivityLogInterceptor } from './common/activity-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global: 100 req / นาที (ต่อ IP — เปลี่ยนเป็น per-user + Redis storage เมื่อเพิ่ม Redis)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // BullMQ (Redis) — คิวงาน indexing สำหรับ AI Search
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    AuthModule,
    CategoryModule,
    DepartmentModule,
    ArticleModule,
    DiscussionModule,
    NotificationModule,
    UserModule,
    UploadModule,
    BookmarkModule,
    TagModule,
    ReportModule,
    SettingModule,
    SearchModule,
    ChatModule,
    CommonModule,
    KnowledgeModule,
    AiSearchModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: ActivityLogInterceptor },
  ],
})
export class AppModule {}
