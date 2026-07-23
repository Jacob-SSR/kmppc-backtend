import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiscussionService } from './discussion.service';
import { CreateDiscussionDto, CreateReplyDto } from './discussion.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

@Controller('discussions')
export class DiscussionController {
  constructor(private readonly discussions: DiscussionService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category_id') category_id?: string,
    @Query('q') q?: string,
  ) {
    return this.discussions.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      category_id,
      q,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.discussions.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateDiscussionDto) {
    return this.discussions.create(user.id, dto);
  }

  @Post(':id/replies')
  @UseGuards(JwtAuthGuard)
  addReply(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateReplyDto,
  ) {
    return this.discussions.addReply(id, user.id, dto);
  }

  @Post(':id/replies/:replyId/best-answer')
  @UseGuards(JwtAuthGuard)
  markBestAnswer(
    @Param('id') id: string,
    @Param('replyId') replyId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.discussions.markBestAnswer(
      id,
      replyId,
      user.id,
      user.role.role_name === 'ADMIN',
    );
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  toggleLike(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.discussions.toggleLike(id, user.id);
  }
}
