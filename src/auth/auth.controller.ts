import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './dto/auth.dto';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE = 'access_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, accessToken, refreshToken } = await this.auth.login(dto, {
      userAgent: req.headers['user-agent'],
      ip,
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return { user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies?.[REFRESH_COOKIE] as string) ?? '';
    const { user, accessToken, refreshToken } = await this.auth.refresh(token);
    this.setAuthCookies(res, accessToken, refreshToken);
    return { user };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE] as string);
    this.clearAuthCookies(res);
    return { message: 'ออกจากระบบเรียบร้อย' };
  }

  @Post('logout-all')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async logoutAll(
    @CurrentUser() user: { id: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logoutAll(user.id);
    this.clearAuthCookies(res);
    return { message: 'ออกจากระบบทุกเครื่องเรียบร้อย' };
  }

  @Post('forgot-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto.token, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: { password_hash?: string }) {
    return this.auth.sanitize(user);
  }

  private setAuthCookies(res: Response, access: string, refresh: string) {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, access, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 15 * 60 * 1000,
      path: '/',
    });
    res.cookie(REFRESH_COOKIE, refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/auth',
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
