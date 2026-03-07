/**
 * Test the chat API (graph + checkpoint + memory).
 * Prereqs: backend running (npm run dev), MongoDB reachable, MONGODB_ATLAS_URI in .env
 *
 * Usage: npx ts-node scripts/test-chat.ts [baseUrl]
 * Default baseUrl: http://localhost:4000
 */

const BASE = process.argv[2] || 'http://localhost:4000';

async function checkBackend(): Promise<void> {
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) throw new Error(`${res.status}`);
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException & { message?: string; cause?: unknown };
    const msg = err?.message ?? String(e);
    const causeStr = err?.cause != null ? String(err.cause) : '';
    const refused =
      msg.includes('ECONNREFUSED') ||
      msg.includes('fetch failed') ||
      causeStr.includes('ECONNREFUSED') ||
      err.code === 'ECONNREFUSED';
    if (refused) {
      throw new Error(
        `Cannot reach backend at ${BASE}. Is the server running? Start it with: npm run dev`
      );
    }
    throw new Error(`Backend check failed: ${msg}`);
  }
}

interface SessionResponse {
  sessionId: string;
}

interface ChatResponse {
  reply: string;
  toolCallsLog?: string[];
  sessionId?: string;
}

async function createSession(userId: string): Promise<SessionResponse> {
  const res = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`Create session failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<SessionResponse>;
}

async function chat(sessionId: string, userId: string, message: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, userId, message }),
  });
  if (!res.ok) throw new Error(`Chat failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<ChatResponse>;
}

async function main() {
  console.log('Checking backend at', BASE, '...');
  await checkBackend();
  console.log('Backend OK.\n');

  const userId = 'test-user-' + Date.now();
  console.log('1. Creating session for', userId);
  const { sessionId } = await createSession(userId);
  console.log('   sessionId:', sessionId);

  console.log('\n2. Sending: "What is the price guide for 2 bed in Parramatta?"');
  const r1 = await chat(sessionId, userId, 'What is the price guide for 2 bed in Parramatta?');
  console.log('   Reply:', (r1.reply || '').slice(0, 300) + (r1.reply?.length > 300 ? '...' : ''));
  console.log('   Tools:', r1.toolCallsLog);

  console.log('\n3. Sending: "Summarise our conversation"');
  const r2 = await chat(sessionId, userId, 'Summarise our conversation');
  console.log('   Reply:', (r2.reply || '').slice(0, 300));

  console.log('\n✅ Chat test done. Check MongoDB: graph_checkpoints, threads, memories.');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
