import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import {
  CreateConversationDto,
  EditMessageDto,
  MarkReadDto,
  SendMessageDto,
} from './chat.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

interface AuthedUser {
  id: string;
  role: { role_name: string };
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('conversations')
  createConversation(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chat.createConversation(user.id, dto);
  }

  @Get('conversations')
  listMyConversations(@CurrentUser() user: AuthedUser) {
    return this.chat.listMyConversations(user.id);
  }

  // ---------- จัดการสมาชิกกลุ่ม ----------

  @Post('conversations/:id/members')
  addMembers(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() body: { member_ids: string[] },
  ) {
    return this.chat.addMembers(id, user.id, body.member_ids ?? []);
  }

  @Delete('conversations/:id/members/:userId')
  removeMember(
    @Param('id') id: string,
    @Param('userId') targetId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.chat.removeMember(id, user.id, targetId);
  }

  @Post('conversations/:id/leave')
  leaveGroup(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.chat.leaveGroup(id, user.id);
  }

  @Get('conversations/:id/messages')
  getMessages(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chat.getMessages(id, user.id, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.sendMessage(id, user.id, dto);
  }

  @Patch('messages/:id')
  editMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.editMessage(id, user.id, dto);
  }

  @Delete('messages/:id')
  deleteMessage(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.chat.deleteMessage(id, user.id);
  }

  @Post('conversations/:id/read')
  markRead(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
    @Body() dto: MarkReadDto,
  ) {
    return this.chat.markRead(id, user.id, dto.message_id);
  }
}
