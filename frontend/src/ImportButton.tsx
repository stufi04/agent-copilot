import { useRef, useState, type ChangeEvent } from 'react';
import { importAgent } from './model/import';
import { useEditor } from './model/store';
import type { AgentDraft } from './model/types';

type Report =
  | { kind: 'error'; file: string; messages: string[] }
  | { kind: 'success'; file: string; summary: string; messages: string[] };

/** True for a fresh agent nobody has worked on yet: nothing to lose by replacing it. */
function isBlank(d: AgentDraft): boolean {
  const nodes = Object.values(d.nodes);
  return nodes.length === 1 && Object.keys(d.edges).length === 0 && !nodes[0].taskMessage.trim();
}

/** "Import JSON": loads an agent file (backend format) and replaces the graph with it. */
export function ImportButton() {
  const loadDraft = useEditor((s) => s.loadDraft);
  const input = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<Report | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires a change
    if (!file) return;

    const result = importAgent(await file.text());
    if (!result.ok) {
      setReport({ kind: 'error', file: file.name, messages: result.errors });
      return;
    }
    const current = useEditor.getState().draft;
    if (!isBlank(current) && !window.confirm(`Replace "${current.name || 'Untitled agent'}" with the agent from ${file.name}?`)) {
      setReport(null);
      return;
    }
    loadDraft(result.draft);
    const nodes = Object.keys(result.draft.nodes).length;
    const edges = Object.keys(result.draft.edges).length;
    setReport({
      kind: 'success',
      file: file.name,
      summary: `Imported "${result.draft.name}": ${nodes} node${nodes === 1 ? '' : 's'}, ${edges} edge${edges === 1 ? '' : 's'}.`,
      messages: result.warnings,
    });
  };

  return (
    <div className="import">
      <button type="button" className="btn" onClick={() => input.current?.click()}>
        Import JSON
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        aria-label="Import agent JSON file"
        className="visually-hidden"
        onChange={onFile}
      />
      {report && (
        <div className={`notice notice--${report.kind}`} role={report.kind === 'error' ? 'alert' : 'status'}>
          <div className="notice__head">
            <strong>{report.kind === 'error' ? `Couldn't import ${report.file}` : report.summary}</strong>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setReport(null)}>
              ×
            </button>
          </div>
          {report.kind === 'success' && report.messages.length > 0 && (
            <p className="notice__sub">Some things were changed on the way in:</p>
          )}
          {report.messages.length > 0 && (
            <ul>
              {report.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
