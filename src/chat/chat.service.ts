import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateConversationDto,
  EditMessageDto,
  SendMessageDto,
} from './chat.dto';

const memberUserSelect = {
  id: true,
  fname: true,
  lname: true,
  display_name: true,
  profile_image: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** ตรวจว่า user เป็นสมาชิกห้องสนทนา (ยังไม่ออกจากห้อง) */
  async assertMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
        left_at: null,
      },
    });
    if (!member) {
      throw new ForbiddenException('คุณไม่ได้เป็นสมาชิกห้องสนทนานี้');
    }
    return member;
  }

  async isMember(conversationId: string, userId: string) {
    const member = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
        left_at: null,
      },
      select: { id: true },
    });
    return !!member;
  }

  async createConversation(userId: string, dto: CreateConversationDto) {
    // ตัด id ตัวเอง + ตัวซ้ำออกจากรายชื่อสมาชิก
    const otherIds = [...new Set(dto.member_ids)].filter((id) => id !== userId);
    if (otherIds.length === 0) {
      throw new BadRequestException('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: otherIds }, is_active: true },
      select: { id: true },
    });
    if (users.length !== otherIds.length) {
      throw new BadRequestException(
        'มีสมาชิกบางคนไม่ถูกต้องหรือถูกปิดการใช้งาน',
      );
    }

    if (dto.type === 'DIRECT') {
      if (otherIds.length !== 1) {
        throw new BadRequestException(
          'ห้องสนทนาส่วนตัวต้องมีสมาชิกอีก 1 คนเท่านั้น',
        );
      }
      const otherId = otherIds[0];
      // ถ้ามีห้อง DIRECT ระหว่างสองคนนี้อยู่แล้ว ให้ใช้ห้องเดิม
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { members: { some: { user_id: userId } } },
            { members: { some: { user_id: otherId } } },
          ],
        },
        include: {
          members: {
            where: { left_at: null },
            include: { user: { select: memberUserSelect } },
          },
        },
      });
      if (existing) return existing;

      return this.prisma.conversation.create({
        data: {
          type: 'DIRECT',
          created_by: userId,
          members: {
            create: [{ user_id: userId }, { user_id: otherId }],
          },
        },
        include: {
          members: {
            where: { left_at: null },
            include: { user: { select: memberUserSelect } },
          },
        },
      });
    }

    // GROUP — ผู้สร้างเป็นแอดมินของกลุ่ม
    return this.prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: dto.name,
        created_by: userId,
        members: {
          create: [
            { user_id: userId, is_admin: true },
            ...otherIds.map((id) => ({ user_id: id })),
          ],
        },
      },
      include: {
        members: {
          where: { left_at: null },
          include: { user: { select: memberUserSelect } },
        },
      },
    });
  }

  async listMyConversations(userId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { user_id: userId, left_at: null },
      include: {
        conversation: {
          include: {
            members: {
              where: { left_at: null },
              include: { user: { select: memberUserSelect } },
            },
            messages: {
              where: { deleted_at: null },
              orderBy: { created_at: 'desc' },
              take: 1,
              include: { sender: { select: memberUserSelect } },
            },
          },
        },
        last_read_message: { select: { created_at: true } },
      },
      orderBy: { conversation: { updated_at: 'desc' } },
    });

    return Promise.all(
      memberships.map(async (m) => {
        const unread_count = await this.prisma.message.count({
          where: {
            conversation_id: m.conversation_id,
            deleted_at: null,
            sender_id: { not: userId },
            ...(m.last_read_message
              ? { created_at: { gt: m.last_read_message.created_at } }
              : {}),
          },
        });
        const { messages, ...conversation } = m.conversation;
        return {
          ...conversation,
          last_message: messages[0] ?? null,
          unread_count,
          last_read_message_id: m.last_read_message_id,
        };
      }),
    );
  }

  async getMessages(
    conversationId: string,
    userId: string,
    params: { page?: number; limit?: number },
  ) {
    await this.assertMember(conversationId, userId);

    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 30));
    const where: Prisma.MessageWhereInput = {
      conversation_id: conversationId,
      deleted_at: null,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.message.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { sender: { select: memberUserSelect } },
      }),
      this.prisma.message.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async sendMessage(
    conversationId: string,
    userId: string,
    dto: SendMessageDto,
  ) {
    await this.assertMember(conversationId, userId);

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          conversation_id: conversationId,
          sender_id: userId,
          message: dto.message,
          message_type: dto.message_type ?? 'TEXT',
        },
        include: { sender: { select: memberUserSelect } },
      }),
      // ดันห้องขึ้นบนสุดของรายการสนทนา
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updated_at: new Date() },
      }),
    ]);
    return message;
  }

  async editMessage(messageId: string, userId: string, dto: EditMessageDto) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('ไม่พบข้อความนี้');
    if (message.sender_id !== userId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์แก้ไขข้อความนี้');
    }
    return this.prisma.message.update({
      where: { id: messageId },
      data: { message: dto.message, edited_at: new Date() },
      include: { sender: { select: memberUserSelect } },
    });
  }

  async deleteMessage(messageId: string, userId: string) {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, deleted_at: null },
    });
    if (!message) throw new NotFoundException('ไม่พบข้อความนี้');
    if (message.sender_id !== userId) {
      throw new ForbiddenException('คุณไม่มีสิทธิ์ลบข้อความนี้');
    }
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deleted_at: new Date() },
    });
    return { message: 'ลบข้อความเรียบร้อย' };
  }

  async markRead(conversationId: string, userId: string, messageId: string) {
    await this.assertMember(conversationId, userId);

    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        conversation_id: conversationId,
        deleted_at: null,
      },
    });
    if (!message) throw new NotFoundException('ไม่พบข้อความนี้');

    await this.prisma.conversationMember.update({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: userId,
        },
      },
      data: { last_read_message_id: messageId },
    });
    return { message: 'อัปเดตสถานะการอ่านเรียบร้อย' };
  }
}
