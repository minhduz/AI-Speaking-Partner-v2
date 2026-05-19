import { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_COOKIE_OPTIONS,
  fetchAuthBackend,
  hasAuthTokens,
  readBackendJson,
} from '../_utils';

export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetchAuthBackend('/auth/register', body);
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
  response.cookies.set('refresh_token', refresh_token, AUTH_COOKIE_OPTIONS);

  return response;
}
