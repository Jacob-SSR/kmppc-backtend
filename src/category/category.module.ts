import {
  Body,
  ConflictException,
  Controller,
  Get,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateCategoryDto } from './category.dto';

@Controller('categories')
export class CategoryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    const categories = await this.prisma.category.findMany({
      orderBy: { category_name: 'asc' },
      include: {
        _count: {
          select: {
            articles: { where: { deleted_at: null, status: 'PUBLISHED' } },
            discussions: { where: { deleted_at: null } },
          },
        },
      },
    });
    return categories.map((c) => ({
      id: c.id,
      category_name: c.category_name,
      description: c.description,
      article_count: c._count.articles,
      discussion_count: c._count.discussions,
    }));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async create(@Body() dto: CreateCategoryDto) {
    const existing = await this.prisma.category.findUnique({
      where: { category_name: dto.category_name },
    });
    if (existing) {
      throw new ConflictException('มีหมวดหมู่ชื่อนี้อยู่แล้ว');
    }
    const category = await this.prisma.category.create({
      data: {
        category_name: dto.category_name,
        description: dto.description ?? null,
      },
    });
    return {
      id: category.id,
      category_name: category.category_name,
      description: category.description,
      article_count: 0,
      discussion_count: 0,
    };
  }
}

@Module({ controllers: [CategoryController] })
export class CategoryModule {}
