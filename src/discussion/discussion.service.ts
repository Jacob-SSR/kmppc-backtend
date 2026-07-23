import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDiscussionDto, CreateReplyDto } from './discussion.dto';
import { serializeAuthored } from './anonymous.serializer';

const authorSelect = {
  id: true,
  fname: true,
  lname: true,
  position: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class DiscussionService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(params: {
    page?: number;
    limit?: number;
    category_id?: string;
    q?: string;
    viewerId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, params.limit ?? 10);
    const where: Prisma.DiscussionWhereInput = {
      deleted_at: null,
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
      this.prisma.discussion.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: { select: authorSelect },
          category: true,
          _count: {
            select: { replies: { where: { deleted_at: null } }, likes: true },
          },
        },
      }),
      this.prisma.discussion.count({ where }),
    ]);
    return {
      items: items.map((d) => serializeAuthored(d, params.viewerId)),
      total,
      page,
      limit,
    };
  }

  async findOne(id: string, viewerId?: string) {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id, deleted_at: null },
      include: {
        author: { select: authorSelect },
        category: true,
        tags: { include: { tag: true } },
        replies: {
          where: { deleted_at: null },
          orderBy: [{ is_best_answer: 'desc' }, { created_at: 'asc' }],
          include: {
            author: { select: authorSelect },
            _count: { select: { likes: true } },
          },
        },
        _count: { select: { likes: true } },
      },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');

    await this.prisma.discussion.update({
      where: { id },
      data: { view_count: { increment: 1 } },
    });

    const { replies, ...rest } = discussion;
    return {
      ...serializeAuthored(rest, viewerId),
      replies: replies.map((r) => serializeAuthored(r, viewerId)),
    };
  }

  create(authorId: string, dto: CreateDiscussionDto) {
    return this.prisma.discussion
      .create({
        data: {
          author_id: authorId,
          category_id: dto.category_id,
          title: dto.title,
          content: dto.content,
          is_anonymous: dto.is_anonymous ?? false,
        },
        include: { author: { select: authorSelect }, category: true },
      })
      .then((d) => serializeAuthored(d, authorId));
  }

  async addReply(discussionId: string, userId: string, dto: CreateReplyDto) {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id: discussionId, deleted_at: null },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');

    const reply = await this.prisma.reply.create({
      data: {
        discussion_id: discussionId,
        user_id: userId,
        parent_reply_id: dto.parent_reply_id,
        content: dto.content,
        is_anonymous: dto.is_anonymous ?? false,
      },
      include: { author: { select: authorSelect } },
    });

    // แจ้งเตือนเจ้าของกระทู้ — ห้าม leak ชื่อ actor เมื่อ reply เป็น anonymous
    if (discussion.author_id !== userId) {
      await this.prisma.notification.create({
        data: {
          user_id: discussion.author_id,
          actor_id: reply.is_anonymous ? null : userId,
          type: 'REPLY',
          title: 'มีผู้ตอบกระทู้ของคุณ',
          message: reply.is_anonymous
            ? 'มีผู้ตอบกระทู้ของคุณ'
            : `${reply.author.fname} ${reply.author.lname} ตอบกระทู้ของคุณ`,
          url: `/discussions/${discussionId}`,
        },
      });
    }
    return serializeAuthored(reply, userId);
  }

  async markBestAnswer(
    discussionId: string,
    replyId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id: discussionId, deleted_at: null },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');
    if (discussion.author_id !== userId && !isAdmin) {
      throw new ForbiddenException(
        'เฉพาะเจ้าของกระทู้เท่านั้นที่เลือกคำตอบที่ดีที่สุดได้',
      );
    }

    await this.prisma.$transaction([
      this.prisma.reply.updateMany({
        where: { discussion_id: discussionId },
        data: { is_best_answer: false },
      }),
      this.prisma.reply.update({
        where: { id: replyId },
        data: { is_best_answer: true },
      }),
      this.prisma.discussion.update({
        where: { id: discussionId },
        data: { is_solved: true },
      }),
    ]);
    return { message: 'เลือกคำตอบที่ดีที่สุดเรียบร้อย' };
  }

  async toggleLike(discussionId: string, userId: string) {
    const existing = await this.prisma.discussionLike.findUnique({
      where: {
        discussion_id_user_id: {
          discussion_id: discussionId,
          user_id: userId,
        },
      },
    });
    if (existing) {
      await this.prisma.discussionLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.discussionLike.create({
      data: { discussion_id: discussionId, user_id: userId },
    });
    return { liked: true };
  }
}
