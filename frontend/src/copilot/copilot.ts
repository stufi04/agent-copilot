import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { applyTool } from '../model/copilotOps';
import { describeAgent, describeIssues } from '../model/describe';
import { useEditor } from '../model/store';
import type { AgentDraft } from '../model/types';
import { validate } from '../model/validate';
import { streamChat, type ChatMessage, type ChatStream, type ToolCall } from './chatApi';

// The copilot chat in the bottom panel. The conversation lives here (and in localStorage);
// the backend is stateless and gets the whole conversation, plus the agent on screen,
// with each request.
//
// One message from the user can take several steps: whenever the model asks for graph
// edits (tool calls), they're applied to the editor right away, their results go back to
// the model, and it's asked again, until it answers with text alone. Everything the
// copilot changes while answering one message is a single undo step.
//
// When it's done, the editor checks the agent: if the copilot's changes left errors
// that weren't there before, it's asked once to fix them; any still left are shown.

export type CopilotStatus = 'idle' | 'streaming' | 'error';

export const MIN_HEIGHT = 160;
export const DEFAULT_HEIGHT = 280;
/** Most model calls one message may take, so a confused model can't loop forever. */
export const MAX_STEPS = 10;

interface CopilotState {
  messages: ChatMessage[];
  status: CopilotStatus;
  error: string | null;
  /** Whether the panel is expanded, and its height in px when it is. */
  open: boolean;
  height: number;
  /**
   * The agent as the copilot's last reply left it, if that reply changed it. While the
   * editor still shows exactly that, one undo takes the reply's changes back.
   */
  lastChange: AgentDraft | null;
  /** Errors the copilot's last reply left in the agent (that weren't there before it). */
  leftProblems: string[];

  send(text: string): Promise<void>;
  /** Stop the reply being written; what has arrived (and any edits made) stays. */
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
  return last?.role === 'assistant' && !last.content && !last.toolCalls?.length ? messages.slice(0, -1) : messages;
};

const editor = () => useEditor.getState();

/** The agent's validation errors (not warnings), as the model is shown them. */
export const errorsIn = (d: AgentDraft) => describeIssues(d, validate(d).filter((i) => i.severity === 'error'));

/** What the editor tells the copilot when its changes left errors behind. */
export function checkMessage(problems: string[]): string {
  return [
    "[Automatic check by the editor] Your changes left the agent with these errors, which weren't there before:",
    ...problems.map((p) => `- ${p}`),
    'Fix them with your tools, then reply briefly. If one needs a decision from the user, ask them instead.',
  ].join('\n');
}

/** Apply one tool call to the editor, returning the message that tells the model how it went. */
function runToolCall(call: ToolCall, turnId: string): Extract<ChatMessage, { role: 'tool' }> {
  let args: unknown;
  try {
    args = JSON.parse(call.arguments || '{}');
  } catch {
    args = undefined;
  }
  const before = editor().draft;
  const { draft, result } =
    args === undefined
      ? { draft: before, result: { ok: false as const, error: 'The arguments were not valid JSON.' } }
      : applyTool(before, call.name, args);
  if (draft !== before) editor().applyCopilotDraft(draft, turnId);

  const summary = result.ok ? result.summary : `${call.name}: ${result.error}`;
  const content = JSON.stringify(
    result.ok
      ? { ok: true, result: result.summary, issues: describeIssues(draft) }
      : { ok: false, error: result.error },
  );
  return { role: 'tool', toolCallId: call.id, content, ok: result.ok, summary };
}

export const useCopilot = create<CopilotState>()(
  persist(
    (set, get) => ({
      messages: [],
      status: 'idle',
      error: null,
      open: true,
      height: DEFAULT_HEIGHT,
      lastChange: null,
      leftProblems: [],

      send: async (text) => {
        const content = text.trim();
        if (!content || get().status === 'streaming') return;

        const mine = new AbortController();
        controller = mine;
        const current = () => controller === mine; // false once stopped by "New chat" or a newer message
        const turnId = crypto.randomUUID();
        let changed = false;
        let checked = false; // the copilot gets one nudge per message to fix what it broke
        const errorsBefore = new Set(errorsIn(editor().draft));
        const newErrors = () => (changed ? errorsIn(editor().draft).filter((e) => !errorsBefore.has(e)) : []);

        set((s) => ({
          messages: [...s.messages, { role: 'user', content }],
          status: 'streaming',
          error: null,
          open: true,
          lastChange: null,
          leftProblems: [],
        }));

        const appendToReply = (delta: string) => {
          if (!current()) return;
          set((s) => {
            const messages = [...s.messages];
            const last = messages[messages.length - 1] as Extract<ChatMessage, { role: 'assistant' }>;
            messages[messages.length - 1] = { ...last, content: last.content + delta };
            return { messages };
          });
        };

        const finish = (update: Partial<CopilotState>) => {
          if (!current()) return;
          set((s) => ({
            ...update,
            messages: withoutEmptyReply(s.messages),
            lastChange: changed ? editor().draft : null,
            leftProblems: newErrors(),
          }));
          controller = null;
        };

        try {
          for (let step = 0; ; step++) {
            if (step === MAX_STEPS) {
              finish({ status: 'error', error: `The copilot stopped after ${MAX_STEPS} steps without finishing. Ask it to carry on, or undo its changes.` });
              return;
            }
            const history = get().messages;
            set({ messages: [...history, { role: 'assistant', content: '' }] });
            const calls = (await stream({ messages: history, agent: describeAgent(editor().draft) }, appendToReply, mine.signal)) ?? [];
            if (!current()) return;
            if (!calls.length) {
              const problems = newErrors();
              if (problems.length && !checked) {
                // Finished, but broke something: ask once for a fix before handing back.
                checked = true;
                set((s) => ({
                  messages: [...withoutEmptyReply(s.messages), { role: 'check', content: checkMessage(problems), problems }],
                }));
                continue;
              }
              finish({ status: 'idle' });
              return;
            }

            // The model asked for edits: record them on its message, apply them, report back.
            set((s) => {
              const messages = [...s.messages];
              const last = messages[messages.length - 1] as Extract<ChatMessage, { role: 'assistant' }>;
              messages[messages.length - 1] = { ...last, toolCalls: calls };
              return { messages };
            });
            const results = calls.map((call) => {
              const message = runToolCall(call, turnId);
              if (message.ok) changed = true;
              return message;
            });
            set((s) => ({ messages: [...s.messages, ...results] }));
            if (mine.signal.aborted) {
              finish({ status: 'idle' });
              return;
            }
          }
        } catch (e) {
          if (mine.signal.aborted) finish({ status: 'idle' });
          else finish({ status: 'error', error: e instanceof Error ? e.message : String(e) });
        }
      },

      stop: () => controller?.abort(),

      clear: () => {
        const c = controller;
        controller = null;
        c?.abort();
        set({ messages: [], status: 'idle', error: null, lastChange: null, leftProblems: [] });
      },

      setOpen: (open) => set({ open }),
      setHeight: (height) => set({ height: Math.max(MIN_HEIGHT, Math.round(height)) }),
    }),
    {
      name: 'agent-composer:copilot',
      version: 1,
      // A reply cut off by a reload is kept as it was; the status starts fresh. The undo
      // history doesn't survive a reload, so neither does lastChange.
      partialize: (s) => ({ messages: withoutEmptyReply(s.messages), open: s.open, height: s.height }),
    },
  ),
);
