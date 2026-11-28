import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor } from '../model/store';
import { MIN_HEIGHT, useCopilot } from './copilot';
import { Markdown } from './Markdown';

/** The copilot chat, docked along the bottom of the editor. Collapses to its header bar. */
export function CopilotPanel() {
  const { messages, status, error, open, height, lastChange, send, stop, clear, setOpen, setHeight } = useCopilot();
  // The copilot's last changes can be undone in one step while nothing has changed since.
  const canUndoChange = useEditor((s) => lastChange !== null && s.draft === lastChange);
  const undo = useEditor((s) => s.undo);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const streaming = status === 'streaming';

  // Follow the reply as it streams in, unless the user has scrolled up to read.
  useLayoutEffect(() => {
    if (list.current && stickToBottom.current) list.current.scrollTop = list.current.scrollHeight;
  }, [messages, error, open]);

  // Grow the message box with its text, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft, open]);

  const submit = () => {
    if (streaming || !draft.trim()) return;
    stickToBottom.current = true;
    void send(draft);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // Drag the top edge to resize; the canvas above gives up the space.
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const max = () => Math.max(MIN_HEIGHT, window.innerHeight * 0.75);
    const onMove = (ev: globalThis.PointerEvent) => setHeight(Math.min(max(), startHeight + (startY - ev.clientY)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('is-resizing-copilot');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    document.body.classList.add('is-resizing-copilot');
  };

  return (
    <section className={`copilot ${open ? 'is-open' : ''}`} aria-label="Copilot" style={open ? { height } : undefined}>
      {open && (
        <div
          className="copilot__resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize copilot"
          onPointerDown={startResize}
        />
      )}
      <header className="copilot__head">
        <button type="button" className="copilot__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <SparkIcon />
          <span>Copilot</span>
          <Chevron up={!open} />
        </button>
        {streaming && <span className="copilot__status muted">Writing…</span>}
        <button
          type="button"
          className="btn btn--ghost btn--small copilot__new"
          disabled={messages.length === 0 && !error}
          onClick={() => {
            clear();
            setDraft('');
            input.current?.focus();
          }}
        >
          New chat
        </button>
      </header>

      {open && (
        <>
          <div
            className="copilot__messages"
            ref={list}
            aria-live="polite"
            onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
          >
            {messages.length === 0 && !error && (
              <p className="copilot__empty muted">
                Ask the copilot about your agent, or ask it to change it: "add a branch for callers who want to cancel",
                "rename collect_details", "build me a pharmacy refill agent". You'll see the graph change, and one undo
                takes back everything it did in a reply.
              </p>
            )}
            {messages.map((m, i) => {
              const last = i === messages.length - 1;
              if (m.role === 'tool')
                return (
                  <p key={i} className={`copilot-edit ${m.ok ? '' : 'copilot-edit--failed'}`}>
                    <span aria-hidden="true">{m.ok ? '✓' : '✗'}</span> {m.summary}
                  </p>
                );
              if (m.role === 'assistant' && !m.content)
                return streaming && last ? (
                  <div key={i} className="copilot-msg copilot-msg--assistant">
                    <span className="copilot-msg__typing">…</span>
                  </div>
                ) : null; // a step that only edited the graph: its edits are listed below it
              return (
                <div key={i} className={`copilot-msg copilot-msg--${m.role}`}>
                  {m.role === 'assistant' ? <Markdown text={m.content} /> : m.content}
                </div>
              );
            })}
            {canUndoChange && !streaming && (
              <button type="button" className="btn btn--small copilot__undo" onClick={undo}>
                Undo these changes
              </button>
            )}
            {error && (
              <p className="copilot__error" role="alert">
                {error}
              </p>
            )}
          </div>

          <form
            className="copilot__composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <textarea
              ref={input}
              rows={1}
              value={draft}
              aria-label="Message the copilot"
              placeholder="Ask the copilot… (Enter to send, Shift+Enter for a new line)"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            {streaming ? (
              <button type="button" className="btn" onClick={stop}>
                Stop
              </button>
            ) : (
              <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>
                Send
              </button>
            )}
          </form>
        </>
      )}
    </section>
  );
}

function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 1.5l1.6 4.1 4.4 1.4-4.4 1.4L8 12.5 6.4 8.4 2 7l4.4-1.4z" />
      <path d="M13 11l.6 1.4 1.4.6-1.4.6L13 15l-.6-1.4-1.4-.6 1.4-.6z" />
    </svg>
  );
}

function Chevron({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={up ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'} />
    </svg>
  );
}
