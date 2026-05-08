import { NextRequest, NextResponse } from 'next/server';

const BE_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';
const DEV_BYPASS = process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

const DEV_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: false,
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
};

export async function POST(req: NextRequest) {
  if (DEV_BYPASS) {
    const response = NextResponse.json({ access_token: 'dev-access-token' });
    response.cookies.set('refresh_token', 'dev-refresh-token', DEV_COOKIE_OPTIONS);
    return response;
  }

  const body = await req.json();

  const res = await fetch(`${BE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  const { access_token, refresh_token } = data;

  const response = NextResponse.json({ access_token });
  response.cookies.set('refresh_token', refresh_token, {
    ...DEV_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
