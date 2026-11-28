import { useEffect, useRef } from 'react';
import { exportAgent } from '../model/export';
import { useEditor } from '../model/store';
import { useCall } from './call';

/** "Speak to agent" in the top bar; "Hang up" while a call is on. */
export function CallButton({ blocked }: { blocked: boolean }) {
  const status = useCall((s) => s.status);
  const start = useCall((s) => s.start);
  const hangUp = useCall((s) => s.hangUp);

  if (status === 'connecting' || status === 'connected') {
    return (
      <button type="button" className="btn btn--hangup" onClick={() => void hangUp()}>
        <span className={`call-dot ${status === 'connected' ? 'call-dot--live' : ''}`} aria-hidden="true" />
        {status === 'connecting' ? 'Connecting… (cancel)' : 'Hang up'}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--call"
      disabled={blocked}
      title={blocked ? 'Fix the errors before calling the agent' : 'Start a voice call with this agent (uses your microphone)'}
      onClick={() => void start(exportAgent(useEditor.getState().draft))}
    >
      <MicIcon />
      Speak to agent
    </button>
  );
}

const STATUS_TEXT = {
  idle: '',
  connecting: 'Connecting…',
  connected: 'On a call',
  ended: 'Call ended',
  error: "Couldn't start the call",
};

/** The live transcript, under the call button while a call is on (and after, until closed). */
export function CallPanel() {
  const { status, lines, activeNode, error, agentName, dismiss } = useCall();
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (body.current) body.current.scrollTop = body.current.scrollHeight; // keep the latest line in view
  }, [lines]);

  if (status === 'idle') return null;
  const live = status === 'connecting' || status === 'connected';

  return (
    <section className={`call-panel call-panel--${status}`} aria-label="Call">
      <header className="call-panel__head">
        <span className={`call-dot ${status === 'connected' ? 'call-dot--live' : ''}`} aria-hidden="true" />
        <strong>{STATUS_TEXT[status]}</strong>
        {agentName && <span className="muted call-panel__agent">{agentName}</span>}
        {!live && (
          <button type="button" className="icon-btn" aria-label="Close call panel" onClick={dismiss}>
            ×
          </button>
        )}
      </header>
      {activeNode && (
        <p className="call-panel__node">
          Now in <strong>{activeNode}</strong>
        </p>
      )}
      <div className="call-panel__body" ref={body}>
        {error && <p className="call-panel__error" role="alert">{error}</p>}
        {!error && lines.length === 0 && (
          <p className="muted">{status === 'connecting' ? 'Allow the microphone if asked.' : 'Say hello. The agent is listening.'}</p>
        )}
        {lines.map((l, i) => (
          <p key={i} className={`call-line call-line--${l.role}`}>
            <span className="call-line__who">{l.role === 'user' ? 'You' : 'Agent'}</span>
            <span>
              {l.text}
              {l.interim && <span className="call-line__interim"> {l.interim}</span>}
            </span>
          </p>
        ))}
      </div>
      {live && <p className="call-panel__foot muted">Edits made now apply to the next call.</p>}
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" />
      <path d="M3 8a5 5 0 0 0 10 0M8 13v1.5" />
    </svg>
  );
}
