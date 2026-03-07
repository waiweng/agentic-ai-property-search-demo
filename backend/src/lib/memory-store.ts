import { getMemoriesCollection } from '../db/collections';

export type MemoryType = 'tool_call' | 'qa_summary' | 'conversation_turn';

export interface MemoryRecord {
  userId: string;
  sessionId: string;
  type: MemoryType;
  /** Human-readable summary or JSON string for tool_call */
  content: string;
  /** Optional structured payload (e.g. tool name, args, outcome) */
  payload?: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Save a memory entry for long-term recall (e.g. after re-login).
 * Use for: tool calls (name, args, outcome), Q&A summaries, conversation turn summaries.
 */
export async function saveMemory(
  userId: string,
  sessionId: string,
  type: MemoryType,
  content: string,
  payload?: Record<string, unknown>
): Promise<void> {
  const coll = await getMemoriesCollection();
  await coll.insertOne({
    userId,
    sessionId,
    type,
    content,
    payload: payload ?? undefined,
    createdAt: new Date(),
  });
}

/**
 * Get recent memories for a user, optionally scoped to a session.
 * Used to build context for the agent so previous tool usage and Q&A are available.
 */
export async function getMemories(
  userId: string,
  options?: { sessionId?: string; limit?: number; types?: MemoryType[] }
): Promise<MemoryRecord[]> {
  const coll = await getMemoriesCollection();
  const limit = options?.limit ?? 30;
  const filter: Record<string, unknown> = { userId };
  if (options?.sessionId) filter.sessionId = options.sessionId;
  if (options?.types?.length) filter.type = { $in: options.types };
  const docs = await coll
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d: Record<string, unknown>) => ({
    userId: d.userId as string,
    sessionId: d.sessionId as string,
    type: d.type as MemoryType,
    content: d.content as string,
    payload: d.payload as Record<string, unknown> | undefined,
    createdAt: d.createdAt as Date,
  }));
}

/**
 * Format recent memories into a string for the agent system prompt.
 * So the model can use past tool calls and Q&A when continuing a conversation.
 */
export async function getMemoriesContextForAgent(
  userId: string,
  sessionId: string,
  maxEntries = 15
): Promise<string> {
  const memories = await getMemories(userId, {
    sessionId,
    limit: maxEntries,
    types: ['tool_call', 'qa_summary'],
  });
  if (memories.length === 0) return '';
  const lines = memories.reverse().map((m) => {
    if (m.type === 'tool_call' && m.payload?.name) {
      return `- Tool ${m.payload.name} was used: ${m.content}`;
    }
    return `- ${m.content}`;
  });
  return `Recent context from this conversation:\n${lines.join('\n')}\n`;
}
