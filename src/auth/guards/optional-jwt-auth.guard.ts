import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// เหมือน JwtAuthGuard แต่ไม่ throw เมื่อไม่มี/token ใช้ไม่ได้ — request.user เป็น null แทน
// ใช้กับ route สาธารณะที่อยากรู้ viewer (เช่น liked_by_me) ถ้าผู้ใช้ login อยู่
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
