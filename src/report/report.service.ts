import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportDto } from './report.dto';

const excerpt = (text: string, length = 120) =>
  text.length > length ? `${text.slice(0, length)}…` : text;

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, dto: CreateReportDto) {
    const targets = [
      dto.article_id,
      dto.discussion_id,
      dto.reply_id,
      dto.comment_id,
    ].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException(
        'กรุณาระบุเป้าหมายที่ต้องการรายงานเพียงรายการเดียว',
      );
    }

    if (dto.article_id) {
      const article = await this.prisma.article.findFirst({
        where: { id: dto.article_id, deleted_at: null },
      });
      if (!article) throw new NotFoundException('ไม่พบบทความนี้');
    } else if (dto.discussion_id) {
      const discussion = await this.prisma.discussion.findFirst({
        where: { id: dto.discussion_id, deleted_at: null },
      });
      if (!discussion) throw new NotFoundException('ไม่พบกระทู้นี้');
    } else if (dto.reply_id) {
      const reply = await this.prisma.reply.findFirst({
        where: { id: dto.reply_id, deleted_at: null },
      });
      if (!reply) throw new NotFoundException('ไม่พบคำตอบนี้');
    } else if (dto.comment_id) {
      const comment = await this.prisma.comment.findFirst({
        where: { id: dto.comment_id, deleted_at: null },
      });
      if (!comment) throw new NotFoundException('ไม่พบความคิดเห็นนี้');
    }

    return this.prisma.report.create({
      data: {
        reporter_id: reporterId,
        reason: dto.reason,
        article_id: dto.article_id ?? null,
        discussion_id: dto.discussion_id ?? null,
        reply_id: dto.reply_id ?? null,
        comment_id: dto.comment_id ?? null,
      },
    });
  }

  async findAll(params: { status?: string; page?: number; limit?: number }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(50, Number(params.limit) || 10);
    const where: Prisma.ReportWhereInput = {
      ...(params.status &&
      (Object.values(ReportStatus) as string[]).includes(params.status)
        ? { status: params.status as ReportStatus }
        : {}),
    };
    const [reports, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          reporter: { select: { id: true, fname: true, lname: true } },
          reviewer: { select: { id: true, fname: true, lname: true } },
          // สรุปเป้าหมายเท่านั้น — ห้าม include author ของ discussion/reply
          // เพราะโพสต์ anonymous ต้องไม่ leak ตัวตนผู้เขียน (นโยบาย anonymous.serializer)
          article: { select: { id: true, title: true } },
          discussion: { select: { id: true, title: true } },
          reply: { select: { id: true, content: true } },
          comment: { select: { id: true, content: true } },
        },
      }),
      this.prisma.report.count({ where }),
    ]);

    const items = reports.map((r) => {
      const target = r.article
        ? { type: 'article' as const, id: r.article.id, title: r.article.title }
        : r.discussion
          ? {
              type: 'discussion' as const,
              id: r.discussion.id,
              title: r.discussion.title,
            }
          : r.reply
            ? {
                type: 'reply' as const,
                id: r.reply.id,
                excerpt: excerpt(r.reply.content),
              }
            : r.comment
              ? {
                  type: 'comment' as const,
                  id: r.comment.id,
                  excerpt: excerpt(r.comment.content),
                }
              : null;
      return {
        id: r.id,
        reason: r.reason,
        status: r.status,
        created_at: r.created_at,
        reviewed_at: r.reviewed_at,
        reporter: r.reporter,
        reviewer: r.reviewer,
        target,
      };
    });
    return { items, total, page, limit };
  }

  async updateStatus(
    id: string,
    reviewerId: string,
    status: 'REVIEWED' | 'RESOLVED',
  ) {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('ไม่พบรายงานนี้');
    return this.prisma.report.update({
      where: { id },
      data: {
        status,
        reviewed_by: reviewerId,
        reviewed_at: new Date(),
      },
    });
  }
}
