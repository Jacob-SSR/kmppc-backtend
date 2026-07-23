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
# รัน migration ค้างไว้ก่อน แล้วค่อยสตาร์ท API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
