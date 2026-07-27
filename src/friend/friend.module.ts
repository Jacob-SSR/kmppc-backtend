// ระบบเพื่อน (แอดเฟรน) —
// POST   /friends/:userId          ส่งคำขอเป็นเพื่อน (แจ้งเตือน realtime ถึงปลายทาง)
// POST   /friends/:id/accept       ตอบรับคำขอ (เฉพาะผู้ถูกขอ)
// DELETE /friends/:id              ปฏิเสธ/ยกเลิกคำขอ หรือเลิกเป็นเพื่อน
// GET    /friends                  { friends, incoming, outgoing }

import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../common/notify.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const friendUserSelect = {
  id: true,
  fname: true,
  lname: true,
  display_name: true,
  position: true,
  profile_image: true,
  department: { select: { dept_name: true } },
} as const;

const displayOf = (u: {
  fname: string;
  lname: string | null;
  display_name?: string | null;
}) => u.display_name?.trim() || `${u.fname} ${u.lname ?? ''}`.trim();

@Controller('friends')
@UseGuards(JwtAuthGuard)
export class FriendController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  @Get()
  async list(@CurrentUser() user: User) {
    const rows = await this.prisma.friendship.findMany({
      where: {
        OR: [{ requester_id: user.id }, { addressee_id: user.id }],
      },
      include: {
        requester: { select: friendUserSelect },
        addressee: { select: friendUserSelect },
      },
      orderBy: { created_at: 'desc' },
    });
    type FriendUser = (typeof rows)[number]['requester'];
    const friends: {
      friendship_id: string;
      since: Date | null;
      user: FriendUser;
    }[] = [];
    const incoming: { friendship_id: string; user: FriendUser }[] = [];
    const outgoing: { friendship_id: string; user: FriendUser }[] = [];
    for (const f of rows) {
      const other = f.requester_id === user.id ? f.addressee : f.requester;
      const item = { friendship_id: f.id, since: f.responded_at, user: other };
      if (f.status === 'ACCEPTED') friends.push(item);
      else if (f.addressee_id === user.id)
        incoming.push({ friendship_id: f.id, user: other });
      else outgoing.push({ friendship_id: f.id, user: other });
    }
    return { friends, incoming, outgoing };
  }

  @Post(':userId')
  async request(@CurrentUser() user: User, @Param('userId') userId: string) {
    if (userId === user.id) {
      throw new BadRequestException('เพิ่มตัวเองเป็นเพื่อนไม่ได้');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: userId, is_active: true },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');

    const existing = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { requester_id: user.id, addressee_id: userId },
          { requester_id: userId, addressee_id: user.id },
        ],
      },
    });
    if (existing?.status === 'ACCEPTED') {
      throw new BadRequestException('เป็นเพื่อนกันอยู่แล้ว');
    }
    if (existing) {
      // อีกฝ่ายเคยส่งคำขอมาหาเราค้างอยู่ → ถือว่าตอบรับกันเลย
      if (existing.addressee_id === user.id) {
        return this.acceptInternal(existing.id, user);
      }
      throw new BadRequestException('ส่งคำขอไปแล้ว รออีกฝ่ายตอบรับ');
    }

    const friendship = await this.prisma.friendship.create({
      data: { requester_id: user.id, addressee_id: userId },
    });
    await this.notify.send({
      user_id: userId,
      actor_id: user.id,
      type: 'SYSTEM',
      title: '👋 คำขอเป็นเพื่อนใหม่',
      message: `${displayOf(user)} ส่งคำขอเป็นเพื่อนถึงคุณ — ตอบรับได้ที่หน้าแชท`,
      url: '/chat',
    });
    return friendship;
  }

  @Post(':id/accept')
  async accept(@CurrentUser() user: User, @Param('id') id: string) {
    return this.acceptInternal(id, user);
  }

  private async acceptInternal(id: string, user: User) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id },
    });
    if (!friendship) throw new NotFoundException('ไม่พบคำขอเป็นเพื่อนนี้');
    if (friendship.addressee_id !== user.id) {
      throw new ForbiddenException('ตอบรับได้เฉพาะคำขอที่ส่งถึงคุณ');
    }
    if (friendship.status === 'ACCEPTED') return friendship;
    const updated = await this.prisma.friendship.update({
      where: { id },
      data: { status: 'ACCEPTED', responded_at: new Date() },
    });
    await this.notify.send({
      user_id: friendship.requester_id,
      actor_id: user.id,
      type: 'SYSTEM',
      title: '🎉 เป็นเพื่อนกันแล้ว',
      message: `${displayOf(user)} ตอบรับคำขอเป็นเพื่อนของคุณแล้ว เริ่มแชทกันได้เลย`,
      url: '/chat',
    });
    return updated;
  }

  // ปฏิเสธคำขอ / ยกเลิกคำขอที่ส่งไป / เลิกเป็นเพื่อน — ลบแถวทิ้งเหมือนกันหมด
  @Delete(':id')
  async remove(@CurrentUser() user: User, @Param('id') id: string) {
    const friendship = await this.prisma.friendship.findUnique({
      where: { id },
    });
    if (!friendship) throw new NotFoundException('ไม่พบข้อมูลเพื่อนนี้');
    if (
      friendship.requester_id !== user.id &&
      friendship.addressee_id !== user.id
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการรายการนี้');
    }
    await this.prisma.friendship.delete({ where: { id } });
    return { success: true };
  }
}

@Module({ controllers: [FriendController] })
export class FriendModule {}
