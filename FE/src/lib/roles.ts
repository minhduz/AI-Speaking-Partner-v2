import type { UserRole } from '@/types/auth.types';

// Decode the `role` claim out of a JWT access token without verifying it.
// Verification happens server-side; the FE only needs the role for routing/UI.
export function roleFromToken(token: string | null): UserRole {
  if (!token) return 'student';
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
    );
    const role = json?.role;
    if (role === 'admin' || role === 'teacher' || role === 'student') return role;
  } catch {
    // malformed token — fall through to default
  }
  return 'student';
}

// The landing route each role lands on after login. Student keeps the existing
// learner dashboard; teacher and admin get their own surfaces.
export function homePathForRole(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'teacher':
      return '/teacher';
    default:
      return '/home';
  }
}
