# KM System (Backend) — กติกาโปรเจกต์

- Repo นี้คือ NestJS API — เจ้าของ database ทั้งหมด (Prisma อยู่ที่นี่ที่เดียว frontend ห้ามแตะ DB ตรง)
- Frontend อยู่ repo `kmppc-frontend` (Next.js) เรียกผ่าน REST API + Socket.IO
- ทุก query ตารางที่มี `deleted_at` ต้อง filter `deleted_at: null`
- AI ทุกอย่างเรียกผ่าน `LlmProvider` interface — ห้าม import SDK ของ Gemini นอก provider layer
- API key / secret อยู่ใน `.env` ฝั่งนี้เท่านั้น ห้าม expose ไป frontend
- Schema คือ **schema-v1.0 (frozen)** — ห้ามแก้ `schema.prisma` โดยไม่ถามก่อน
- FK ไป User: `onDelete: Restrict` เสมอ (ปิดบัญชีด้วย `is_active` ไม่ hard delete) / FK ไป User ซ้ำหลายตัวใน model เดียวต้องตั้งชื่อ relation
- โพสต์ anonymous: strip ข้อมูล author ที่ฝั่ง API เสมอ (`anonymous.serializer.ts`) — ห้ามซ่อนแค่ frontend, notification ห้าม leak ชื่อ actor
- ก่อน commit: รัน `pnpm lint` + `pnpm build`

## คำสั่งที่ใช้บ่อย

```bash
docker compose up -d          # MySQL 8 + Redis
pnpm prisma:generate          # generate Prisma client
pnpm prisma:migrate           # migrate dev
pnpm prisma:seed              # seed Role/Department/Category/admin/SystemSetting
pnpm start:dev                # รัน API (port 3001, prefix /api)
```
