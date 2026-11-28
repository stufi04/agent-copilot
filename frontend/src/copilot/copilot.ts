import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { streamChat, type ChatMessage, type ChatStream } from './chatApi';

// The copilot chat in the bottom panel. The conversation lives here (and in localStorage);
// the backend is stateless and gets the whole conversation with each message.
// For now it is an open chat with the LLM: it doesn't read or change the graph.

export type CopilotStatus = 'idle' | 'streaming' | 'error';

export const MIN_HEIGHT = 160;
export const DEFAULT_HEIGHT = 280;

interface CopilotState {
  messages: ChatMessage[];
  status: CopilotStatus;
  error: string | null;
  /** Whether the panel is expanded, and its height in px when it is. */
  open: boolean;
  height: number;

  send(text: string): Promise<void>;
  /** Stop the reply being written; what has arrived so far stays. */
  stop(): void;
  /** Start a new conversation. */
  clear(): void;
  setOpen(open: boolean): void;
  setHeight(height: number): void;
}

let stream: ChatStream = streamChat;
let controller: AbortController | null = null;

/** Use another stream (tests), or restore the real one with null. */
export function setChatStream(s: ChatStream | null) {
  stream = s ?? streamChat;
}

/** Drop the reply placeholder if nothing arrived in it. */
const withoutEmptyReply = (messages: ChatMessage[]) => {
  const last = messages[messages.length - 1];
  return last?.role === 'assistant' && !last.content ? messages.slice(0, -1) : messages;
};

export const useCopilot = create<CopilotState>()(
  persist(
    (set, get) => ({
      messages: [],
      status: 'idle',
      error: null,
      open: true,
      height: DEFAULT_HEIGHT,

      send: async (text) => {
        const content = text.trim();
        if (!content || get().status === 'streaming') return;

        const history: ChatMessage[] = [...get().messages, { role: 'user', content }];
        set({ messages: [...history, { role: 'assistant', content: '' }], status: 'streaming', error: null, open: true });
        const mine = new AbortController();
        controller = mine;

        const appendToReply = (delta: string) =>
          set((s) => {
            const messages = [...s.messages];
            const last = messages[messages.length - 1];
            messages[messages.length - 1] = { ...last, content: last.content + delta };
            return { messages };
          });

        try {
          await stream(history, appendToReply, mine.signal);
          if (controller === mine) set({ status: 'idle' });
        } catch (e) {
          if (controller !== mine) return; // a newer conversation has taken over
          if (mine.signal.aborted) set((s) => ({ status: 'idle', messages: withoutEmptyReply(s.messages) }));
          else
            set((s) => ({
              status: 'error',
              error: e instanceof Error ? e.message : String(e),
              messages: withoutEmptyReply(s.messages),
            }));
        } finally {
          if (controller === mine) controller = null;
        }
      },

      stop: () => controller?.abort(),

      clear: () => {
        const c = controller;
        controller = null;
        c?.abort();
        set({ messages: [], status: 'idle', error: null });
      },

      setOpen: (open) => set({ open }),
      setHeight: (height) => set({ height: Math.max(MIN_HEIGHT, Math.round(height)) }),
    }),
    {
      name: 'agent-composer:copilot',
      version: 1,
      // A reply cut off by a reload is kept as it was; the status starts fresh.
      partialize: (s) => ({ messages: withoutEmptyReply(s.messages), open: s.open, height: s.height }),
    },
  ),
);
