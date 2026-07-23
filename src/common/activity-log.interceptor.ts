import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { PrismaService } from '../prisma/prisma.service';

const MUTATING_METHODS = ['POST', 'PATCH', 'DELETE', 'PUT'];
const SKIP_PATHS = ['/auth/login', '/auth/refresh'];

@Injectable()
export class ActivityLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: { id: string } }>();

    const method = req.method?.toUpperCase();
    const path = req.path ?? '';
    // ตัด global prefix (/api) ออกก่อนแยก segment
    const cleanPath = path.replace(/^\/api(?=\/|$)/, '');

    const shouldLog =
      MUTATING_METHODS.includes(method) &&
      !SKIP_PATHS.some((p) => cleanPath.startsWith(p)) &&
      !!req.user?.id;

    if (!shouldLog) return next.handle();

    const segment = cleanPath.split('/').filter(Boolean)[0] ?? '';
    const userId = req.user!.id;
    const targetId = (req.params?.id as string | undefined) ?? '';
    const ip = req.ip;

    return next.handle().pipe(
      tap(() => {
        // fire-and-forget — ห้าม block หรือทำให้ request ล้มเพราะ log ไม่สำเร็จ
        this.prisma.activityLog
          .create({
            data: {
              user_id: userId,
              action: `${method}_${segment.toUpperCase()}`,
              target_table: segment,
              target_id: targetId,
              ip_address: ip,
            },
          })
          .catch(() => undefined);
      }),
    );
  }
}
