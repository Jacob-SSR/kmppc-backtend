import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import slugify from 'slugify';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateArticleDto, UpdateArticleDto } from './article.dto';

const authorSelect = {
  id: true,
  fname: true,
  lname: true,
  position: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ArticleService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    page?: number;
    limit?: number;
    category_id?: string;
    q?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, params.limit ?? 10);
    const where: Prisma.ArticleWhereInput = {
      deleted_at: null,
      status: ArticleStatus.PUBLISHED,
      ...(params.category_id ? { category_id: params.category_id } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q } },
              { content: { contains: params.q } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.article.findMany({
        where,
        orderBy: [{ is_pinned: 'desc' }, { published_at: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: { select: authorSelect },
          category: true,
          _count: { select: { comments: true, likes: true } },
        },
      }),
      this.prisma.article.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async findBySlug(slug: string, viewerId?: string) {
    const article = await this.prisma.article.findFirst({
      where: { slug, deleted_at: null },
      include: {
        author: { select: authorSelect },
        category: true,
        tags: { include: { tag: true } },
        _count: { select: { comments: true, likes: true } },
      },
    });
    if (!article) throw new NotFoundException('ไม่พบบทความนี้');

    if (viewerId) {
      // counter cache: insert ArticleView + increment view_count ใน transaction เดียว
      await this.prisma.$transaction([
        this.prisma.articleView.create({
          data: { article_id: article.id, user_id: viewerId },
        }),
        this.prisma.article.update({
          where: { id: article.id },
          data: { view_count: { increment: 1 } },
        }),
      ]);
    }
    return article;
  }

  async create(authorId: string, dto: CreateArticleDto) {
    const slug = await this.uniqueSlug(dto.title);
    const status = dto.status ?? ArticleStatus.DRAFT;
    return this.prisma.article.create({
      data: {
        author_id: authorId,
        category_id: dto.category_id,
        title: dto.title,
        slug,
        content: dto.content,
        excerpt: dto.excerpt,
        cover_image: dto.cover_image,
        status,
        published_at: status === ArticleStatus.PUBLISHED ? new Date() : null,
      },
    });
  }

  async update(
    id: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateArticleDto,
  ) {
    const article = await this.prisma.article.findFirst({
      where: { id, deleted_at: null },
    });
    if (!article) throw new NotFoundException('ไม่พบบทความนี้');
    if (article.author_id !== userId && !isAdmin) {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขบทความนี้');
    }

    const becomesPublished =
      dto.status === ArticleStatus.PUBLISHED && !article.published_at;

    return this.prisma.$transaction(async (tx) => {
      if (dto.content && dto.content !== article.content) {
        const last = await tx.articleVersion.findFirst({
          where: { article_id: id },
          orderBy: { version_no: 'desc' },
        });
        await tx.articleVersion.create({
          data: {
            article_id: id,
            version_no: (last?.version_no ?? 0) + 1,
            content: article.content,
            edited_by: userId,
          },
        });
      }
      return tx.article.update({
        where: { id },
        data: {
          ...dto,
          ...(becomesPublished ? { published_at: new Date() } : {}),
        },
      });
    });
  }

  async softDelete(id: string, userId: string, isAdmin: boolean) {
    const article = await this.prisma.article.findFirst({
      where: { id, deleted_at: null },
    });
    if (!article) throw new NotFoundException('ไม่พบบทความนี้');
    if (article.author_id !== userId && !isAdmin) {
      throw new ForbiddenException('ไม่มีสิทธิ์ลบบทความนี้');
    }
    await this.prisma.article.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
    return { message: 'ลบบทความเรียบร้อย' };
  }

  async toggleLike(articleId: string, userId: string) {
    const existing = await this.prisma.articleLike.findUnique({
      where: { article_id_user_id: { article_id: articleId, user_id: userId } },
    });
    if (existing) {
      await this.prisma.articleLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.articleLike.create({
      data: { article_id: articleId, user_id: userId },
    });
    return { liked: true };
  }

  private async uniqueSlug(title: string) {
    const base =
      slugify(title, { lower: true, strict: true, locale: 'th' }) ||
      randomBytes(4).toString('hex');
    const dup = await this.prisma.article.findUnique({ where: { slug: base } });
    return dup ? `${base}-${randomBytes(3).toString('hex')}` : base;
  }
}
