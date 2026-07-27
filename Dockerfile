# NestJS API — build + run (Prisma บน alpine ต้องมี openssl)
FROM node:22-alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm prisma:generate && pnpm build

EXPOSE 3001
# repo ยังไม่มี prisma/migrations — ใช้ db push sync schema (ไม่ลบข้อมูลเดิม)
# แล้ว seed (idempotent: Role/แผนก/หมวด/admin/setting) ก่อนสตาร์ท API
CMD ["sh", "-c", "npx prisma db push --skip-generate && pnpm prisma:seed && node dist/src/main"]
