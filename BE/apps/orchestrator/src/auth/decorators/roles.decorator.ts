import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../user/user-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route/controller to the listed roles. Must be combined with
 * JwtAuthGuard + RolesGuard, e.g.:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(UserRole.ADMIN)
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
