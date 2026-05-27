import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../user/user-role.enum';

/**
 * Role-based access gate. Reads the roles required by @Roles(...) and compares
 * them against request.user.role (set by JwtStrategy.validate). Must run after
 * JwtAuthGuard so request.user is populated:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *
 * If no @Roles() metadata is present the route is open to any authenticated
 * user (RolesGuard is a no-op).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const role = req?.user?.role;

    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Insufficient role for this resource');
    }
    return true;
  }
}
