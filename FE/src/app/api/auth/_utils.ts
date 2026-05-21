import { NextResponse } from 'next/server';

export const BE_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
};

export const DEV_COOKIE_OPTIONS = {
  ...AUTH_COOKIE_OPTIONS,
  secure: false,
};

export async function fetchAuthBackend(path: string, body: unknown): Promise<Response | NextResponse> {
  try {
    return await fetch(`${BE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reach auth backend';
    return NextResponse.json(
      { message: `Cannot connect to auth backend at ${BE_URL}: ${message}` },
      { status: 502 },
    );
  }
}

export async function readBackendJson(res: Response): Promise<unknown> {
  const contentType = res.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return res.json();
  }

  const text = await res.text().catch(() => '');
  const looksLikeHtml = /^\s*<!doctype html/i.test(text) || /^\s*<html/i.test(text);
  const detail = looksLikeHtml
    ? `Backend returned HTML instead of JSON. Check BACKEND_URL (${BE_URL}) and make sure the orchestrator is running.`
    : text.slice(0, 300) || res.statusText || 'Backend returned a non-JSON response.';

  return {
    message: `Auth backend returned ${res.status} ${res.statusText}: ${detail}`,
  };
}

export function hasAccessToken(data: unknown): data is { access_token: string; refresh_token?: string } {
  return Boolean(
    data
      && typeof data === 'object'
      && 'access_token' in data
      && typeof (data as { access_token?: unknown }).access_token === 'string',
  );
}

export function hasAuthTokens(data: unknown): data is { access_token: string; refresh_token: string } {
  return Boolean(
    hasAccessToken(data)
      && 'refresh_token' in data
      && typeof (data as { refresh_token?: unknown }).refresh_token === 'string',
  );
}
