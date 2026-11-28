import { BACKEND_URL } from '../backend';

// Talks to the backend's copilot endpoint (backend/copilot/chat.py). The backend holds the
// OpenAI key and streams one step of the reply back as NDJSON: one JSON event per line,
//   {"type": "delta", "text": "..."}                       text, as it's written
//   {"type": "tool_calls", "calls": [{id, name, arguments}]} graph edits the model wants
//   {"type": "done"} | {"type": "error", "message": "..."}
// Running those tool calls and asking for the next step is the store's job (copilot.ts).

export interface ToolCall {
  id: string;
  name: string;
  /** JSON text, as the model wrote it. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | {
      role: 'tool';
      toolCallId: string;
      /** What the model is told: the outcome and the issues left, as JSON. */
      content: string;
      /** For the panel: whether the edit worked, and what it did or why it didn't. */
      ok: boolean;
      summary: string;
    };

export interface ChatRequest {
  messages: ChatMessage[];
  /** The agent on screen, for the model to see (model/describe.ts). */
  agent: unknown;
}

/**
 * Streams one step of the reply, calling `onDelta` with each piece of text as it arrives.
 * Resolves with the tool calls the model made in this step (none means it's finished).
 */
export type ChatStream = (
  request: ChatRequest,
  onDelta: (text: string) => void,
  signal: AbortSignal,
) => Promise<ToolCall[] | void>;

export const CHAT_URL = `${BACKEND_URL}/api/copilot/chat`;

/** The conversation in OpenAI's message format, as the backend expects it. */
export function toWire(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    if (m.role === 'assistant' && m.toolCalls?.length)
      return {
        role: 'assistant',
        content: m.content,
        tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      };
    return { role: m.role, content: m.content };
  });
}

export const streamChat: ChatStream = async ({ messages, agent }, onDelta, signal) => {
  let response: Response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: toWire(messages), agent }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`Couldn't reach the backend at ${BACKEND_URL}. Start it with "make dev" and try again.`);
  }
  if (!response.ok || !response.body) throw new Error(await errorText(response));

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  let toolCalls: ToolCall[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? ''; // an incomplete last line waits for the next chunk
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; text?: string; message?: string; calls?: ToolCall[] };
      if (event.type === 'delta' && event.text) onDelta(event.text);
      else if (event.type === 'tool_calls') toolCalls = event.calls ?? [];
      else if (event.type === 'error') throw new Error(event.message || "The copilot couldn't reply.");
      else if (event.type === 'done') return toolCalls;
    }
  }
  throw new Error('The reply was cut off. Try again.');
};

async function errorText(response: Response): Promise<string> {
  try {
    const { detail } = (await response.json()) as { detail?: unknown };
    if (typeof detail === 'string') return detail;
  } catch {
    // not JSON; fall through
  }
  return `The copilot couldn't reply (HTTP ${response.status}).`;
}
