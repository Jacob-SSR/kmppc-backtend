import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import type { SystemSetting, User } from '@prisma/client';
import { IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

export class UpdateSettingDto {
  @IsString({ message: 'ค่าที่ตั้งต้องเป็นข้อความ' })
  value: string;
}

@Injectable()
export class SettingService {
  // cache ในหน่วยความจำ — โหลดทั้งหมดครั้งแรก, invalidate เมื่ออัปเดต
  private cache: Map<string, SystemSetting> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async loadCache() {
    const rows = await this.prisma.systemSetting.findMany();
    this.cache = new Map(rows.map((row) => [row.key, row]));
    return this.cache;
  }

  async get(key: string): Promise<string | undefined> {
    const cache = this.cache ?? (await this.loadCache());
    return cache.get(key)?.value;
  }

  async findAll() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } });
  }

  async update(key: string, value: string, updatedBy: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting) {
      throw new NotFoundException('ไม่พบการตั้งค่านี้');
    }
    const updated = await this.prisma.systemSetting.update({
      where: { key },
      data: { value, updated_by: updatedBy },
    });
    this.cache = null; // invalidate cache
    return updated;
  }
}

@Controller('settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class SettingController {
  constructor(private readonly settingService: SettingService) {}

  @Get()
  findAll() {
    return this.settingService.findAll();
  }

  @Patch(':key')
  update(
    @CurrentUser() user: User,
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
  ) {
    return this.settingService.update(key, dto.value, user.id);
  }
}

@Module({
  controllers: [SettingController],
  providers: [SettingService],
  exports: [SettingService],
})
export class SettingModule {}
