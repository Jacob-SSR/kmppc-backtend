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
import { ArticleService } from './article.service';
import {
  CreateArticleDto,
  CreateCommentDto,
  UpdateArticleDto,
  UpdateCommentDto,
} from './article.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

@Controller('articles')
export class ArticleController {
  constructor(private readonly articles: ArticleService) {}

  @Get()
  findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('category_id') category_id?: string,
    @Query('tag_id') tag_id?: string,
    @Query('sort') sort?: string,
    @Query('q') q?: string,
  ) {
    return this.articles.findAll({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      category_id,
      tag_id,
      sort,
      q,
    });
  }

  // สำคัญ: 'mine' ต้องประกาศก่อน ':slug' ไม่งั้นถูกจับเป็น slug
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: AuthedUser) {
    return this.articles.findMine(user.id);
  }

  @Get(':slug')
  @UseGuards(OptionalJwtAuthGuard)
  findOne(@Param('slug') slug: string, @CurrentUser() user: AuthedUser | null) {
    return this.articles.findBySlug(slug, user?.id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: AuthedUser, @Body() dto: CreateArticleDto) {
    return this.articles.create(user.id, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articles.update(
      id,
      user.id,
      user.role.role_name === 'ADMIN',
      dto,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.articles.softDelete(
      id,
      user.id,
      user.role.role_name === 'ADMIN',
    );
  }

  @Post(':id/like')
  @UseGuards(JwtAuthGuard)
  toggleLike(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.articles.toggleLike(id, user.id);
  }

  @Get(':id/comments')
  @UseGuards(OptionalJwtAuthGuard)
  listComments(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser | null,
  ) {
    return this.articles.listComments(id, user?.id);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  addComment(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateCommentDto,
  ) {
    return this.articles.addComment(id, user.id, dto);
  }

  @Patch(':id/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  updateComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.articles.updateComment(id, commentId, user.id, dto);
  }

  @Delete(':id/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  removeComment(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.articles.deleteComment(
      id,
      commentId,
      user.id,
      user.role.role_name === 'ADMIN',
    );
  }

  @Post(':id/comments/:commentId/like')
  @UseGuards(JwtAuthGuard)
  toggleCommentLike(
    @Param('id') id: string,
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.articles.toggleCommentLike(id, commentId, user.id);
  }
}
