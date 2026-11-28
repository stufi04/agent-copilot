import { BACKEND_URL } from '../backend';

// Talks to the backend's copilot endpoint (backend/copilot/chat.py). The backend holds the
// OpenAI key and streams the reply back as NDJSON: one JSON event per line,
//   {"type": "delta", "text": "..."} ... then {"type": "done"} or {"type": "error", "message": "..."}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Streams a reply to `messages`, calling `onDelta` with each piece of text as it arrives. */
export type ChatStream = (
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  signal: AbortSignal,
) => Promise<void>;

export const CHAT_URL = `${BACKEND_URL}/api/copilot/chat`;

export const streamChat: ChatStream = async (messages, onDelta, signal) => {
  let response: Response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`Couldn't reach the backend at ${BACKEND_URL}. Start it with "make dev" and try again.`);
  }
  if (!response.ok || !response.body) throw new Error(await errorText(response));

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? ''; // an incomplete last line waits for the next chunk
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as { type: string; text?: string; message?: string };
      if (event.type === 'delta' && event.text) onDelta(event.text);
      else if (event.type === 'error') throw new Error(event.message || 'The copilot couldn\'t reply.');
      else if (event.type === 'done') return;
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
