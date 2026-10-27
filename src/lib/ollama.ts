import { env } from './env';

export class OllamaError extends Error {
  constructor(message: string, public status = 503) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.ollamaUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new OllamaError(
      `Cannot reach Ollama at ${env.ollamaUrl} (${reason}). Start it with "ollama serve" and make sure OLLAMA_URL is correct.`,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 404 || /not found/i.test(text)) {
      throw new OllamaError(
        `Ollama does not have the requested model. Run "ollama pull ${env.embedModel}" and "ollama pull ${env.llmModel}". (${text.slice(0, 200)})`,
        502,
      );
    }
    throw new OllamaError(`Ollama returned HTTP ${res.status}: ${text.slice(0, 300)}`, 502);
  }
  return (await res.json()) as T;
}

/**
 * nomic-embed-text was trained with task prefixes; other models ignore this.
 * Clause-vs-clause comparison is symmetric, so both sides use the "document" prefix.
 */
function withPrefix(text: string, kind: 'document' | 'query'): string {
  if (/^nomic-embed-text/i.test(env.embedModel)) {
    return (kind === 'query' ? 'search_query: ' : 'search_document: ') + text;
  }
  return text;
}

/** Convert texts to embedding vectors using Ollama's /api/embed endpoint. */
export async function embedTexts(texts: string[], kind: 'document' | 'query' = 'document'): Promise<number[][]> {
  const out: number[][] = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => withPrefix(t, kind));
    const data = await post<{ embeddings: number[][] }>('/api/embed', { model: env.embedModel, input: batch }, 120_000);
    if (!data.embeddings || data.embeddings.length !== batch.length) {
      throw new OllamaError('Ollama returned an unexpected embedding response.', 502);
    }
    out.push(...data.embeddings);
  }
  return out;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Generate text with the local LLM (non-streaming). */
export async function chat(messages: ChatMessage[], opts: { temperature?: number; maxTokens?: number } = {}): Promise<string> {
  const data = await post<{ message?: { content?: string } }>(
    '/api/chat',
    {
      model: env.llmModel,
      messages,
      stream: false,
      options: { temperature: opts.temperature ?? 0.2, num_predict: opts.maxTokens ?? 450 },
    },
    180_000,
  );
  const text = data.message?.content?.trim();
  if (!text) throw new OllamaError('Ollama returned an empty answer.', 502);
  return text;
}
