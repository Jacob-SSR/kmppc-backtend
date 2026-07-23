// MailService — ส่งอีเมลผ่าน SMTP (nodemailer)
// ถ้ายังไม่ได้ตั้งค่า SMTP_HOST ใน .env จะถือว่า "ไม่ได้เปิดใช้" —
// ผู้เรียกเช็คได้จาก isConfigured() เพื่อ fallback (เช่น forgot-password คืน token ตอน dev)

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    if (!host) return;
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.config.get('SMTP_PORT', '587')),
      secure: this.config.get('SMTP_SECURE') === 'true',
      auth: this.config.get<string>('SMTP_USER')
        ? {
            user: this.config.get<string>('SMTP_USER'),
            pass: this.config.get<string>('SMTP_PASS'),
          }
        : undefined,
    });
  }

  isConfigured(): boolean {
    return this.transporter !== null;
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.sendMail({
        from: this.config.get('MAIL_FROM', 'KM System <no-reply@localhost>'),
        to,
        subject: 'ตั้งรหัสผ่านใหม่ — ระบบจัดการความรู้ (KM System)',
        text: [
          'คุณได้ขอตั้งรหัสผ่านใหม่สำหรับระบบจัดการความรู้',
          '',
          `เปิดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน 1 ชั่วโมง):`,
          resetUrl,
          '',
          'หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้',
        ].join('\n'),
        html: [
          '<p>คุณได้ขอตั้งรหัสผ่านใหม่สำหรับระบบจัดการความรู้</p>',
          `<p><a href="${resetUrl}">คลิกที่นี่เพื่อตั้งรหัสผ่านใหม่</a> (ลิงก์หมดอายุใน 1 ชั่วโมง)</p>`,
          '<p>หากคุณไม่ได้เป็นผู้ขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้</p>',
        ].join(''),
      });
      return true;
    } catch (err) {
      this.logger.error(`ส่งอีเมล reset password ไม่สำเร็จ: ${String(err)}`);
      return false;
    }
  }
}
