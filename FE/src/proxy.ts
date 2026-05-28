import { NextRequest, NextResponse } from 'next/server';
import { roleFromToken, homePathForRole } from '@/lib/roles';

const PUBLIC_PATHS = ['/login', '/register'];

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const refreshToken = req.cookies.get('refresh_token')?.value ?? null;
  const hasSession = !!refreshToken;

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const isGoogleOnboarding = pathname.startsWith('/register') && searchParams.get('from') === 'google';

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Already signed in but on a public auth page → send to the role's home so a
  // teacher/admin never lands on the student dashboard.
  if (hasSession && isPublic && !isGoogleOnboarding) {
    return NextResponse.redirect(new URL(homePathForRole(roleFromToken(refreshToken)), req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|session|turn|_next/static|_next/image|__nextjs|.*\\.(?:ico|png|jpg|jpeg|svg|webp|json|webmanifest|txt|xml)$).*)',
  ],
};
