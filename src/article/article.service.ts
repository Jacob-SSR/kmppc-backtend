import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ArticleStatus, Prisma } from '@prisma/client';
import slugify from 'slugify';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { IndexingService } from '../ai-search/indexing.service';
import {
  CreateArticleDto,
  CreateCommentDto,
  UpdateArticleDto,
  UpdateCommentDto,
} from './article.dto';

const authorSelect = {
  id: true,
  fname: true,
  lname: true,
  position: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexing: IndexingService,
  ) {}

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
    const article = await this.prisma.article.create({
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
    if (status === ArticleStatus.PUBLISHED) {
      await this.indexing.enqueue('ARTICLE', article.id);
    }
    return article;
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

    return this.prisma
      .$transaction(async (tx) => {
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
      })
      .then(async (updated) => {
        // re-index เมื่อเผยแพร่/แก้เนื้อหา — ถ้าถูก unpublish worker จะถอน chunk ให้เอง
        await this.indexing.enqueue('ARTICLE', updated.id);
        return updated;
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
    await this.indexing.enqueue('ARTICLE', id); // worker ถอน chunk ของบทความที่ถูกลบ
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

  async listComments(articleId: string) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, deleted_at: null },
    });
    if (!article) throw new NotFoundException('ไม่พบบทความนี้');
    return this.prisma.comment.findMany({
      where: { article_id: articleId, deleted_at: null },
      orderBy: { created_at: 'asc' },
      include: {
        user: { select: authorSelect },
        _count: { select: { likes: true } },
      },
    });
  }

  async addComment(articleId: string, userId: string, dto: CreateCommentDto) {
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, deleted_at: null },
    });
    if (!article) throw new NotFoundException('ไม่พบบทความนี้');

    const comment = await this.prisma.comment.create({
      data: { article_id: articleId, user_id: userId, content: dto.content },
      include: {
        user: { select: authorSelect },
        _count: { select: { likes: true } },
      },
    });

    if (article.author_id !== userId) {
      await this.prisma.notification.create({
        data: {
          user_id: article.author_id,
          actor_id: userId,
          type: 'COMMENT',
          title: 'มีผู้แสดงความคิดเห็นในบทความของคุณ',
          message: `${comment.user.fname} ${comment.user.lname} แสดงความคิดเห็นในบทความ "${article.title}"`,
          url: `/articles/${article.slug}`,
        },
      });
    }
    return comment;
  }

  async updateComment(
    articleId: string,
    commentId: string,
    userId: string,
    dto: UpdateCommentDto,
  ) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, article_id: articleId, deleted_at: null },
    });
    if (!comment) throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    if (comment.user_id !== userId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขความคิดเห็นนี้');
    }
    return this.prisma.comment.update({
      where: { id: commentId },
      data: { content: dto.content },
      include: {
        user: { select: authorSelect },
        _count: { select: { likes: true } },
      },
    });
  }

  async deleteComment(
    articleId: string,
    commentId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, article_id: articleId, deleted_at: null },
    });
    if (!comment) throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    if (comment.user_id !== userId && !isAdmin) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ลบความคิดเห็นนี้');
    }
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deleted_at: new Date() },
    });
    return { message: 'ลบความคิดเห็นเรียบร้อย' };
  }

  async toggleCommentLike(
    articleId: string,
    commentId: string,
    userId: string,
  ) {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, article_id: articleId, deleted_at: null },
    });
    if (!comment) throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    const existing = await this.prisma.commentLike.findUnique({
      where: { comment_id_user_id: { comment_id: commentId, user_id: userId } },
    });
    if (existing) {
      await this.prisma.commentLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.commentLike.create({
      data: { comment_id: commentId, user_id: userId },
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
