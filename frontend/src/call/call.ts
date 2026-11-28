import { create } from 'zustand';
import { addBotSpeech, addUserSpeech, type Line } from './transcript';

// A voice call with the agent on screen, run by the backend (backend/bot.py).
// The store holds what the UI shows; the actual connection is a CallConnection, which
// is the Pipecat browser client in the app (pipecatConnection.ts) and a fake in tests.

export const BACKEND_URL: string = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:7860';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'ended' | 'error';

/** What a connection reports back while a call runs. */
export interface CallEvents {
  userSpeech(text: string, final: boolean): void;
  botSpeech(text: string): void;
  /** The conversation entered this node (by name). */
  node(name: string): void;
  disconnected(): void;
}

export interface CallConnection {
  /** Resolves once the agent is ready to talk. */
  connect(agent: unknown): Promise<void>;
  disconnect(): Promise<void>;
}

export type ConnectionFactory = (events: CallEvents) => CallConnection;

interface CallState {
  status: CallStatus;
  lines: Line[];
  /** Name of the node the conversation is in, while connected. */
  activeNode: string | null;
  error: string | null;
  /** The name of the agent being called, as it was when the call started. */
  agentName: string | null;

  start(agent: { name: string }): Promise<void>;
  hangUp(): Promise<void>;
  /** Close the call panel once a call is over. */
  dismiss(): void;
}

let factory: ConnectionFactory | null = null;
let connection: CallConnection | null = null;

/** Use another connection (tests), or restore the default with null. */
export function setConnectionFactory(f: ConnectionFactory | null) {
  factory = f;
}

async function defaultFactory(): Promise<ConnectionFactory> {
  // Loaded on demand: the Pipecat client is only needed once someone starts a call.
  const { pipecatConnection } = await import('./pipecatConnection');
  return pipecatConnection;
}

const idle = { status: 'idle' as const, lines: [], activeNode: null, error: null, agentName: null };

export const useCall = create<CallState>()((set, get) => ({
  ...idle,

  start: async (agent) => {
    if (get().status === 'connecting' || get().status === 'connected') return;
    set({ ...idle, status: 'connecting', agentName: agent.name });

    const events: CallEvents = {
      userSpeech: (text, final) => set((s) => ({ lines: addUserSpeech(s.lines, text, final) })),
      botSpeech: (text) => set((s) => ({ lines: addBotSpeech(s.lines, text) })),
      node: (name) => set({ activeNode: name }),
      disconnected: () => {
        connection = null;
        set((s) => (s.status === 'connected' || s.status === 'connecting' ? { status: 'ended', activeNode: null } : {}));
      },
    };

    try {
      const make = factory ?? (await defaultFactory());
      const conn = make(events);
      connection = conn;
      await conn.connect(agent);
      if (connection === conn) set((s) => (s.status === 'connecting' ? { status: 'connected' } : {}));
    } catch (e) {
      connection = null;
      set({ status: 'error', activeNode: null, error: describeError(e) });
    }
  },

  hangUp: async () => {
    const conn = connection;
    connection = null;
    set((s) => ({ status: s.status === 'idle' ? 'idle' : 'ended', activeNode: null }));
    await conn?.disconnect();
  },

  dismiss: () => {
    if (get().status === 'connecting' || get().status === 'connected') return;
    set(idle);
  },
}));

function describeError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError'))
    return 'Microphone access was blocked. Allow the microphone for this page and try again.';
  if (/fetch|network|Failed to|ECONNREFUSED|NetworkError|status/i.test(message))
    return `Couldn't reach the voice backend at ${BACKEND_URL}. Start it with "make run" and try again.`;
  return message || 'The call could not be started.';
}
