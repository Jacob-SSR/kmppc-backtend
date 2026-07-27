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

      // ยังไม่เป็นเพื่อนกัน (และผู้เริ่มไม่ใช่ ADMIN) → เป็น "คำขอส่งข้อความ"
      // ผู้ขอส่งได้ 1 ข้อความ จนกว่าปลายทางจะตอบรับ
      const [friendship, creatorIsAdmin] = await Promise.all([
        this.prisma.friendship.findFirst({
          where: {
            status: 'ACCEPTED',
            OR: [
              { requester_id: userId, addressee_id: otherId },
              { requester_id: otherId, addressee_id: userId },
            ],
          },
          select: { id: true },
        }),
        this.prisma.user.findFirst({
          where: { id: userId, role: { role_name: 'ADMIN' } },
          select: { id: true },
        }),
      ]);
      const isRequest = !friendship && !creatorIsAdmin;

      return this.prisma.conversation.create({
        data: {
          type: 'DIRECT',
          created_by: userId,
          is_request: isRequest,
          requested_by: isRequest ? userId : null,
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

  // ---------- คำขอส่งข้อความ ----------

  /** ตอบรับคำขอส่งข้อความ — เฉพาะฝ่ายที่ถูกทัก */
  async acceptRequest(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation?.is_request) {
      return { success: true }; // รับไปแล้ว/ไม่ใช่คำขอ — ไม่ต้องทำอะไร
    }
    if (conversation.requested_by === userId) {
      throw new ForbiddenException('ผู้ส่งคำขอตอบรับเองไม่ได้');
    }
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { is_request: false, requested_by: null },
    });
    return { success: true };
  }

  /** ปฏิเสธคำขอส่งข้อความ — ลบห้องทิ้ง (ข้อความแรกหายไปด้วย) */
  async declineRequest(conversationId: string, userId: string) {
    await this.assertMember(conversationId, userId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation?.is_request) {
      throw new ForbiddenException('ห้องนี้ไม่ใช่คำขอส่งข้อความ');
    }
    if (conversation.requested_by === userId) {
      throw new ForbiddenException('ผู้ส่งคำขอปฏิเสธเองไม่ได้');
    }
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { success: true };
  }

  // ---------- จัดการสมาชิกกลุ่ม ----------

  private async assertGroupAdmin(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('ไม่พบกลุ่มสนทนานี้');
    }
    const membership = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
        left_at: null,
      },
    });
    if (!membership) throw new ForbiddenException('คุณไม่ได้อยู่ในกลุ่มนี้');
    if (!membership.is_admin) {
      throw new ForbiddenException('เฉพาะแอดมินของกลุ่มเท่านั้น');
    }
    return conversation;
  }

  /** เพิ่มสมาชิกเข้ากลุ่ม (แอดมินกลุ่มเท่านั้น) — คนที่เคยออกไปแล้วดึงกลับได้ */
  async addMembers(
    conversationId: string,
    userId: string,
    memberIds: string[],
  ) {
    await this.assertGroupAdmin(conversationId, userId);
    const ids = [...new Set(memberIds)].filter(Boolean);
    if (ids.length === 0) {
      throw new BadRequestException('กรุณาเลือกสมาชิกที่จะเพิ่ม');
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, is_active: true },
      select: { id: true },
    });
    if (users.length !== ids.length) {
      throw new BadRequestException('มีสมาชิกบางคนไม่ถูกต้อง');
    }
    for (const id of ids) {
      const existing = await this.prisma.conversationMember.findUnique({
        where: {
          conversation_id_user_id: {
            conversation_id: conversationId,
            user_id: id,
          },
        },
      });
      if (existing) {
        if (existing.left_at) {
          await this.prisma.conversationMember.update({
            where: { id: existing.id },
            data: { left_at: null },
          });
        }
      } else {
        await this.prisma.conversationMember.create({
          data: { conversation_id: conversationId, user_id: id },
        });
      }
    }
    return { success: true, added: ids.length };
  }

  /** ถอดสมาชิกออกจากกลุ่ม (แอดมินกลุ่มเท่านั้น, ถอดตัวเองไม่ได้ — ใช้ leave) */
  async removeMember(conversationId: string, userId: string, targetId: string) {
    await this.assertGroupAdmin(conversationId, userId);
    if (targetId === userId) {
      throw new BadRequestException('ถอดตัวเองไม่ได้ — ใช้ปุ่มออกจากกลุ่มแทน');
    }
    const membership = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: targetId,
        left_at: null,
      },
    });
    if (!membership) throw new NotFoundException('คนนี้ไม่ได้อยู่ในกลุ่มแล้ว');
    await this.prisma.conversationMember.update({
      where: { id: membership.id },
      data: { left_at: new Date() },
    });
    return { success: true };
  }

  /** ออกจากกลุ่มเอง — แอดมินคนสุดท้ายออก ให้โอนสิทธิ์แอดมินให้สมาชิกที่เหลือคนแรก */
  async leaveGroup(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation || conversation.type !== 'GROUP') {
      throw new NotFoundException('ไม่พบกลุ่มสนทนานี้');
    }
    const membership = await this.prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
        left_at: null,
      },
    });
    if (!membership) throw new BadRequestException('คุณไม่ได้อยู่ในกลุ่มนี้');
    await this.prisma.conversationMember.update({
      where: { id: membership.id },
      data: { left_at: new Date() },
    });
    if (membership.is_admin) {
      const remainingAdmin = await this.prisma.conversationMember.findFirst({
        where: {
          conversation_id: conversationId,
          left_at: null,
          is_admin: true,
        },
      });
      if (!remainingAdmin) {
        const next = await this.prisma.conversationMember.findFirst({
          where: { conversation_id: conversationId, left_at: null },
          orderBy: { joined_at: 'asc' },
        });
        if (next) {
          await this.prisma.conversationMember.update({
            where: { id: next.id },
            data: { is_admin: true },
          });
        }
      }
    }
    return { success: true };
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

    // กติกาคำขอส่งข้อความ: ผู้ขอส่งได้ 1 ข้อความจนกว่าปลายทางจะตอบรับ
    // ปลายทางพิมพ์ตอบเมื่อไหร่ = ตอบรับอัตโนมัติ
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { is_request: true, requested_by: true },
    });
    if (conversation?.is_request) {
      if (conversation.requested_by === userId) {
        const sent = await this.prisma.message.count({
          where: { conversation_id: conversationId, deleted_at: null },
        });
        if (sent >= 1) {
          throw new ForbiddenException(
            'ส่งข้อความแรกไปแล้ว — รออีกฝ่ายตอบรับก่อนจึงจะคุยต่อได้',
          );
        }
      } else {
        await this.prisma.conversation.update({
          where: { id: conversationId },
          data: { is_request: false, requested_by: null },
        });
      }
    }

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
