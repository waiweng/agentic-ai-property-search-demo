import { getSessionsCollection, getThreadsCollection } from '../db/collections';
import { v4 as uuidv4 } from 'uuid';

export interface SessionRecord {
  userId: string;
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThreadMessage {
  type: 'human' | 'ai' | 'system';
  content: string;
  toolCalls?: string[];
  timestamp: Date;
}

export interface ThreadRecord {
  sessionId: string;
  messages: ThreadMessage[];
  updatedAt: Date;
}

export async function createSession(userId: string): Promise<SessionRecord> {
  const sessions = await getSessionsCollection();
  const sessionId = uuidv4();
  const now = new Date();
  await sessions.insertOne({
    userId,
    sessionId,
    createdAt: now,
    updatedAt: now,
  });
  const threads = await getThreadsCollection();
  await threads.insertOne({
    sessionId,
    messages: [],
    updatedAt: now,
  });
  return { userId, sessionId, createdAt: now, updatedAt: now };
}

export async function listSessions(userId: string, limit = 20): Promise<SessionRecord[]> {
  const coll = await getSessionsCollection();
  const docs = await coll
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d: any) => ({
    userId: d.userId,
    sessionId: d.sessionId,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

export async function getThread(sessionId: string): Promise<ThreadRecord | null> {
  const coll = await getThreadsCollection();
  const doc = await coll.findOne({ sessionId });
  if (!doc) return null;
  return {
    sessionId: doc.sessionId,
    messages: doc.messages || [],
    updatedAt: doc.updatedAt,
  };
}

export async function appendToThread(
  sessionId: string,
  humanContent: string,
  aiContent: string,
  toolCallsLog: string[] = []
): Promise<void> {
  const threads = await getThreadsCollection();
  const now = new Date();
  await threads.updateOne(
    { sessionId },
    {
      $push: {
        messages: {
          $each: [
            { type: 'human' as const, content: humanContent, timestamp: now },
            {
              type: 'ai' as const,
              content: aiContent,
              toolCalls: toolCallsLog.length ? toolCallsLog : undefined,
              timestamp: now,
            },
          ],
        },
      },
      $set: { updatedAt: now },
    } as unknown as Parameters<typeof threads.updateOne>[1],
    { upsert: true }
  );
  const sessions = await getSessionsCollection();
  await sessions.updateOne({ sessionId }, { $set: { updatedAt: now } });
}
