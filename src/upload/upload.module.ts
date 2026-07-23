import {
  BadRequestException,
  Body,
  Controller,
  InternalServerErrorException,
  Module,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as streamifier from 'streamifier';
import { memoryStorage } from 'multer';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

export class DeleteUploadDto {
  @IsString()
  @IsNotEmpty({ message: 'กรุณาระบุ public_id ของไฟล์' })
  public_id: string;
}

@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  @Post()
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('กรุณาแนบไฟล์ที่ต้องการอัปโหลด');
    }
    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'km-system', resource_type: 'auto' },
          (error, uploaded) => {
            if (error || !uploaded) {
              reject(
                error instanceof Error ? error : new Error('upload failed'),
              );
              return;
            }
            resolve(uploaded);
          },
        );
        streamifier.createReadStream(file.buffer).pipe(stream);
      });
    } catch {
      throw new InternalServerErrorException(
        'อัปโหลดไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      );
    }
    return {
      url: result.secure_url,
      public_id: result.public_id,
      filetype: file.mimetype,
      filesize: file.size,
      filename: file.originalname,
    };
  }

  @Post('delete')
  async remove(@Body() dto: DeleteUploadDto) {
    try {
      await cloudinary.uploader.destroy(dto.public_id, {
        resource_type: 'image',
      });
      // ไฟล์ที่ไม่ใช่รูป (raw/video) ต้องระบุ resource_type ให้ตรง — ลองลบเผื่อไว้
      await cloudinary.uploader.destroy(dto.public_id, {
        resource_type: 'raw',
      });
    } catch {
      throw new InternalServerErrorException('ลบไฟล์ไม่สำเร็จ');
    }
    return { success: true };
  }
}

@Module({ controllers: [UploadController] })
export class UploadModule {}
