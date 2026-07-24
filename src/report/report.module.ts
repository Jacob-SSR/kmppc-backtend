import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AiSearchModule } from '../ai-search/ai-search.module';
import { UploadModule } from '../upload/upload.module';
import { ReportService } from './report.service';
import { CreateReportDto, UpdateReportStatusDto } from './report.dto';

@Controller('reports')
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(@CurrentUser() user: User, @Body() dto: CreateReportDto) {
    return this.reportService.create(user.id, dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  findAll(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reportService.findAll({
      status,
      page: Number(page) || undefined,
      limit: Number(limit) || undefined,
    });
  }

  // ลบเนื้อหาที่ถูกรายงาน (ตามประเภทเป้าหมาย) แล้วปิดรายงาน
  @Post(':id/remove-target')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  removeTarget(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reportService.removeTarget(id, user.id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  updateStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateReportStatusDto,
  ) {
    return this.reportService.updateStatus(id, user.id, dto.status);
  }
}

@Module({
  imports: [AiSearchModule, UploadModule],
  controllers: [ReportController],
  providers: [ReportService],
})
export class ReportModule {}
