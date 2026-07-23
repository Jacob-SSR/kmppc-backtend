import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateCategoryDto, UpdateCategoryDto } from './category.dto';

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

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException('ไม่พบหมวดหมู่นี้');
    }
    if (dto.category_name && dto.category_name !== category.category_name) {
      const duplicate = await this.prisma.category.findUnique({
        where: { category_name: dto.category_name },
      });
      if (duplicate) {
        throw new ConflictException('มีหมวดหมู่ชื่อนี้อยู่แล้ว');
      }
    }
    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.category_name !== undefined && {
          category_name: dto.category_name,
        }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
      },
      include: {
        _count: {
          select: {
            articles: { where: { deleted_at: null, status: 'PUBLISHED' } },
            discussions: { where: { deleted_at: null } },
          },
        },
      },
    });
    return {
      id: updated.id,
      category_name: updated.category_name,
      description: updated.description,
      article_count: updated._count.articles,
      discussion_count: updated._count.discussions,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        // นับทุกแถวรวมที่ soft-delete แล้ว เพราะ FK เป็น Restrict ระดับ DB
        _count: { select: { articles: true, discussions: true } },
      },
    });
    if (!category) {
      throw new NotFoundException('ไม่พบหมวดหมู่นี้');
    }
    if (category._count.articles > 0 || category._count.discussions > 0) {
      throw new ConflictException(
        'ไม่สามารถลบหมวดหมู่ที่มีบทความหรือกระทู้อยู่ได้',
      );
    }
    await this.prisma.category.delete({ where: { id } });
    return { success: true };
  }
}

@Module({ controllers: [CategoryController] })
export class CategoryModule {}
