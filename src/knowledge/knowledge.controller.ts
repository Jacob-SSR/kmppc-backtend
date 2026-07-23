// KnowledgeDocument admin endpoints — ADMIN เท่านั้นทุก endpoint
// GET    /api/knowledge-documents      → รายการเอกสาร (แสดง index_status)
// POST   /api/knowledge-documents      → สร้าง + enqueue indexing
// PATCH  /api/knowledge-documents/:id  → แก้ไข + enqueue re-indexing
// DELETE /api/knowledge-documents/:id  → soft delete + unindex

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { KnowledgeService } from './knowledge.service';
import {
  CreateKnowledgeDocumentDto,
  UpdateKnowledgeDocumentDto,
} from './knowledge.dto';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

@Controller('knowledge-documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  findAll() {
    return this.knowledge.findAll();
  }

  @Post()
  create(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateKnowledgeDocumentDto,
  ) {
    return this.knowledge.create(user.id, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeDocumentDto) {
    return this.knowledge.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.knowledge.softDelete(id);
  }
}
