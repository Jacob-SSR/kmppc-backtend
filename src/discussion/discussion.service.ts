import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IndexingService } from '../ai-search/indexing.service';
import { UploadService } from '../upload/upload.module';
import { syncDiscussionTags } from '../tag/tag.util';
import {
  CreateDiscussionDto,
  CreateReplyDto,
  UpdateDiscussionDto,
  UpdateReplyDto,
} from './discussion.dto';
import { serializeAuthored } from './anonymous.serializer';

const authorSelect = {
  id: true,
  fname: true,
  lname: true,
  display_name: true,
  position: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class DiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly indexing: IndexingService,
    private readonly uploads: UploadService,
  ) {}

  async findAll(params: {
    page?: number;
    limit?: number;
    category_id?: string;
    tag_id?: string;
    sort?: string;
    q?: string;
    viewerId?: string;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, params.limit ?? 10);
    const where: Prisma.DiscussionWhereInput = {
      deleted_at: null,
      ...(params.category_id ? { category_id: params.category_id } : {}),
      ...(params.tag_id ? { tags: { some: { tag_id: params.tag_id } } } : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q } },
              { content: { contains: params.q } },
            ],
          }
        : {}),
    };
    // เรียงตามที่เลือก
    const sortOrder: Record<string, Prisma.DiscussionOrderByWithRelationInput> =
      {
        latest: { created_at: 'desc' },
        oldest: { created_at: 'asc' },
        views: { view_count: 'desc' },
        likes: { likes: { _count: 'desc' } },
        replies: { replies: { _count: 'desc' } },
      };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.discussion.findMany({
        where,
        orderBy: sortOrder[params.sort ?? 'latest'] ?? sortOrder.latest,
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

    let liked_by_me = false;
    let bookmarked_by_me = false;
    if (viewerId) {
      const [like, bookmark] = await Promise.all([
        this.prisma.discussionLike.findUnique({
          where: {
            discussion_id_user_id: { discussion_id: id, user_id: viewerId },
          },
        }),
        this.prisma.bookmark.findFirst({
          where: { discussion_id: id, user_id: viewerId },
        }),
      ]);
      liked_by_me = !!like;
      bookmarked_by_me = !!bookmark;
    }

    const { replies, ...rest } = discussion;
    return {
      ...serializeAuthored(rest, viewerId),
      liked_by_me,
      bookmarked_by_me,
      replies: replies.map((r) => serializeAuthored(r, viewerId)),
    };
  }

  async create(authorId: string, dto: CreateDiscussionDto) {
    const discussion = await this.prisma.discussion.create({
      data: {
        author_id: authorId,
        category_id: dto.category_id,
        title: dto.title,
        content: dto.content,
        is_anonymous: dto.is_anonymous ?? false,
      },
      include: { author: { select: authorSelect }, category: true },
    });
    if (dto.tags) {
      await syncDiscussionTags(this.prisma, discussion.id, dto.tags);
    }
    return serializeAuthored(discussion, authorId);
  }

  async update(
    id: string,
    userId: string,
    isAdmin: boolean,
    dto: UpdateDiscussionDto,
  ) {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id, deleted_at: null },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');
    if (discussion.author_id !== userId && !isAdmin) {
      throw new ForbiddenException('ไม่มีสิทธิ์แก้ไขกระทู้นี้');
    }
    // แยก tags ออกจากข้อมูลที่ส่งให้ prisma (ไม่ใช่คอลัมน์ของ Discussion)
    const { tags, ...data } = dto;
    const updated = await this.prisma.discussion.update({
      where: { id },
      data,
      include: { author: { select: authorSelect }, category: true },
    });
    if (tags) {
      await syncDiscussionTags(this.prisma, id, tags);
    }
    await this.indexing.enqueue('DISCUSSION', id); // re-index เนื้อหาใหม่
    return serializeAuthored(updated, userId);
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

  async updateReply(
    discussionId: string,
    replyId: string,
    userId: string,
    dto: UpdateReplyDto,
  ) {
    const reply = await this.prisma.reply.findFirst({
      where: { id: replyId, discussion_id: discussionId, deleted_at: null },
    });
    if (!reply) throw new NotFoundException('ไม่พบคำตอบนี้');
    if (reply.user_id !== userId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขคำตอบนี้');
    }
    const updated = await this.prisma.reply.update({
      where: { id: replyId },
      data: { content: dto.content },
      include: {
        author: { select: authorSelect },
        _count: { select: { likes: true } },
      },
    });
    return serializeAuthored(updated, userId);
  }

  async softDeleteReply(
    discussionId: string,
    replyId: string,
    userId: string,
    isAdmin: boolean,
  ) {
    const reply = await this.prisma.reply.findFirst({
      where: { id: replyId, discussion_id: discussionId, deleted_at: null },
    });
    if (!reply) throw new NotFoundException('ไม่พบคำตอบนี้');
    if (reply.user_id !== userId && !isAdmin) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ลบคำตอบนี้');
    }
    await this.prisma.$transaction([
      this.prisma.reply.update({
        where: { id: replyId },
        data: { deleted_at: new Date(), is_best_answer: false },
      }),
      // ถ้าลบคำตอบที่ถูกเลือกเป็น best answer กระทู้ต้องกลับเป็นยังไม่แก้ปัญหา
      ...(reply.is_best_answer
        ? [
            this.prisma.discussion.update({
              where: { id: discussionId },
              data: { is_solved: false },
            }),
          ]
        : []),
    ]);
    if (reply.is_best_answer) {
      // best answer หาย → กระทู้ไม่ solved แล้ว worker จะถอน chunk ออก
      await this.indexing.enqueue('DISCUSSION', discussionId);
    }
    return { message: 'ลบคำตอบเรียบร้อย' };
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
    // กระทู้ solved แล้ว → เข้าฐานความรู้ AI (title + คำถาม + best answer)
    await this.indexing.enqueue('DISCUSSION', discussionId);
    return { message: 'เลือกคำตอบที่ดีที่สุดเรียบร้อย' };
  }

  async softDelete(id: string, userId: string, isAdmin: boolean) {
    const discussion = await this.prisma.discussion.findFirst({
      where: { id, deleted_at: null },
    });
    if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');
    if (discussion.author_id !== userId && !isAdmin) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ลบกระทู้นี้');
    }
    await this.prisma.discussion.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
    await this.indexing.enqueue('DISCUSSION', id); // worker ถอน chunk ของกระทู้ที่ถูกลบ
    // ลบไฟล์แนบใน Cloudinary ที่ฝังอยู่ในเนื้อหา (best-effort)
    await this.uploads.destroyByUrls(
      UploadService.extractUrls(discussion.content),
    );
    // ลบแจ้งเตือนที่ชี้มากระทู้นี้ — กันผู้ใช้กดแจ้งเตือนแล้วเจอหน้าไม่พบเนื้อหา
    await this.prisma.notification.deleteMany({
      where: { url: `/discussions/${id}` },
    });
    return { message: 'ลบกระทู้เรียบร้อย' };
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
