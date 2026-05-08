import { NextResponse } from 'next/server';

export async function GET() {
  console.log('[MOCK] GET /session/greeting/stream');

  const greeting = "Hello! I'm your AI speaking coach. Press the mic button and start speaking — I'm ready to help!";
  const words = greeting.split(' ');
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      for (let i = 0; i < words.length; i++) {
        const chunk = (i === 0 ? '' : ' ') + words[i];
        send({ type: 'text', chunk });
        await new Promise((r) => setTimeout(r, 60));
      }

      send({ type: 'done', greeting });
      console.log('[MOCK] greeting/stream → done');
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
