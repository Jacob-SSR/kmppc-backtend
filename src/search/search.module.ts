import {
  Body,
  Controller,
  Get,
  Module,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Prisma, User } from '@prisma/client';
import { IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { serializeAuthored } from '../discussion/anonymous.serializer';

export class SearchLogDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุคำค้นหา' })
  keyword: string;
}

const authorSelect = {
  id: true,
  fname: true,
  lname: true,
  position: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Controller('search')
export class SearchController {
  constructor(private readonly prisma: PrismaService) {}

  // route สาธารณะ — ถ้ามี user (จาก middleware อื่น) ค่อยบันทึก SearchLog
  @Get()
  async search(
    @Req() req: Request & { user?: User },
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
  ) {
    const keyword = (q ?? '').trim();
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(50, Number(limitRaw) || 10);
    const searchType =
      type === 'articles' || type === 'discussions' ? type : 'all';

    if (keyword && req.user?.id) {
      // fire-and-forget — ไม่ให้การ log ทำให้ค้นหาช้า/ล้ม
      this.prisma.searchLog
        .create({ data: { user_id: req.user.id, keyword } })
        .catch(() => undefined);
    }

    const empty = { items: [], total: 0 };
    if (!keyword) {
      return { articles: empty, discussions: empty, page, limit };
    }

    const articleWhere: Prisma.ArticleWhereInput = {
      deleted_at: null,
      status: 'PUBLISHED',
      OR: [
        { title: { contains: keyword } },
        { content: { contains: keyword } },
      ],
    };
    const discussionWhere: Prisma.DiscussionWhereInput = {
      deleted_at: null,
      OR: [
        { title: { contains: keyword } },
        { content: { contains: keyword } },
      ],
    };

    const [articles, discussions] = await Promise.all([
      searchType === 'discussions'
        ? Promise.resolve(empty)
        : this.prisma
            .$transaction([
              this.prisma.article.findMany({
                where: articleWhere,
                orderBy: { published_at: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                  id: true,
                  title: true,
                  slug: true,
                  excerpt: true,
                  cover_image: true,
                  published_at: true,
                  view_count: true,
                  author: { select: authorSelect },
                  category: true,
                },
              }),
              this.prisma.article.count({ where: articleWhere }),
            ])
            .then(([items, total]) => ({ items, total })),
      searchType === 'articles'
        ? Promise.resolve(empty)
        : this.prisma
            .$transaction([
              this.prisma.discussion.findMany({
                where: discussionWhere,
                orderBy: { created_at: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                  author: { select: authorSelect },
                  category: true,
                  _count: {
                    select: {
                      replies: { where: { deleted_at: null } },
                      likes: true,
                    },
                  },
                },
              }),
              this.prisma.discussion.count({ where: discussionWhere }),
            ])
            .then(([items, total]) => ({
              // ห้าม leak ตัวตนเจ้าของโพสต์ anonymous
              items: items.map((d) => serializeAuthored(d, req.user?.id)),
              total,
            })),
    ]);

    return { articles, discussions, page, limit };
  }

  // ทางเลือกสำหรับ frontend ที่ล็อกอินแล้ว — บันทึกคำค้นหาแบบยืนยันตัวตน
  @Post('log')
  @UseGuards(JwtAuthGuard)
  async log(@CurrentUser() user: User, @Body() dto: SearchLogDto) {
    await this.prisma.searchLog.create({
      data: { user_id: user.id, keyword: dto.keyword.trim() },
    });
    return { success: true };
  }
}

@Module({ controllers: [SearchController] })
export class SearchModule {}
