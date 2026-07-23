import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อแผนก' })
  dept_name: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสแผนก' })
  dept_code: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อแผนก' })
  dept_name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสแผนก' })
  dept_code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
