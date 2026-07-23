import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { KnowledgeDocType } from '@prisma/client';

export class CreateKnowledgeDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อเอกสาร' })
  title: string;

  @IsEnum(KnowledgeDocType, {
    message: 'ประเภทเอกสารต้องเป็น MANUAL, SOP หรือ FAQ',
  })
  doc_type: KnowledgeDocType;

  @IsOptional()
  @IsString()
  description?: string;

  /** เนื้อหาข้อความตรง ๆ (เช่น FAQ) — ถ้าไม่ใส่ต้องมี file_url ให้ worker สกัดข้อความ */
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  file_url?: string;

  @IsOptional()
  @IsString()
  file_public_id?: string;

  @IsOptional()
  @IsString()
  dept_id?: string;
}

export class UpdateKnowledgeDocumentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'ชื่อเอกสารห้ามว่าง' })
  title?: string;

  @IsOptional()
  @IsEnum(KnowledgeDocType, {
    message: 'ประเภทเอกสารต้องเป็น MANUAL, SOP หรือ FAQ',
  })
  doc_type?: KnowledgeDocType;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  file_url?: string;

  @IsOptional()
  @IsString()
  file_public_id?: string;

  @IsOptional()
  @IsString()
  dept_id?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
