import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private refreshExpiresDays() {
    return Number(this.config.get('JWT_REFRESH_EXPIRES_DAYS', '7'));
  }

  async register(dto: RegisterDto) {
    const dup = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: dto.username },
          { email: dto.email },
          { employee_no: dto.employee_no },
        ],
      },
    });
    if (dup) {
      throw new ConflictException(
        'ชื่อผู้ใช้งาน อีเมล หรือเลขประจำตัวพนักงานนี้ถูกใช้แล้ว',
      );
    }
    const staffRole = await this.prisma.role.findUnique({
      where: { role_name: 'STAFF' },
    });
    if (!staffRole) throw new ConflictException('ยังไม่ได้ seed ข้อมูล Role');

    const user = await this.prisma.user.create({
      data: {
        role_id: staffRole.id,
        dept_id: dto.dept_id,
        employee_no: dto.employee_no,
        username: dto.username,
        password_hash: await bcrypt.hash(dto.password, 10),
        fname: dto.fname,
        lname: dto.lname,
        email: dto.email,
        position: dto.position,
      },
      include: { role: true, department: true },
    });
    return this.sanitize(user);
  }

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { role: true, department: true },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.password_hash))) {
      throw new UnauthorizedException('ชื่อผู้ใช้งานหรือรหัสผ่านไม่ถูกต้อง');
    }
    if (!user.is_active) {
      throw new UnauthorizedException('บัญชีนี้ถูกระงับการใช้งาน');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    const accessToken = await this.signAccessToken(
      user.id,
      user.username,
      user.role.role_name,
    );
    const refreshToken = await this.issueRefreshToken(user.id, meta);
    return { user: this.sanitize(user), accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { refresh_token_hash: sha256(refreshToken) },
      include: { user: { include: { role: true, department: true } } },
    });
    if (
      !session ||
      session.revoked_at ||
      session.expires_at < new Date() ||
      !session.user.is_active
    ) {
      throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }

    // rotation: revoke ตัวเก่า ออกตัวใหม่
    const newToken = randomBytes(48).toString('hex');
    await this.prisma.$transaction([
      this.prisma.userSession.update({
        where: { id: session.id },
        data: { revoked_at: new Date() },
      }),
      this.prisma.userSession.create({
        data: {
          user_id: session.user_id,
          refresh_token_hash: sha256(newToken),
          user_agent: session.user_agent,
          ip_address: session.ip_address,
          expires_at: new Date(
            Date.now() + this.refreshExpiresDays() * 24 * 60 * 60 * 1000,
          ),
        },
      }),
    ]);

    const accessToken = await this.signAccessToken(
      session.user.id,
      session.user.username,
      session.user.role.role_name,
    );
    return {
      user: this.sanitize(session.user),
      accessToken,
      refreshToken: newToken,
    };
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) return;
    await this.prisma.userSession.updateMany({
      where: { refresh_token_hash: sha256(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async logoutAll(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // ตอบเหมือนกันเสมอ ไม่เปิดเผยว่าอีเมลนี้มีในระบบหรือไม่
    const message = 'หากอีเมลนี้อยู่ในระบบ จะได้รับลิงก์สำหรับตั้งรหัสผ่านใหม่';
    if (!user || !user.is_active) return { message };

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        user_id: user.id,
        token: sha256(token),
        expires_at: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    // TODO: ต่อ email service แล้วส่งลิงก์ `${FRONTEND_URL}/reset-password?token=...`
    // ระหว่างยังไม่มี mailer: คืน token ตรง ๆ เฉพาะนอก production เพื่อให้ทดสอบได้
    if (this.config.get('NODE_ENV') !== 'production') {
      return { message, reset_token: token };
    }
    return { message };
  }

  async resetPassword(token: string, password: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { token: sha256(token) },
    });
    if (!record || record.used_at || record.expires_at < new Date()) {
      throw new UnauthorizedException(
        'ลิงก์ตั้งรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว',
      );
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.user_id },
        data: { password_hash: await bcrypt.hash(password, 10) },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { used_at: new Date() },
      }),
      // เปลี่ยนรหัสแล้วบังคับออกจากระบบทุกเครื่อง
      this.prisma.userSession.updateMany({
        where: { user_id: record.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      }),
    ]);
    return { message: 'ตั้งรหัสผ่านใหม่เรียบร้อย กรุณาเข้าสู่ระบบอีกครั้ง' };
  }

  private async issueRefreshToken(
    userId: string,
    meta: { userAgent?: string; ip?: string },
  ) {
    const token = randomBytes(48).toString('hex');
    await this.prisma.userSession.create({
      data: {
        user_id: userId,
        refresh_token_hash: sha256(token),
        user_agent: meta.userAgent,
        ip_address: meta.ip,
        expires_at: new Date(
          Date.now() + this.refreshExpiresDays() * 24 * 60 * 60 * 1000,
        ),
      },
    });
    return token;
  }

  private signAccessToken(sub: string, username: string, role: string) {
    return this.jwt.signAsync(
      { sub, username, role },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', 'dev-access-secret'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES', '15m'),
      },
    );
  }

  sanitize<T extends { password_hash?: string }>(user: T) {
    const copy = { ...user };
    delete copy.password_hash;
    return copy;
  }
}
