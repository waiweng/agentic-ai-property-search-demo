import { Router, Request, Response } from 'express';
import { register as registerSession, unregister as unregisterSession } from '../lib/active-sessions';

export const eventsRouter = Router();

eventsRouter.get('/', (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const sessionId = req.query.sessionId as string;
  if (!userId || !sessionId) {
    res.status(400).json({ error: 'userId and sessionId required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  registerSession(sessionId, userId, res);

  req.on('close', () => {
    unregisterSession(sessionId);
  });
});
