import { NextRequest, NextResponse } from 'next/server';

const BE_URL = process.env.BACKEND_URL ?? 'http://localhost:3000';

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get('refresh_token')?.value;

  if (refreshToken) {
    await fetch(`${BE_URL}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `refresh_token=${refreshToken}`,
      },
    }).catch(() => null);
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete('refresh_token');
  return response;
}
