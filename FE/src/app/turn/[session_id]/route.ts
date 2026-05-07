import { NextRequest, NextResponse } from 'next/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ session_id: string }> },
) {
  const { session_id } = await params;

  let audioFile: File | null = null;
  try {
    const formData = await req.formData();
    const field = formData.get('audio');
    audioFile = field instanceof File ? field : null;
  } catch {
    console.error('[MOCK] POST /turn/:session_id — failed to parse FormData');
    return NextResponse.json({ message: 'Could not parse multipart body' }, { status: 400 });
  }

  if (!audioFile) {
    console.warn('[MOCK] POST /turn/:session_id — no "audio" field in FormData');
    return NextResponse.json({ message: 'No audio field received' }, { status: 400 });
  }

  console.log(`[MOCK] POST /turn/${session_id} — audio received:`, {
    field: 'audio',
    name: audioFile.name,
    size: `${audioFile.size} bytes (${(audioFile.size / 1024).toFixed(1)} KB)`,
    type: audioFile.type,
  });

  // Simulate the STT + LLM latency
  await new Promise((r) => setTimeout(r, 800));

  const response = {
    turn_id: `mock-turn-${Date.now()}`,
    transcript: `[mock transcript — ${audioFile.size} byte ${audioFile.type} blob received]`,
    confidence: 0.95,
    pronunciation: { score: 0.87 },
    response_text: `Recording pipeline is working. Got your ${(audioFile.size / 1024).toFixed(1)} KB audio blob as "${audioFile.name}" (${audioFile.type}). Connect the real BE to process actual speech.`,
    audio_b64: '',
    tokens_used: 42,
  };

  console.log(`[MOCK] POST /turn/${session_id} →`, {
    ...response,
    audio_b64: response.audio_b64 ? '[base64]' : '(empty)',
  });

  return NextResponse.json(response);
}
