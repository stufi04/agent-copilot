import { useState } from 'react';
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
      <button type="button" className="top-bar__title" onClick={() => select({ kind: 'agent' })}>
        {draft.name.trim() || 'Untitled agent'}
      </button>
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
        <button type="button" className="btn" onClick={() => select({ kind: 'agent' })}>
          Agent settings
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onExport}
          disabled={errors.length > 0}
          title={errors.length ? 'Fix the errors before exporting' : 'Download the agent as JSON for the backend'}
        >
          Export JSON
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => window.confirm('Discard this agent and start over?') && reset()}
        >
          Reset
        </button>
      </div>
    </header>
  );
}
