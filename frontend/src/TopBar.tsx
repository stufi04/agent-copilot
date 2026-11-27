import { useState } from 'react';
import { ImportButton } from './ImportButton';
import { UndoRedoButtons } from './UndoRedo';
import { downloadJson, exportAgent } from './model/export';
import { useEditor } from './model/store';
import type { Issue } from './model/validate';

export function TopBar({ issues }: { issues: Issue[] }) {
  const draft = useEditor((s) => s.draft);
  const select = useEditor((s) => s.select);
  const reset = useEditor((s) => s.reset);
  const [showProblems, setShowProblems] = useState(false);

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const label = (i: Issue) => {
    if (i.target.kind === 'agent') return 'Agent';
    if (i.target.kind === 'node') return draft.nodes[i.target.id]?.name || 'Untitled node';
    return `ƒ ${draft.edges[i.target.id]?.function || 'unnamed_edge'}`;
  };

  const onExport = () => {
    const slug = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'agent';
    downloadJson(`${slug}.json`, exportAgent(draft));
  };

  return (
    <header className="top-bar">
      <div className="top-bar__agent">
        <span className="top-bar__brand">
          <BrandIcon />
          AgentEditor
        </span>
        <span className="top-bar__divider" aria-hidden="true" />
        <button type="button" className="top-bar__title" onClick={() => select({ kind: 'agent' })}>
          {draft.name.trim() || 'Untitled agent'}
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Agent settings"
          title="Agent settings"
          onClick={() => select({ kind: 'agent' })}
        >
          <CogIcon />
        </button>
      </div>

      <div className="top-bar__controls" role="toolbar" aria-label="Editor controls">
        <UndoRedoButtons />
        <span className="top-bar__divider" aria-hidden="true" />
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Reset"
          title="Reset: discard this agent and start over"
          onClick={() => window.confirm('Discard this agent and start over?') && reset()}
        >
          <TrashIcon />
        </button>
      </div>

      <div className="top-bar__actions">
        <div className="problems">
          <button
            type="button"
            className={`btn ${errors.length ? 'btn--warn' : 'btn--ok'}`}
            onClick={() => setShowProblems((v) => !v)}
            disabled={!issues.length}
          >
            {issues.length
              ? `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
              : '✓ Valid'}
          </button>
          {showProblems && issues.length > 0 && (
            <ul className="problems__list" onMouseLeave={() => setShowProblems(false)}>
              {[...errors, ...warnings].map((i, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    onClick={() => {
                      select(i.target);
                      setShowProblems(false);
                    }}
                  >
                    <span className={`dot dot--${i.severity}`} />
                    <strong>{label(i)}</strong> {i.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <ImportButton />
        <button
          type="button"
          className="btn btn--primary"
          onClick={onExport}
          disabled={errors.length > 0}
          title={errors.length ? 'Fix the errors before exporting' : 'Download the agent as JSON for the backend'}
        >
          Export JSON
        </button>
      </div>
    </header>
  );
}

function CogIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="2.2" />
      <path
        strokeLinejoin="round"
        d="M6.9 1.5h2.2l.35 1.75 1.2.5 1.5-1 1.55 1.55-1 1.5.5 1.2 1.75.35v2.2l-1.75.35-.5 1.2 1 1.5-1.55 1.55-1.5-1-1.2.5-.35 1.75H6.9l-.35-1.75-1.2-.5-1.5 1-1.55-1.55 1-1.5-.5-1.2L1.05 9.1V6.9l1.75-.35.5-1.2-1-1.5L3.85 2.3l1.5 1 1.2-.5z"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
    </svg>
  );
}

/** Three linked nodes: the app mark. */
function BrandIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 5.5v3.5M10 9l-5 5M10 9l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="6.5" y="1.5" width="7" height="5" rx="1.5" fill="currentColor" />
      <rect x="1.5" y="13" width="7" height="5" rx="1.5" fill="currentColor" opacity="0.7" />
      <rect x="11.5" y="13" width="7" height="5" rx="1.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}
