import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
