import { Controller, Get, Put, Delete, Body, Req, UseGuards, HttpCode } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserService } from './user.service';

class UpdateUserDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() targetLanguage?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() timezone?: string;
}

@Controller('user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private userService: UserService) {}

  @Get('me')
  me(@Req() req) { return this.userService.findById(req.user.id); }

  @Put('me')
  update(@Req() req, @Body() dto: UpdateUserDto) {
    return this.userService.update(req.user.id, dto);
  }

  @Delete('me') @HttpCode(204)
  delete(@Req() req) { return this.userService.delete(req.user.id); }

  @Delete('memory') @HttpCode(204)
  wipeMemory(@Req() req) { return this.userService.wipeMemory(req.user.id); }
}
