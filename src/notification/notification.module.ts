import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findMine(
    @CurrentUser() user: User,
    @Query('page') pageRaw?: string,
    @Query('limit') limitRaw?: string,
    @Query('unread') unread?: string,
  ) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = Math.min(50, Number(limitRaw) || 10);
    const where = {
      user_id: user.id,
      ...(unread === 'true' ? { is_read: false } : {}),
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: { user_id: user.id, is_read: false },
      }),
    ]);
    return { items, total, unread_count: unreadCount, page, limit };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: User, @Param('id') id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, user_id: user.id },
    });
    if (!notification) {
      throw new NotFoundException('ไม่พบการแจ้งเตือนนี้');
    }
    const updated = await this.prisma.notification.update({
      where: { id },
      data: { is_read: true },
    });
    return updated;
  }

  @Post('read-all')
  async markAllRead(@CurrentUser() user: User) {
    const result = await this.prisma.notification.updateMany({
      where: { user_id: user.id, is_read: false },
      data: { is_read: true },
    });
    return { success: true, updated_count: result.count };
  }
}

@Module({ controllers: [NotificationController] })
export class NotificationModule {}
