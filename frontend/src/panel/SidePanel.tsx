import { useEffect } from 'react';
import { useEditor } from '../model/store';
import type { Issue } from '../model/validate';
import { AgentSettingsForm } from './AgentSettingsForm';
import { EdgeForm } from './EdgeForm';
import { NodeForm } from './NodeForm';

/** Right-hand drawer showing the form for whatever is selected. */
export function SidePanel({ issues }: { issues: Issue[] }) {
  const selection = useEditor((s) => s.selection);
  const draft = useEditor((s) => s.draft);
  const select = useEditor((s) => s.select);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && select(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [select]);

  const node = selection?.kind === 'node' ? draft.nodes[selection.id] : undefined;
  const edge = selection?.kind === 'edge' ? draft.edges[selection.id] : undefined;
  const isAgent = selection?.kind === 'agent';
  const open = Boolean(node || edge || isAgent);

  const own = (kind: 'node' | 'edge' | 'agent', id?: string) =>
    issues.filter((i) => i.target.kind === kind && (kind === 'agent' || ('id' in i.target && i.target.id === id)));

  let title = '';
  let body = null;
  if (node) {
    title = 'Node';
    // key: remount per element so autoFocus fires and inputs don't carry over.
    body = <NodeForm key={node.id} node={node} issues={own('node', node.id)} />;
  } else if (edge) {
    title = 'Edge';
    body = <EdgeForm key={edge.id} edge={edge} issues={own('edge', edge.id)} />;
  } else if (isAgent) {
    title = 'Agent settings';
    body = <AgentSettingsForm issues={own('agent')} />;
  }

  return (
    <aside className={`side-panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
      {open && (
        <div className="side-panel__inner">
          <header className="side-panel__header">
            <h2>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close panel" onClick={() => select(null)}>
              ×
            </button>
          </header>
          <div className="side-panel__body">{body}</div>
        </div>
      )}
    </aside>
  );
}
