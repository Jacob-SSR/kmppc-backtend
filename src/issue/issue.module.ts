// แจ้งปัญหาการใช้งานระบบ (บั๊ก/ข้อผิดพลาด/ข้อเสนอแนะ)
// POST /issues {page, description, link?, image_urls?}
// ส่งเป็น Notification (type SYSTEM) ถึงผู้ใช้ตำแหน่ง "นักวิชาการคอมพิวเตอร์" ทุกคน
// (ถ้ายังไม่มีใครตำแหน่งนี้ fallback แจ้ง ADMIN แทน) — ไม่เพิ่มตารางใหม่ (schema frozen)

import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Body, Controller, Module, Post, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

const IT_POSITION = 'นักวิชาการคอมพิวเตอร์';

export class CreateIssueDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกหน้าที่พบปัญหา' })
  page: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาอธิบายปัญหาที่พบ' })
  @MaxLength(2000, { message: 'รายละเอียดยาวเกิน 2000 ตัวอักษร' })
  description: string;

  // ลิงก์บทความ/กระทู้/หน้าที่เจอปัญหา (ถ้ามี)
  @IsOptional()
  @IsString()
  link?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'แนบรูปได้สูงสุด 5 รูป' })
  @IsString({ each: true })
  image_urls?: string[];
}

@Controller('issues')
@UseGuards(JwtAuthGuard)
export class IssueController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateIssueDto) {
    // ผู้รับ: ทุกคนตำแหน่งนักวิชาการคอมพิวเตอร์ — ไม่มีเลยค่อยแจ้ง ADMIN
    let recipients = await this.prisma.user.findMany({
      where: { is_active: true, position: { contains: IT_POSITION } },
      select: { id: true },
    });
    if (recipients.length === 0) {
      recipients = await this.prisma.user.findMany({
        where: { is_active: true, role: { role_name: 'ADMIN' } },
        select: { id: true },
      });
    }

    const link = dto.link?.trim();
    const lines = [
      `ผู้แจ้ง: ${user.fname} ${user.lname}`,
      `หน้าที่พบปัญหา: ${dto.page}`,
    ];
    if (link) lines.push(`ลิงก์: ${link}`);
    lines.push('', dto.description.trim());
    if (dto.image_urls?.length) {
      lines.push(
        '',
        ...dto.image_urls.map((u, i) => `[รูปประกอบ ${i + 1}](${u})`),
      );
    }

    await this.prisma.notification.createMany({
      data: recipients.map((r) => ({
        user_id: r.id,
        actor_id: user.id,
        type: 'SYSTEM' as const,
        title: '🐞 มีผู้แจ้งปัญหาการใช้งานระบบ',
        message: lines.join('\n'),
        url: link || '/notifications',
      })),
    });
    return { success: true, notified: recipients.length };
  }
}

@Module({ controllers: [IssueController] })
export class IssueModule {}
