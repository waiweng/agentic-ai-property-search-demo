import { throttle } from '../lib/throttle';

const BASE = 'https://api.voyageai.com/v1';
const EMBED_MODEL = 'voyage-3.5';
const EMBED_DIMENSION = 1024;
const RERANK_MODEL = 'rerank-2.5-lite';

function getApiKey(): string {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error('VOYAGE_API_KEY not set');
  return key;
}

async function voyageFetch(path: string, body: object): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Voyage API ${res.status}: ${err}`);
  }
  return res.json();
}

export interface EmbedResult {
  embedding: number[];
  index: number;
}

/**
 * Embed one or more texts. Uses throttle for free-tier safety.
 */
export async function embed(
  input: string | string[],
  options: { inputType?: 'query' | 'document' } = {}
): Promise<number[][]> {
  const run = async () => {
    const payload: Record<string, unknown> = {
      input,
      model: EMBED_MODEL,
      output_dimension: EMBED_DIMENSION,
    };
    if (options.inputType) payload.input_type = options.inputType;
    const data = await voyageFetch('/embeddings', payload);
    const list = (data.data as EmbedResult[]).sort((a, b) => a.index - b.index);
    return list.map((x) => x.embedding);
  };
  return throttle(run);
}

/**
 * Embed a single query string (for search).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const vectors = await embed(text, { inputType: 'query' });
  return vectors[0];
}

/**
 * Embed documents (e.g. for indexing). Batch for efficiency.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors = await embed(texts, { inputType: 'document' });
  return vectors;
}

/**
 * Rerank documents by relevance to query. Returns indices and scores.
 * Throttled.
 */
export async function rerank(
  query: string,
  documents: string[],
  topK: number = 10
): Promise<Array<{ index: number; score: number; document: string }>> {
  if (documents.length === 0) return [];
  const run = async () => {
    const data = await voyageFetch('/rerank', {
      model: RERANK_MODEL,
      query,
      documents,
      top_k: Math.min(topK, documents.length),
    });
    const results = data.data || [];
    return results.map((r: any) => ({
      index: r.index,
      score: r.relevance_score ?? r.score ?? 0,
      document: documents[r.index],
    }));
  };
  return throttle(run);
}

export const VOYAGE_EMBED_DIMENSION = EMBED_DIMENSION;
