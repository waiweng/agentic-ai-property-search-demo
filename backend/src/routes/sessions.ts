import { Router } from 'express';
import { listSessions, getThread, createSession } from '../lib/session-store';

export const sessionsRouter = Router();

sessionsRouter.get('/', async (req, res) => {
  try {
    const userId = req.query.userId as string;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const sessions = await listSessions(userId);
    res.json({ sessions });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

sessionsRouter.post('/', async (req, res) => {
  try {
    const userId = (req.body?.userId ?? req.query.userId) as string;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const session = await createSession(userId);
    res.json(session);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error' });
  }
});

sessionsRouter.get('/thread', async (req, res) => {
  try {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';
    if (!sessionId) return res.status(400).json({ error: 'sessionId required', messages: [] });
    const thread = await getThread(sessionId);
    const messages = thread?.messages ?? [];
    res.json({ messages: Array.isArray(messages) ? messages : [] });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Server error', messages: [] });
  }
});
