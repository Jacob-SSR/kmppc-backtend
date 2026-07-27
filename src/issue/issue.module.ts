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
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifyService } from '../common/notify.service';
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

export class ContactDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ติดต่อ' })
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contact?: string; // อีเมล/เบอร์โทร/แผนก สำหรับติดต่อกลับ

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกข้อความ' })
  @MaxLength(2000)
  message: string;
}

@Controller('issues')
@UseGuards(JwtAuthGuard)
export class IssueController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

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

    return this.notify.sendMany(
      recipients.map((r) => r.id),
      {
        actor_id: user.id,
        type: 'SYSTEM',
        title: '🐞 มีผู้แจ้งปัญหาการใช้งานระบบ',
        message: lines.join('\n'),
        url: link || '/notifications',
      },
    );
  }
}

// หน้า "ติดต่อเรา" — เปิดรับจากคนที่ยังไม่ login ด้วย (จำกัด 5 ครั้ง/นาที กัน spam)
@Controller('contact')
export class ContactController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
  ) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async create(@Body() dto: ContactDto) {
    const admins = await this.prisma.user.findMany({
      where: { is_active: true, role: { role_name: 'ADMIN' } },
      select: { id: true },
    });
    const lines = [`ผู้ติดต่อ: ${dto.name.trim()}`];
    if (dto.contact?.trim())
      lines.push(`ช่องทางติดต่อกลับ: ${dto.contact.trim()}`);
    lines.push('', dto.message.trim());
    await this.notify.sendMany(
      admins.map((a) => a.id),
      {
        actor_id: null,
        type: 'SYSTEM',
        title: '📩 มีข้อความจากหน้าติดต่อเรา',
        message: lines.join('\n'),
        url: '/notifications',
      },
    );
    return { success: true };
  }
}

@Module({ controllers: [IssueController, ContactController] })
export class IssueModule {}
