import { NextRequest, NextResponse } from 'next/server';
import {
  DEV_COOKIE_OPTIONS,
  fetchAuthBackend,
  hasAuthTokens,
  readBackendJson,
} from '../_utils';

const DEV_BYPASS = process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

export async function POST(req: NextRequest) {
  if (DEV_BYPASS) {
    const response = NextResponse.json({ access_token: 'dev-access-token' });
    response.cookies.set('refresh_token', 'dev-refresh-token', DEV_COOKIE_OPTIONS);
    return response;
  }

  const body = await req.json();

  const res = await fetchAuthBackend('/auth/login', body);
  if (res instanceof NextResponse) return res;

  const data = await readBackendJson(res);

  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }

  if (!hasAuthTokens(data)) {
    return NextResponse.json({ message: 'Invalid auth response from backend' }, { status: 502 });
  }

  const { access_token, refresh_token } = data;

  const response = NextResponse.json({ access_token });
  response.cookies.set('refresh_token', refresh_token, {
    ...DEV_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
  });

  return response;
}
