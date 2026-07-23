// Socket.IO Redis adapter — ให้ event กระจายถึงกันเมื่อรัน API หลาย instance
// ถ้าต่อ Redis ไม่ได้ตอน boot จะ fallback เป็น in-memory adapter (single instance)

import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { ServerOptions, Server } from 'socket.io';

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  async connectToRedis(): Promise<void> {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? 6379);
    try {
      const pubClient = new Redis({ host, port, lazyConnect: true });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log(`Socket.IO ใช้ Redis adapter (${host}:${port})`);
    } catch (err) {
      this.logger.warn(
        `ต่อ Redis ไม่ได้ (${host}:${port}) — Socket.IO ใช้ in-memory adapter แทน: ${String(err)}`,
      );
      this.adapterConstructor = null;
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
