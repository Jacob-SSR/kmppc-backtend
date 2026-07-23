import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}

@Module({ controllers: [CategoryController] })
export class CategoryModule {}
