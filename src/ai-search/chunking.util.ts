// Utilities สำหรับเตรียมข้อความก่อนทำ embedding
// - stripHtml: แปลง HTML (จาก rich-text editor) เป็น plain text
// - chunkText: หั่นข้อความเป็นชิ้น ๆ แบบมี overlap (heuristic ~4 ตัวอักษร/token)

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const NAMED_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

export function stripHtml(html: string): string {
  if (!html) return '';
  let text = html
    // ตัด script/style ทั้ง block
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // แท็กที่จบบรรทัด/ย่อหน้า → newline เพื่อรักษาโครงสร้างข้อความ
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    // แท็กที่เหลือทั้งหมด
    .replace(/<[^>]+>/g, ' ');
  // decode entities พื้นฐาน + ตัวเลข
  for (const [entity, ch] of Object.entries(NAMED_ENTITIES)) {
    text = text.split(entity).join(ch);
  }
  text = text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(parseInt(dec, 10)),
    );
  // เก็บกวาด whitespace
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface ChunkOptions {
  /** ขนาดสูงสุดต่อ chunk (หน่วย token โดยประมาณ) */
  maxTokens?: number;
  /** ส่วนซ้อนทับระหว่าง chunk (หน่วย token โดยประมาณ) */
  overlapTokens?: number;
}

export interface TextChunk {
  content: string;
  token_count: number;
}

/**
 * หั่นข้อความเป็น chunk แบบ sliding window มี overlap
 * พยายามตัดที่ขอบเขตย่อหน้า/ประโยค/ช่องว่างก่อน เพื่อไม่หั่นกลางคำ
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): TextChunk[] {
  const maxTokens = options.maxTokens ?? 650;
  const overlapTokens = options.overlapTokens ?? 100;
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = Math.min(
    overlapTokens * CHARS_PER_TOKEN,
    Math.floor(maxChars / 2),
  );

  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= maxChars) {
    return [{ content: clean, token_count: estimateTokens(clean) }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxChars, clean.length);
    if (end < clean.length) {
      // หา break point ที่ดีที่สุดในครึ่งหลังของ window
      const windowText = clean.slice(start, end);
      const minBreak = Math.floor(maxChars / 2);
      const breakCandidates = [
        windowText.lastIndexOf('\n\n'),
        windowText.lastIndexOf('\n'),
        Math.max(
          windowText.lastIndexOf('. '),
          windowText.lastIndexOf('! '),
          windowText.lastIndexOf('? '),
        ),
        windowText.lastIndexOf(' '),
      ];
      const breakAt = breakCandidates.find((idx) => idx >= minBreak);
      if (breakAt !== undefined && breakAt > 0) {
        end = start + breakAt + 1;
      }
    }
    const piece = clean.slice(start, end).trim();
    if (piece) {
      chunks.push({ content: piece, token_count: estimateTokens(piece) });
    }
    if (end >= clean.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return chunks;
}
