// AI Search endpoints (ต้อง login):
// POST /api/ai-search            {query}                → ถามฐานความรู้ (RAG)
// POST /api/ai-search/:logId/feedback {was_helpful}     → ให้ feedback คำตอบของตัวเอง

import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiSearchService } from './ai-search.service';
import { AskDto, FeedbackDto } from './ai-search.dto';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

@Controller('ai-search')
@UseGuards(JwtAuthGuard)
export class AiSearchController {
  constructor(private readonly aiSearch: AiSearchService) {}

  @Post()
  ask(@CurrentUser() user: AuthedUser, @Body() dto: AskDto) {
    return this.aiSearch.ask(user.id, dto.query);
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
