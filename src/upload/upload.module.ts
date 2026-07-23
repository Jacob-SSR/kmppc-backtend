import {
  BadRequestException,
  Body,
  Controller,
  Injectable,
  InternalServerErrorException,
  Module,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
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
    // multer ถอดรหัสชื่อไฟล์เป็น latin1 — แปลงกลับเป็น utf8 ไม่งั้นชื่อไทยเพี้ยน
    const originalName = Buffer.from(file.originalname, 'latin1').toString(
      'utf8',
    );
    // ไฟล์ที่ไม่ใช่รูปต้องเป็น resource_type 'raw' (PDF แบบ image ถูก Cloudinary
    // บล็อกการเปิดดู) และใส่นามสกุลไว้ใน public_id ให้ browser เปิดถูกประเภท
    const isImage = file.mimetype.startsWith('image/');
    const ext = originalName.includes('.')
      ? originalName.split('.').pop()?.toLowerCase()
      : undefined;
    const uniqueId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    let result: UploadApiResponse;
    try {
      result = await new Promise<UploadApiResponse>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'km-system',
            resource_type: isImage ? 'image' : 'raw',
            public_id: !isImage && ext ? `${uniqueId}.${ext}` : uniqueId,
          },
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
      filename: originalName,
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

/** ลบไฟล์บน Cloudinary จาก URL — ใช้ตอน soft delete โพสต์เพื่อไม่ให้ไฟล์ค้าง */
@Injectable()
export class UploadService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  /** ดึง URL ของ Cloudinary ทั้งหมดจากข้อความ (เนื้อหาโพสต์/ไฟล์แนบ) */
  static extractUrls(text: string | null | undefined): string[] {
    if (!text) return [];
    return text.match(/https?:\/\/res\.cloudinary\.com\/[^\s)\]"']+/g) ?? [];
  }

  /** best-effort — ลบไม่สำเร็จไม่ทำให้การลบโพสต์ล้ม */
  async destroyByUrls(urls: string[]): Promise<void> {
    for (const url of urls) {
      const match = url.match(
        /res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/,
      );
      if (!match) continue;
      const resourceType = match[1];
      let publicId = decodeURIComponent(match[2]);
      // image URL ลงท้ายด้วยนามสกุล แต่ public_id ไม่มี — raw เก็บนามสกุลไว้ใน public_id
      if (resourceType === 'image') {
        publicId = publicId.replace(/\.[^/.]+$/, '');
      }
      try {
        await cloudinary.uploader.destroy(publicId, {
          resource_type: resourceType,
        });
      } catch {
        // ข้าม — ไฟล์อาจถูกลบไปแล้ว
      }
    }
  }
}

@Module({
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
