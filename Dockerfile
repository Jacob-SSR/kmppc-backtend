# NestJS API — build + run (Prisma บน alpine ต้องมี openssl)
FROM node:22-alpine
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

# เน็ตองค์กรช้า — ยืด timeout + retry ให้ pnpm ไม่ล้มกลางทาง
ENV npm_config_fetch_timeout=600000 \
    npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000 \
    npm_config_network_concurrency=4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
# cache store ของ pnpm ข้ามรอบ build — ล้มแล้ว build ใหม่ไม่ต้องโหลดซ้ำทั้งหมด
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --prefer-offline

COPY . .
RUN pnpm prisma:generate && pnpm build

EXPOSE 3001
# repo ยังไม่มี prisma/migrations — ใช้ db push sync schema (ไม่ลบข้อมูลเดิม)
# แล้ว seed (idempotent: Role/แผนก/หมวด/admin/setting) ก่อนสตาร์ท API
CMD ["sh", "-c", "npx prisma db push --skip-generate && pnpm prisma:seed && node dist/src/main"]
