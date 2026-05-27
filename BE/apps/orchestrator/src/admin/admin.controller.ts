import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../user/user-role.enum';
import { AdminService } from './admin.service';

// Admin can create teachers and other admins, but not downgrade/duplicate the
// public student signup path — student accounts come from /auth/register.
const STAFF_ROLES = [UserRole.TEACHER, UserRole.ADMIN];
const ASSIGNABLE_ROLES = [UserRole.STUDENT, UserRole.TEACHER, UserRole.ADMIN];

class CreateUserDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
  @IsString() name: string;
  @IsIn(STAFF_ROLES) role: UserRole;
}

class UpdateRoleDto {
  @IsIn(ASSIGNABLE_ROLES) role: UserRole;
}

class ListUsersQueryDto {
  @IsOptional() @IsIn(ASSIGNABLE_ROLES) role?: UserRole;
  @IsOptional() @IsString() q?: string;
}

class AssignReviewDto {
  @IsOptional() @IsUUID() teacher_id?: string | null;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('dashboard')
  dashboard() {
    return this.admin.dashboard();
  }

  @Get('users')
  listUsers(@Query() query: ListUsersQueryDto) {
    return this.admin.listUsers(query.role, query.q);
  }

  @Get('users/:id')
  getUserDetail(@Param('id') id: string) {
    return this.admin.getUserDetail(id);
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.admin.createUser(dto);
  }

  @Patch('users/:id/role')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.admin.updateRole(id, dto.role);
  }

  @Get('teachers')
  teachers() {
    return this.admin.listTeachers();
  }

  @Get('teachers/:id')
  teacherDetail(@Param('id') id: string) {
    return this.admin.getTeacherDetail(id);
  }

  @Get('reviews')
  reviews() {
    return this.admin.listReviewTasks();
  }

  @Patch('reviews/:id/assign')
  assignReview(@Param('id') id: string, @Body() dto: AssignReviewDto) {
    return this.admin.assignReviewTask(id, dto.teacher_id ?? null);
  }

  @Get('usage')
  usage() {
    return this.admin.usage();
  }
}
