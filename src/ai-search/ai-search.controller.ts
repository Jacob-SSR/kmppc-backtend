// AI Search endpoints (ต้อง login, จำกัด 10 ครั้ง/นาที ตาม SPEC):
// POST /api/ai-search                  {query}          → ถามฐานความรู้ (RAG, ตอบ JSON ก้อนเดียว)
// GET  /api/ai-search/stream?q=...                      → ถามแบบ SSE (event: sources → chunk... → done)
// POST /api/ai-search/web              {query}          → ค้นจากอินเทอร์เน็ต (Google Search grounding)
// POST /api/ai-search/:logId/feedback  {was_helpful}    → ให้ feedback คำตอบของตัวเอง

import {
  Body,
  Controller,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiSearchService } from './ai-search.service';
import { AskDto, FeedbackDto } from './ai-search.dto';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

interface SseMessage {
  type: string;
  data: unknown;
}

@Controller('ai-search')
@UseGuards(JwtAuthGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AiSearchController {
  constructor(private readonly aiSearch: AiSearchService) {}

  @Post()
  ask(@CurrentUser() user: AuthedUser, @Body() dto: AskDto) {
    return this.aiSearch.ask(user.id, dto.query);
  }

  @Sse('stream')
  stream(
    @CurrentUser() user: AuthedUser,
    @Query('q') q?: string,
  ): Observable<SseMessage> {
    const query = (q ?? '').trim();
    return new Observable<SseMessage>((subscriber) => {
      if (!query) {
        subscriber.next({
          type: 'done',
          data: { found: false, message: 'กรุณากรอกคำถาม' },
        });
        subscriber.complete();
        return;
      }
      void (async () => {
        try {
          for await (const event of this.aiSearch.askStream(user.id, query)) {
            subscriber.next({ type: event.type, data: event.data });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();
    });
  }

  @Post('web')
  askWeb(@CurrentUser() user: AuthedUser, @Body() dto: AskDto) {
    return this.aiSearch.askWeb(user.id, dto.query);
  }

  @Post(':logId/feedback')
  feedback(
    @Param('logId') logId: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: FeedbackDto,
  ) {
    return this.aiSearch.feedback(logId, user.id, dto.was_helpful);
  }
}
