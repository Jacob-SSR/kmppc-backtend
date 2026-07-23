import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { ConversationType, MessageType } from '@prisma/client';

export class CreateConversationDto {
  @IsIn(['DIRECT', 'GROUP'], { message: 'ประเภทห้องสนทนาไม่ถูกต้อง' })
  type: ConversationType;

  @ValidateIf((o: CreateConversationDto) => o.type === 'GROUP')
  @IsString()
  @IsNotEmpty({ message: 'กรุณาตั้งชื่อกลุ่มสนทนา' })
  name?: string;

  @IsArray({ message: 'กรุณาระบุรายชื่อสมาชิก' })
  @ArrayNotEmpty({ message: 'กรุณาเลือกสมาชิกอย่างน้อย 1 คน' })
  @IsString({ each: true, message: 'รหัสสมาชิกไม่ถูกต้อง' })
  member_ids: string[];
}

export class SendMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกข้อความ' })
  message: string;

  @IsOptional()
  @IsEnum(MessageType, { message: 'ประเภทข้อความไม่ถูกต้อง' })
  message_type?: MessageType;
}

export class EditMessageDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกข้อความ' })
  message: string;
}

export class MarkReadDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุข้อความที่อ่านล่าสุด' })
  message_id: string;
}
