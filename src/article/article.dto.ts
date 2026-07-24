import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ArticleStatus } from '@prisma/client';

export class CreateArticleDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อบทความ' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกเนื้อหา' })
  content: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกหมวดหมู่' })
  category_id: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  cover_image?: string;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateArticleDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  category_id?: string;

  @IsOptional()
  @IsString()
  excerpt?: string;

  @IsOptional()
  @IsString()
  cover_image?: string;

  @IsOptional()
  @IsEnum(ArticleStatus)
  status?: ArticleStatus;

  @IsOptional()
  @IsBoolean()
  is_pinned?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class TrackArticleDto {
  @IsIn(['link', 'file'], { message: 'kind ต้องเป็น link หรือ file' })
  kind: 'link' | 'file';
}

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกความคิดเห็น' })
  content: string;
}

export class UpdateCommentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกความคิดเห็น' })
  content: string;
}
