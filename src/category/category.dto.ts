import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อหมวดหมู่' })
  category_name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
