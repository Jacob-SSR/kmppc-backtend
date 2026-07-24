import {
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ใช้งาน' })
  username: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกรหัสผ่าน' })
  password: string;

  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class RegisterDto {
  // ไม่บังคับแล้ว — ถ้าไม่ส่งมา ระบบสร้างรหัสอัตโนมัติ (คอลัมน์เป็น unique)
  @IsOptional()
  @IsString()
  employee_no?: string;

  // ชื่อที่แสดงในเว็บ — ว่าง = ใช้ชื่อจริง
  @IsOptional()
  @IsString()
  display_name?: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อ' })
  fname: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกนามสกุล' })
  lname: string;

  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกชื่อผู้ใช้งาน' })
  username: string;

  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  password: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณาเลือกแผนก/ฝ่าย' })
  dept_id: string;

  @IsString()
  @IsNotEmpty({ message: 'กรุณากรอกตำแหน่ง' })
  position: string;
}

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'รูปแบบอีเมลไม่ถูกต้อง' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @MinLength(8, { message: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' })
  password: string;
}
