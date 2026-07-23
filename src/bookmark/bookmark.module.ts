import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Module,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

export class ToggleBookmarkDto {
  @IsOptional()
  @IsString()
  article_id?: string;

  @IsOptional()
  @IsString()
  discussion_id?: string;
}

@Controller('bookmarks')
@UseGuards(JwtAuthGuard)
export class BookmarkController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findMine(@CurrentUser() user: User) {
    const bookmarks = await this.prisma.bookmark.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: 'desc' },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            slug: true,
            excerpt: true,
            deleted_at: true,
          },
        },
        discussion: {
          select: { id: true, title: true, deleted_at: true },
        },
      },
    });
    // ข้าม bookmark ที่เป้าหมายถูก soft-delete ไปแล้ว
    return bookmarks
      .filter(
        (b) =>
          (b.article && b.article.deleted_at === null) ||
          (b.discussion && b.discussion.deleted_at === null),
      )
      .map((b) => ({
        id: b.id,
        created_at: b.created_at,
        article: b.article
          ? {
              id: b.article.id,
              title: b.article.title,
              slug: b.article.slug,
              excerpt: b.article.excerpt,
            }
          : null,
        discussion: b.discussion
          ? { id: b.discussion.id, title: b.discussion.title }
          : null,
      }));
  }

  @Post('toggle')
  async toggle(@CurrentUser() user: User, @Body() dto: ToggleBookmarkDto) {
    const hasArticle = !!dto.article_id;
    const hasDiscussion = !!dto.discussion_id;
    if (hasArticle === hasDiscussion) {
      throw new BadRequestException(
        'กรุณาระบุ article_id หรือ discussion_id อย่างใดอย่างหนึ่งเท่านั้น',
      );
    }

    if (hasArticle) {
      const article = await this.prisma.article.findFirst({
        where: { id: dto.article_id, deleted_at: null },
      });
      if (!article) throw new NotFoundException('ไม่พบบทความนี้');

      const existing = await this.prisma.bookmark.findFirst({
        where: { user_id: user.id, article_id: dto.article_id },
      });
      if (existing) {
        await this.prisma.bookmark.delete({ where: { id: existing.id } });
        return { bookmarked: false };
      }
      await this.prisma.bookmark.create({
        data: { user_id: user.id, article_id: dto.article_id },
      });
      return { bookmarked: true };
    }

    const discussion = await this.prisma.discussion.findFirst({
      where: { id: dto.discussion_id, deleted_at: null },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');

    const existing = await this.prisma.bookmark.findFirst({
      where: { user_id: user.id, discussion_id: dto.discussion_id },
    });
    if (existing) {
      await this.prisma.bookmark.delete({ where: { id: existing.id } });
      return { bookmarked: false };
    }
    await this.prisma.bookmark.create({
      data: { user_id: user.id, discussion_id: dto.discussion_id },
    });
    return { bookmarked: true };
  }
}

@Module({ controllers: [BookmarkController] })
export class BookmarkModule {}
