// สร้าง Notification ลง DB + ยิง realtime ไปหาผู้รับทันที (ผ่าน RealtimeRegistry)
// ใช้แทนการ prisma.notification.create ตรง ๆ ในทุกโมดูล
// กติกา anonymous ยังเหมือนเดิม: actor เป็น anonymous ให้ส่ง actor_id = null

import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeRegistry } from './realtime.registry';

export interface NotifyInput {
  user_id: string;
  actor_id?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  url: string;
}

@Injectable()
export class NotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeRegistry,
  ) {}

  async send(input: NotifyInput) {
    const notification = await this.prisma.notification.create({
      data: {
        user_id: input.user_id,
        actor_id: input.actor_id ?? null,
        type: input.type,
        title: input.title,
        message: input.message,
        url: input.url,
      },
    });
    this.realtime.emitToUser(input.user_id, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      url: notification.url,
      created_at: notification.created_at,
    });
    return notification;
  }

  /** ส่งหลายคนพร้อมกัน (เช่น แจ้งปัญหาถึงทีมคอมทุกคน) */
  async sendMany(userIds: string[], input: Omit<NotifyInput, 'user_id'>) {
    for (const user_id of userIds) {
      await this.send({ ...input, user_id });
    }
    return { notified: userIds.length };
  }
}
