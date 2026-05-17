import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/register'];

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  const hasSession = req.cookies.has('refresh_token');

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  // Google onboarding lands authenticated users on /register?from=google
  // to complete their profile — don't bounce them to /chat.
  const isGoogleOnboarding = pathname.startsWith('/register') && searchParams.get('from') === 'google';

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  if (hasSession && isPublic && !isGoogleOnboarding) {
    return NextResponse.redirect(new URL('/chat', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
