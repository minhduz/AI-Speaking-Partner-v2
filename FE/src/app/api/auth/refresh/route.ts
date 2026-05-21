import { NextRequest, NextResponse } from 'next/server';
import {
  DEV_COOKIE_OPTIONS,
  fetchAuthBackend,
  hasAccessToken,
  readBackendJson,
} from '../_utils';

const DEV_BYPASS = process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production';

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

  const res = await fetchAuthBackend('/auth/refresh', { refresh_token: refreshToken });
  if (res instanceof NextResponse) return res;

  const data = await readBackendJson(res);

  if (!res.ok) {
    const response = NextResponse.json(data, { status: res.status });
    response.cookies.delete('refresh_token');
    return response;
  }

  if (!hasAccessToken(data)) {
    return NextResponse.json({ message: 'Invalid auth response from backend' }, { status: 502 });
  }

  const { access_token } = data;

  const response = NextResponse.json({ access_token });

  return response;
}
