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
import { CreateDepartmentDto, UpdateDepartmentDto } from './department.dto';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.department.findMany({ orderBy: { dept_code: 'asc' } });
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async create(@Body() dto: CreateDepartmentDto) {
    const existing = await this.prisma.department.findUnique({
      where: { dept_code: dto.dept_code },
    });
    if (existing) {
      throw new ConflictException('มีแผนกที่ใช้รหัสนี้อยู่แล้ว');
    }
    return this.prisma.department.create({
      data: {
        dept_name: dto.dept_name,
        dept_code: dto.dept_code,
        description: dto.description ?? null,
      },
    });
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    const department = await this.prisma.department.findUnique({
      where: { id },
    });
    if (!department) {
      throw new NotFoundException('ไม่พบแผนกนี้');
    }
    if (dto.dept_code && dto.dept_code !== department.dept_code) {
      const duplicate = await this.prisma.department.findUnique({
        where: { dept_code: dto.dept_code },
      });
      if (duplicate) {
        throw new ConflictException('มีแผนกที่ใช้รหัสนี้อยู่แล้ว');
      }
    }
    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.dept_name !== undefined && { dept_name: dto.dept_name }),
        ...(dto.dept_code !== undefined && { dept_code: dto.dept_code }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async remove(@Param('id') id: string) {
    const department = await this.prisma.department.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!department) {
      throw new NotFoundException('ไม่พบแผนกนี้');
    }
    // User.dept_id เป็น onDelete: Restrict — ต้องย้ายผู้ใช้ออกก่อนถึงลบได้
    if (department._count.users > 0) {
      throw new ConflictException('ไม่สามารถลบแผนกที่มีผู้ใช้สังกัดอยู่ได้');
    }
    await this.prisma.department.delete({ where: { id } });
    return { success: true };
  }
}

@Module({ controllers: [DepartmentController] })
export class DepartmentModule {}
