// LlmModule — เลือก provider ตาม env AI_PROVIDER (default: 'gemini')
// โมดูลอื่น inject ด้วย @Inject(LLM_PROVIDER) แล้วใช้ผ่าน interface LlmProvider เท่านั้น

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LLM_PROVIDER } from './llm.provider';
import { GeminiProvider } from './gemini.provider';

@Module({
  providers: [
    GeminiProvider,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService, GeminiProvider],
      useFactory: (config: ConfigService, gemini: GeminiProvider) => {
        const provider = (
          config.get<string>('AI_PROVIDER') ?? 'gemini'
        ).toLowerCase();
        if (provider === 'gemini') return gemini;
        throw new Error(
          `ไม่รองรับ AI_PROVIDER "${provider}" — ขณะนี้รองรับเฉพาะ 'gemini' เท่านั้น (ตรวจสอบค่าใน .env)`,
        );
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
