import type { Response } from 'express';

interface SessionConnection {
  userId: string;
  sessionId: string;
  res: Response;
}

const bySessionId = new Map<string, SessionConnection>();
const byUserId = new Map<string, Set<SessionConnection>>();

function addToUserId(userId: string, conn: SessionConnection): void {
  let set = byUserId.get(userId);
  if (!set) {
    set = new Set();
    byUserId.set(userId, set);
  }
  set.add(conn);
}

function removeFromUserId(userId: string, conn: SessionConnection): void {
  const set = byUserId.get(userId);
  if (set) {
    set.delete(conn);
    if (set.size === 0) byUserId.delete(userId);
  }
}

export function register(sessionId: string, userId: string, res: Response): void {
  const existing = bySessionId.get(sessionId);
  if (existing) {
    removeFromUserId(existing.userId, existing);
    bySessionId.delete(sessionId);
  }
  const conn: SessionConnection = { userId, sessionId, res };
  bySessionId.set(sessionId, conn);
  addToUserId(userId, conn);
}

export function unregister(sessionId: string): void {
  const conn = bySessionId.get(sessionId);
  if (conn) {
    removeFromUserId(conn.userId, conn);
    bySessionId.delete(sessionId);
  }
}

export function broadcastToUser(userId: string, eventType: string, data: object): void {
  const set = byUserId.get(userId);
  if (!set) return;
  const payload = JSON.stringify(data);
  for (const conn of set) {
    try {
      conn.res.write(`event: ${eventType}\n`);
      conn.res.write(`data: ${payload}\n\n`);
    } catch (_) {
      // Connection may be closed
    }
  }
}
