import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = parseInt(searchParams.get('limit') ?? '25');

  console.log(`[MOCK] GET /session/list page=${page} limit=${limit}`);

  return NextResponse.json({ items: [], total: 0, page, limit, hasMore: false });
}
