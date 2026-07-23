import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CategoryModule } from './category/category.module';
import { DepartmentModule } from './department/department.module';
import { ArticleModule } from './article/article.module';
import { DiscussionModule } from './discussion/discussion.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global: 100 req / นาที (ต่อ IP — เปลี่ยนเป็น per-user + Redis storage เมื่อเพิ่ม Redis)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    CategoryModule,
    DepartmentModule,
    ArticleModule,
    DiscussionModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
