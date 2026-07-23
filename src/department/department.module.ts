import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.department.findMany({ orderBy: { dept_code: 'asc' } });
  }
}

@Module({ controllers: [DepartmentController] })
export class DepartmentModule {}
