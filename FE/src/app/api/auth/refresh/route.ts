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
  const refreshToken = req.cookies.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: 'No session' }, { status: 401 });
  }

  if (DEV_BYPASS && refreshToken === 'dev-refresh-token') {
    const response = NextResponse.json({ access_token: 'dev-access-token' });
    response.cookies.set('refresh_token', 'dev-refresh-token', DEV_COOKIE_OPTIONS);
    return response;
  }

  const res = await fetch(`${BE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  const data = await res.json();

  if (!res.ok) {
    const response = NextResponse.json(data, { status: res.status });
    response.cookies.delete('refresh_token');
    return response;
  }

  const { access_token } = data;

  const response = NextResponse.json({ access_token });

  return response;
}
