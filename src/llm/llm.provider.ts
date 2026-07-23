// LlmProvider — abstraction กลางสำหรับเรียก AI ทุกชนิด
// กติกาโปรเจกต์: ห้าม import SDK ของ Gemini (หรือ provider อื่น) นอก layer นี้
// โมดูลอื่นให้ inject ผ่าน token LLM_PROVIDER เท่านั้น

export const LLM_PROVIDER = 'LLM_PROVIDER';

export interface GenerateAnswerParams {
  /** system prompt (กำหนดบทบาท/กติกาการตอบ) */
  system: string;
  /** คำถามของผู้ใช้ */
  question: string;
  /** บริบท (chunks จากฐานความรู้) ที่ให้โมเดลใช้อ้างอิง */
  context: string;
}

export interface LlmProviderInfo {
  provider: string;
  chat_model: string;
  embedding_model: string;
}

export interface WebSource {
  title: string;
  url: string;
}

export interface WebAnswer {
  answer: string;
  sources: WebSource[];
}

export interface LlmProvider {
  /** สร้างคำตอบจากคำถาม + บริบท (คืน string เต็ม) */
  generateAnswer(params: GenerateAnswerParams): Promise<string>;

  /** สร้างคำตอบแบบ stream (optional — ถ้า provider รองรับ) */
  generateAnswerStream?(params: GenerateAnswerParams): AsyncIterable<string>;

  /** แปลงข้อความเป็น embedding vectors (ลำดับผลลัพธ์ตรงกับ input) */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * ตอบคำถามโดยค้นจากอินเทอร์เน็ต (search grounding — optional)
   * ใช้เมื่อฐานความรู้ภายในไม่มีคำตอบ
   */
  generateWebAnswer?(question: string): Promise<WebAnswer>;

  /** ข้อมูล provider/model สำหรับบันทึกลง AiSearchLog (optional) */
  info?(): LlmProviderInfo;
}
