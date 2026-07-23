import { IsBoolean, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AskDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาพิมพ์คำถาม' })
  @MaxLength(2000, { message: 'คำถามยาวเกินไป (สูงสุด 2000 ตัวอักษร)' })
  query: string;
}

export class FeedbackDto {
  @IsBoolean({ message: 'was_helpful ต้องเป็น true หรือ false' })
  was_helpful: boolean;
}
