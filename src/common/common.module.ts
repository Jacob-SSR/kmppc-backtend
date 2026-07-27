import { Global, Module } from '@nestjs/common';
import { ActivityLogInterceptor } from './activity-log.interceptor';
import { NotifyService } from './notify.service';
import { RealtimeRegistry } from './realtime.registry';

// Global: ทุกโมดูล inject NotifyService/RealtimeRegistry ได้โดยไม่ต้อง import ซ้ำ
// orchestrator จะเป็นคน register interceptor นี้แบบ global (APP_INTERCEPTOR) เอง
@Global()
@Module({
  providers: [ActivityLogInterceptor, RealtimeRegistry, NotifyService],
  exports: [ActivityLogInterceptor, RealtimeRegistry, NotifyService],
})
export class CommonModule {}
