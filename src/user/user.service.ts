import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateProfileDto, UpdateUserDto } from './user.dto';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  private sanitize<T extends { password_hash?: string }>(user: T) {
    const copy = { ...user };
    delete copy.password_hash;
    return copy;
  }

  private async assertNoDuplicate(
    dto: { username?: string; email?: string; employee_no?: string },
    excludeId?: string,
  ) {
    const or: Prisma.UserWhereInput[] = [];
    if (dto.username) or.push({ username: dto.username });
    if (dto.email) or.push({ email: dto.email });
    if (dto.employee_no) or.push({ employee_no: dto.employee_no });
    if (or.length === 0) return;

    const dup = await this.prisma.user.findFirst({
      where: { OR: or, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    });
    if (!dup) return;
    if (dto.username && dup.username === dto.username) {
      throw new ConflictException('มีชื่อผู้ใช้งานนี้อยู่แล้ว');
    }
    if (dto.email && dup.email === dto.email) {
      throw new ConflictException('มีอีเมลนี้อยู่แล้ว');
    }
    throw new ConflictException('มีเลขประจำตัวพนักงานนี้อยู่แล้ว');
  }

  // รายชื่อสำหรับเริ่มแชท — เฉพาะบัญชีที่ใช้งานอยู่ ไม่รวมตัวเอง เปิดเผยข้อมูลพื้นฐานเท่านั้น
  async directory(viewerId: string, q?: string) {
    const keyword = q?.trim();
    return this.prisma.user.findMany({
      where: {
        is_active: true,
        id: { not: viewerId },
        ...(keyword
          ? {
              OR: [
                { fname: { contains: keyword } },
                { lname: { contains: keyword } },
                { username: { contains: keyword } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        fname: true,
        lname: true,
        display_name: true,
        position: true,
        profile_image: true,
        department: { select: { dept_name: true } },
      },
      orderBy: { fname: 'asc' },
      take: 20,
    });
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    q?: string;
    dept_id?: string;
    is_active?: string;
  }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Number(params.limit) || 20);
    const where: Prisma.UserWhereInput = {
      ...(params.q
        ? {
            OR: [
              { fname: { contains: params.q } },
              { lname: { contains: params.q } },
              { username: { contains: params.q } },
              { employee_no: { contains: params.q } },
            ],
          }
        : {}),
      ...(params.dept_id ? { dept_id: params.dept_id } : {}),
      ...(params.is_active === 'true'
        ? { is_active: true }
        : params.is_active === 'false'
          ? { is_active: false }
          : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { role: true, department: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items: items.map((u) => this.sanitize(u)), total, page, limit };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');
    return this.sanitize(user);
  }

  async create(dto: CreateUserDto) {
    await this.assertNoDuplicate(dto);
    const user = await this.prisma.user.create({
      data: {
        role_id: dto.role_id,
        dept_id: dto.dept_id,
        employee_no: dto.employee_no,
        username: dto.username,
        email: dto.email,
        password_hash: await bcrypt.hash(dto.password, 10),
        fname: dto.fname,
        lname: dto.lname,
        phone: dto.phone,
        position: dto.position,
      },
      include: { role: true, department: true },
    });
    return this.sanitize(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');

    await this.assertNoDuplicate(
      {
        username:
          dto.username && dto.username !== existing.username
            ? dto.username
            : undefined,
        email:
          dto.email && dto.email !== existing.email ? dto.email : undefined,
        employee_no:
          dto.employee_no && dto.employee_no !== existing.employee_no
            ? dto.employee_no
            : undefined,
      },
      id,
    );

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.employee_no !== undefined && { employee_no: dto.employee_no }),
        ...(dto.username !== undefined && { username: dto.username }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.password !== undefined && {
          password_hash: await bcrypt.hash(dto.password, 10),
        }),
        ...(dto.fname !== undefined && { fname: dto.fname }),
        ...(dto.lname !== undefined && { lname: dto.lname }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.role_id !== undefined && { role_id: dto.role_id }),
        ...(dto.dept_id !== undefined && { dept_id: dto.dept_id }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
      include: { role: true, department: true },
    });
    return this.sanitize(user);
  }

  /** โปรไฟล์สาธารณะ (สมาชิกที่ login ดูได้) — เปิดเผยชื่อจริง ตำแหน่ง แผนก ไม่เปิดเผยอีเมล/เบอร์ */
  async publicProfile(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, is_active: true },
      select: {
        id: true,
        fname: true,
        lname: true,
        display_name: true,
        position: true,
        profile_image: true,
        created_at: true,
        department: { select: { id: true, dept_name: true } },
        _count: {
          select: {
            articles: { where: { deleted_at: null, status: 'PUBLISHED' } },
            discussions: { where: { deleted_at: null, is_anonymous: false } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');
    // ผลงานล่าสุดของคนนี้ — บทความเผยแพร่ + กระทู้ที่ไม่ anonymous
    const [articles, discussions] = await Promise.all([
      this.prisma.article.findMany({
        where: { author_id: id, deleted_at: null, status: 'PUBLISHED' },
        orderBy: { published_at: 'desc' },
        take: 12,
        select: {
          id: true,
          slug: true,
          title: true,
          cover_image: true,
          view_count: true,
          published_at: true,
          category: { select: { category_name: true } },
          _count: { select: { comments: true, likes: true } },
        },
      }),
      this.prisma.discussion.findMany({
        where: { author_id: id, deleted_at: null, is_anonymous: false },
        orderBy: { created_at: 'desc' },
        take: 12,
        select: {
          id: true,
          title: true,
          is_solved: true,
          view_count: true,
          created_at: true,
          category: { select: { category_name: true } },
          _count: {
            select: { replies: { where: { deleted_at: null } }, likes: true },
          },
        },
      }),
    ]);
    return { ...user, articles, discussions };
  }

  /** หาผู้ใช้จากรหัสเพื่อน (8 ตัวแรกของ id, ไม่สนตัวพิมพ์) — ใช้เริ่มแชท */
  async findByCode(viewerId: string, code: string) {
    const normalized = code.trim().toLowerCase();
    if (normalized.length < 6) {
      throw new NotFoundException('รหัสเพื่อนต้องมีอย่างน้อย 6 ตัวอักษร');
    }
    const user = await this.prisma.user.findFirst({
      where: {
        id: { startsWith: normalized },
        is_active: true,
        NOT: { id: viewerId },
      },
      select: {
        id: true,
        fname: true,
        lname: true,
        display_name: true,
        position: true,
        profile_image: true,
        department: { select: { dept_name: true } },
      },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้จากรหัสนี้');
    return user;
  }

  /**
   * ลบบัญชีถาวรพร้อมข้อมูลทั้งหมด (โพสต์/คอมเมนต์/แชท/log) — สำหรับบัญชีทดสอบ
   * ADMIN เท่านั้น, ห้ามลบตัวเอง/บัญชี ADMIN — บัญชีจริงให้ใช้ปิดใช้งาน (is_active)
   */
  async purge(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('ลบบัญชีของตัวเองไม่ได้');
    }
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งานนี้');
    if (user.role.role_name === 'ADMIN') {
      throw new BadRequestException(
        'ลบบัญชีผู้ดูแลระบบไม่ได้ — ใช้ปิดใช้งานแทน',
      );
    }
    // ลำดับสำคัญ: ลบตารางลูกก่อน (FK ทุกตัวเป็น Restrict ตาม schema)
    await this.prisma.$transaction([
      this.prisma.activityLog.deleteMany({ where: { user_id: id } }),
      this.prisma.userSession.deleteMany({ where: { user_id: id } }),
      this.prisma.passwordResetToken.deleteMany({ where: { user_id: id } }),
      this.prisma.searchLog.deleteMany({ where: { user_id: id } }),
      this.prisma.aiSearchLog.deleteMany({ where: { user_id: id } }),
      this.prisma.notification.deleteMany({
        where: { OR: [{ user_id: id }, { actor_id: id }] },
      }),
      this.prisma.commentLike.deleteMany({ where: { user_id: id } }),
      this.prisma.articleLike.deleteMany({ where: { user_id: id } }),
      this.prisma.articleView.deleteMany({ where: { user_id: id } }),
      this.prisma.discussionLike.deleteMany({ where: { user_id: id } }),
      this.prisma.replyLike.deleteMany({ where: { user_id: id } }),
      this.prisma.bookmark.deleteMany({ where: { user_id: id } }),
      // รายงานที่เขาแจ้ง/ตรวจ และรายงานที่ชี้ไปเนื้อหาของเขา
      this.prisma.report.deleteMany({
        where: {
          OR: [
            { reporter_id: id },
            { reviewed_by: id },
            { article: { author_id: id } },
            { discussion: { author_id: id } },
            { reply: { user_id: id } },
            { comment: { user_id: id } },
          ],
        },
      }),
      this.prisma.attachment.deleteMany({ where: { uploaded_by: id } }),
      this.prisma.message.deleteMany({ where: { sender_id: id } }),
      this.prisma.conversationMember.deleteMany({ where: { user_id: id } }),
      this.prisma.conversation.deleteMany({ where: { created_by: id } }),
      this.prisma.comment.deleteMany({ where: { user_id: id } }),
      this.prisma.reply.deleteMany({ where: { user_id: id } }),
      this.prisma.discussion.deleteMany({ where: { author_id: id } }),
      this.prisma.articleVersion.deleteMany({ where: { edited_by: id } }),
      this.prisma.article.deleteMany({ where: { author_id: id } }),
      this.prisma.knowledgeDocument.deleteMany({ where: { uploaded_by: id } }),
      this.prisma.user.delete({ where: { id } }),
    ]);
    return { success: true, message: 'ลบบัญชีและข้อมูลทั้งหมดแล้ว' };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.fname !== undefined && { fname: dto.fname }),
        ...(dto.lname !== undefined && { lname: dto.lname }),
        ...(dto.display_name !== undefined && {
          display_name: dto.display_name.trim() || null,
        }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.profile_image !== undefined && {
          profile_image: dto.profile_image,
        }),
        ...(dto.profile_image_public_id !== undefined && {
          profile_image_public_id: dto.profile_image_public_id,
        }),
      },
      include: { role: true, department: true },
    });
    return this.sanitize(user);
  }
}
