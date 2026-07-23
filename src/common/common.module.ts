import { Module } from '@nestjs/common';
import { ActivityLogInterceptor } from './activity-log.interceptor';

// orchestrator จะเป็นคน register interceptor นี้แบบ global (APP_INTERCEPTOR) เอง
@Module({
  providers: [ActivityLogInterceptor],
  exports: [ActivityLogInterceptor],
})
export class CommonModule {}
