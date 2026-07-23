import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { MessageType } from '@prisma/client';
import { ChatService } from './chat.service';

interface JwtPayload {
  sub: string;
  username: string;
  role: string;
}

type ChatSocket = Omit<Socket, 'data'> & { data: { userId?: string } };

/** ดึงค่า cookie จาก header ของ handshake */
const parseCookie = (
  cookieHeader: string | undefined,
  name: string,
): string | null => {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
};

@WebSocketGateway({
  namespace: 'chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  /** user_id -> จำนวน socket ที่ต่ออยู่ (รองรับเปิดหลายแท็บ) */
  private readonly online = new Map<string, Set<string>>();

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(client: ChatSocket) {
    const userId = this.authenticate(client);
    if (!userId) {
      client.emit('error', { message: 'กรุณาเข้าสู่ระบบก่อนใช้งานแชท' });
      client.disconnect(true);
      return;
    }

    client.data.userId = userId;
    void client.join(`user:${userId}`);

    const sockets = this.online.get(userId) ?? new Set<string>();
    sockets.add(client.id);
    this.online.set(userId, sockets);
    this.emitOnlineUsers();
  }

  handleDisconnect(client: ChatSocket) {
    const userId = client.data.userId;
    if (!userId) return;
    const sockets = this.online.get(userId);
    if (sockets) {
      sockets.delete(client.id);
      if (sockets.size === 0) this.online.delete(userId);
    }
    this.emitOnlineUsers();
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: { conversation_id?: string },
  ) {
    const userId = client.data.userId;
    const conversationId = body?.conversation_id;
    if (!userId || !conversationId) {
      return { success: false, message: 'ข้อมูลไม่ถูกต้อง' };
    }
    try {
      const isMember = await this.chat.isMember(conversationId, userId);
      if (!isMember) {
        return {
          success: false,
          message: 'คุณไม่ได้เป็นสมาชิกห้องสนทนานี้',
        };
      }
      await client.join(`conversation:${conversationId}`);
      return { success: true, message: 'เข้าร่วมห้องสนทนาเรียบร้อย' };
    } catch (err) {
      this.logger.error(err);
      return { success: false, message: 'ไม่สามารถเข้าร่วมห้องสนทนาได้' };
    }
  }

  @SubscribeMessage('message:send')
  async sendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    body: {
      conversation_id?: string;
      message?: string;
      message_type?: MessageType;
    },
  ) {
    const userId = client.data.userId;
    if (!userId || !body?.conversation_id || !body?.message?.trim()) {
      return { success: false, message: 'กรุณากรอกข้อความ' };
    }
    try {
      const message = await this.chat.sendMessage(
        body.conversation_id,
        userId,
        {
          message: body.message,
          message_type: body.message_type,
        },
      );
      this.server
        .to(`conversation:${body.conversation_id}`)
        .emit('message:new', message);
      return { success: true, data: message };
    } catch (err) {
      this.logger.error(err);
      return { success: false, message: 'ไม่สามารถส่งข้อความได้' };
    }
  }

  @SubscribeMessage('message:read')
  async readMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() body: { conversation_id?: string; message_id?: string },
  ) {
    const userId = client.data.userId;
    if (!userId || !body?.conversation_id || !body?.message_id) {
      return { success: false, message: 'ข้อมูลไม่ถูกต้อง' };
    }
    try {
      await this.chat.markRead(body.conversation_id, userId, body.message_id);
      this.server
        .to(`conversation:${body.conversation_id}`)
        .emit('message:read', {
          conversation_id: body.conversation_id,
          message_id: body.message_id,
          user_id: userId,
        });
      return { success: true };
    } catch (err) {
      this.logger.error(err);
      return { success: false, message: 'ไม่สามารถอัปเดตสถานะการอ่านได้' };
    }
  }

  /** ตรวจสอบ JWT จาก handshake (auth.token หรือ cookie access_token) */
  private authenticate(client: ChatSocket): string | null {
    try {
      const authToken = (client.handshake.auth as { token?: string })?.token;
      const headerAuth = client.handshake.headers.authorization;
      const bearerToken = headerAuth?.startsWith('Bearer ')
        ? headerAuth.slice(7)
        : null;
      const cookieToken = parseCookie(
        client.handshake.headers.cookie,
        'access_token',
      );
      const token = authToken ?? bearerToken ?? cookieToken;
      if (!token) return null;

      const payload = this.jwt.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      });
      return payload.sub ?? null;
    } catch {
      return null;
    }
  }

  private emitOnlineUsers() {
    this.server.emit('users:online', [...this.online.keys()]);
  }
}
