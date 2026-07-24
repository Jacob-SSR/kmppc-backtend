import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateDiscussionDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกหัวข้อกระทู้' })
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรายละเอียด' })
  content: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกหมวดหมู่' })
  category_id: string;

  @IsOptional()
  @IsBoolean()
  is_anonymous?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateDiscussionDto {
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
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}

export class UpdateReplyDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกคำตอบ' })
  content: string;
}

export class CreateReplyDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกคำตอบ' })
  content: string;

  @IsOptional()
  @IsString()
  parent_reply_id?: string;

  @IsOptional()
  @IsBoolean()
  is_anonymous?: boolean;
}
