import { Router } from 'express';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { getThread, appendToThread } from '../lib/session-store';
import type { ThreadRecord } from '../lib/session-store';
import { getPreferencesForAgent } from './preferences';
import { runAgent } from '../agent/graph';
import {
  getMemoriesContextForAgent,
  saveMemory,
} from '../lib/memory-store';

export const chatRouter = Router();

const RECALL_PATTERNS = [
  /what\s+have\s+i\s+ask(ed)?\s+you/,
  /what\s+did\s+i\s+ask/,
  /what\s+questions\s+did\s+i\s+ask/,
  /list\s+my\s+questions/,
  /questions\s+i\s+ask(ed)?/,
  /what\s+have\s+i\s+ask(ed)?\s+you\s+so\s+far/,
  /what\s+did\s+i\s+ask\s+you\s+so\s+far/,
];

function isRecallQuestionsIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase().replace(/\s+/g, ' ');
  return RECALL_PATTERNS.some((re) => re.test(normalized));
}

function formatQuestionsFromThread(thread: ThreadRecord, currentMessage: string): string {
  const currentTrimmed = currentMessage.trim();
  const currentNormalized = currentTrimmed.toLowerCase().replace(/\s+/g, ' ');

  const humanContents: string[] = [];
  for (const m of thread.messages) {
    if (m.type !== 'human' || typeof (m as { content: string }).content !== 'string') continue;
    const content = (m as { content: string }).content.trim();
    if (!content) continue;
    humanContents.push(content);
  }

  const seen = new Set<string>();
  const uniqueOrdered: string[] = [];
  for (const q of humanContents) {
    const normalized = q.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(normalized)) continue;
    if (normalized === currentNormalized && isRecallQuestionsIntent(q)) continue;
    seen.add(normalized);
    uniqueOrdered.push(q);
  }

  if (uniqueOrdered.length === 0) {
    return "You haven't asked any other questions in this conversation yet.";
  }
  const list = uniqueOrdered.map((q, i) => `${i + 1}. ${q}`).join('\n');
  return `Here's what you've asked in this conversation:\n\n${list}`;
}

function threadToLangChainMessages(thread: { messages: Array<{ type: string; content: string }> }): import('@langchain/core/messages').BaseMessage[] {
  const out: import('@langchain/core/messages').BaseMessage[] = [];
  for (const m of thread.messages) {
    if (m.type === 'human') out.push(new HumanMessage(m.content));
    else if (m.type === 'ai') out.push(new AIMessage(m.content));
    else if (m.type === 'system') out.push(new SystemMessage(m.content));
  }
  return out;
}

chatRouter.post('/', async (req, res) => {
  try {
    const { sessionId, userId, message } = req.body;
    if (!sessionId || !userId || typeof message !== 'string') {
      return res.status(400).json({ error: 'sessionId, userId, and message required' });
    }
    const thread = await getThread(sessionId);

    if (isRecallQuestionsIntent(message) && thread && thread.messages.length >= 0) {
      const reply = formatQuestionsFromThread(thread, message);
      await appendToThread(sessionId, message, reply, []);
      return res.json({
        reply,
        top10: [],
        toolCallsLog: [],
        pipelineSteps: [],
        aggregationPipeline: [],
        marketEstimateQuery: undefined,
        sessionId,
      });
    }

    const history = thread ? threadToLangChainMessages(thread) : [];
    const preferences = await getPreferencesForAgent(userId);
    const memoryContext = await getMemoriesContextForAgent(userId, sessionId);

    const runPromise = runAgent(history, message, {
      preferences: preferences ?? undefined,
      sessionId,
      memoryContext: memoryContext || undefined,
    });
    const timeoutMs = 120000; // 2 min for LLM + tools
    const result = await Promise.race([
      runPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out. Please try again.')), timeoutMs)
      ),
    ]);

    const reply = result.reply ?? '';
    const { toolCallsLog = [], top10 = [], pipelineSteps, aggregationPipeline, marketEstimateQuery } = result;

    await appendToThread(sessionId, message, reply, toolCallsLog);

    try {
      if (toolCallsLog.length > 0) {
        await saveMemory(userId, sessionId, 'tool_call', `Tools used: ${toolCallsLog.join(', ')}`, {
          tools: toolCallsLog,
        });
      }
      await saveMemory(userId, sessionId, 'qa_summary', `User asked: "${message.slice(0, 200)}". Reply: "${(reply || '').slice(0, 200)}".`);
    } catch (memErr: unknown) {
      console.error('Memory save error (continuing):', memErr);
    }

    res.json({ reply, top10, toolCallsLog, pipelineSteps, aggregationPipeline, marketEstimateQuery, sessionId });
  } catch (e: unknown) {
    console.error('Chat error:', e);
    const message = e instanceof Error ? e.message : 'Server error';
    res.status(500).json({ error: message });
  }
});
