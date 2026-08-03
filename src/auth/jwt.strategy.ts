import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

const cookieExtractor = (req: Request): string | null =>
  (req?.cookies?.['access_token'] as string) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'dev-access-secret'),
    });
  }

  // cache ผลตรวจ user ต่อ request สั้น ๆ — ทุก request ที่ login ต้องผ่านตรงนี้
  // ถ้า query DB ทุกครั้ง (join role+department) จะเป็นคอขวดหลักของ latency
  // TTL 10 วิ: ปิดบัญชี (is_active=false) มีผลช้าสุด 10 วิ ซึ่งยอมรับได้
  private readonly userCache = new Map<
    string,
    { user: Awaited<ReturnType<JwtStrategy['loadUser']>>; expires: number }
  >();

  private loadUser(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { role: true, department: true },
    });
  }

  async validate(payload: JwtPayload) {
    const cached = this.userCache.get(payload.sub);
    if (cached && cached.expires > Date.now()) {
      const user = cached.user;
      if (!user || !user.is_active) {
        throw new UnauthorizedException('บัญชีนี้ไม่สามารถใช้งานได้');
      }
      return user;
    }
    const user = await this.loadUser(payload.sub);
    this.userCache.set(payload.sub, { user, expires: Date.now() + 10_000 });
    // กัน Map โตไม่จำกัดเมื่อผู้ใช้เยอะ — ล้างรายการหมดอายุเป็นระยะ
    if (this.userCache.size > 1_000) {
      const now = Date.now();
      for (const [key, value] of this.userCache) {
        if (value.expires <= now) this.userCache.delete(key);
      }
    }
    if (!user || !user.is_active) {
      throw new UnauthorizedException('บัญชีนี้ไม่สามารถใช้งานได้');
    }
    return user;
  }
}
