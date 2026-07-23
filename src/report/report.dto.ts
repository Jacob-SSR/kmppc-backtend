import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateReportDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุเหตุผลในการรายงาน' })
  reason: string;

  @IsOptional()
  @IsString()
  article_id?: string;

  @IsOptional()
  @IsString()
  discussion_id?: string;

  @IsOptional()
  @IsString()
  reply_id?: string;

  @IsOptional()
  @IsString()
  comment_id?: string;
}

export class UpdateReportStatusDto {
  @IsIn(['REVIEWED', 'RESOLVED'], {
    message: 'สถานะต้องเป็น REVIEWED หรือ RESOLVED เท่านั้น',
  })
  status: 'REVIEWED' | 'RESOLVED';
}
