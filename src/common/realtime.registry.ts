// จุดกลางให้โมดูลอื่นยิง event เข้า socket ของผู้ใช้ (room `user:<id>` ใน namespace /chat)
// ChatGateway เป็นคน setServer ตอน init — โมดูลอื่นห้ามแตะ socket.io ตรง ๆ

import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class RealtimeRegistry {
  private server: Server | null = null;

  setServer(server: Server) {
    this.server = server;
  }

  /** ส่ง event ถึงทุก socket ของผู้ใช้คนหนึ่ง (best-effort — ออฟไลน์ = เงียบ) */
  emitToUser(userId: string, event: string, payload?: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
