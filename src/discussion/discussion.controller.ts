import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { DiscussionService } from './discussion.service';
import {
  CreateDiscussionDto,
  CreateReplyDto,
  UpdateReplyDto,
} from './discussion.dto';
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

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.discussions.softDelete(
      id,
      user.id,
      user.role.role_name === 'ADMIN',
    );
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

  @Patch(':id/replies/:replyId')
  @UseGuards(JwtAuthGuard)
  updateReply(
    @Param('id') id: string,
    @Param('replyId') replyId: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateReplyDto,
  ) {
    return this.discussions.updateReply(id, replyId, user.id, dto);
  }

  @Delete(':id/replies/:replyId')
  @UseGuards(JwtAuthGuard)
  removeReply(
    @Param('id') id: string,
    @Param('replyId') replyId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.discussions.softDeleteReply(
      id,
      replyId,
      user.id,
      user.role.role_name === 'ADMIN',
    );
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
