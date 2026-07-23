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
import { IsNotEmpty, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

export class TagDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อแท็ก' })
  tag_name: string;
}

@Controller('tags')
export class TagController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async findAll() {
    const tags = await this.prisma.tag.findMany({
      orderBy: { tag_name: 'asc' },
      include: {
        _count: { select: { articles: true, discussions: true } },
      },
    });
    return tags.map((t) => ({
      id: t.id,
      tag_name: t.tag_name,
      article_count: t._count.articles,
      discussion_count: t._count.discussions,
    }));
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async create(@Body() dto: TagDto) {
    const existing = await this.prisma.tag.findUnique({
      where: { tag_name: dto.tag_name },
    });
    if (existing) throw new ConflictException('มีแท็กชื่อนี้อยู่แล้ว');
    return this.prisma.tag.create({ data: { tag_name: dto.tag_name } });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: TagDto) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('ไม่พบแท็กนี้');
    if (dto.tag_name !== tag.tag_name) {
      const duplicate = await this.prisma.tag.findUnique({
        where: { tag_name: dto.tag_name },
      });
      if (duplicate) throw new ConflictException('มีแท็กชื่อนี้อยู่แล้ว');
    }
    return this.prisma.tag.update({
      where: { id },
      data: { tag_name: dto.tag_name },
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('ไม่พบแท็กนี้');
    await this.prisma.tag.delete({ where: { id } });
    return { success: true };
  }
}

@Module({ controllers: [TagController] })
export class TagModule {}
