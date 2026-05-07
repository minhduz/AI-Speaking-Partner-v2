import { NextResponse } from 'next/server';

export async function POST() {
  const session_id = `mock-session-${Date.now()}`;
  console.log('[MOCK] POST /session/start →', { session_id });
  return NextResponse.json({ session_id });
}
