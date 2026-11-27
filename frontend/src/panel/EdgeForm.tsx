import { nodesRemovedBy } from '../model/graph';
import { useEditor } from '../model/store';
import type { AgentEdge, PropertyType } from '../model/types';
import { issuesFor, type Issue } from '../model/validate';
import { Field } from './Field';

const TYPES: PropertyType[] = ['string', 'number', 'integer', 'boolean'];

export function EdgeForm({ edge, issues }: { edge: AgentEdge; issues: Issue[] }) {
  const source = useEditor((s) => s.draft.nodes[edge.sourceId]);
  const target = useEditor((s) => (edge.targetId ? s.draft.nodes[edge.targetId] : undefined));
  const { updateEdge, deleteEdge, addProperty, updateProperty, removeProperty, select } = useEditor.getState();

  const onDelete = () => {
    const below = nodesRemovedBy(useEditor.getState().draft, { kind: 'edge', id: edge.id }).size;
    const msg = below
      ? `Delete edge "${edge.function}" and the ${below} node(s) it leads to?`
      : `Delete edge "${edge.function}"?`;
    if (window.confirm(msg)) deleteEdge(edge.id);
  };

  return (
    <div className="form">
      <div className="route">
        <button type="button" className="link" onClick={() => select({ kind: 'node', id: edge.sourceId })}>
          {source?.name || 'Untitled node'}
        </button>
        <span className="route__arrow">→</span>
        {target ? (
          <button type="button" className="link" onClick={() => select({ kind: 'node', id: target.id })}>
            {target.name || 'Untitled node'}
          </button>
        ) : (
          <span className="muted">no target yet. Hover the edge and click [+]</span>
        )}
      </div>
      <p className="field__hint">Drag this edge onto any node to point it there.</p>

      <Field
        label="Function name"
        hint="The tool the LLM calls to take this edge."
        issues={issuesFor(issues, 'function')}
      >
        <input
          className="mono"
          value={edge.function}
          onChange={(e) => updateEdge(edge.id, { function: e.target.value })}
          autoFocus
        />
      </Field>

      <Field
        label="Description"
        hint="When the LLM should call it."
        issues={issuesFor(issues, 'description')}
      >
        <textarea
          rows={3}
          value={edge.description}
          placeholder="e.g. Record what the caller wants to do once they say it."
          onChange={(e) => updateEdge(edge.id, { description: e.target.value })}
        />
      </Field>

      {issuesFor(issues, 'target').map((i) => (
        <span key={i.message} className="field__issue field__issue--error">
          {i.message}
        </span>
      ))}

      <section className="props">
        <div className="props__head">
          <span className="field__label">Fields to collect</span>
          <button type="button" className="btn btn--small" onClick={() => addProperty(edge.id)}>
            + Add field
          </button>
        </div>
        {edge.properties.length === 0 && (
          <span className="field__hint">None. The LLM takes this edge without passing any data.</span>
        )}
        {edge.properties.map((p) => (
          <div key={p.id} className="prop">
            <div className="prop__row">
              <input
                className="mono"
                placeholder="name"
                value={p.key}
                onChange={(e) => updateProperty(edge.id, p.id, { key: e.target.value })}
              />
              <select
                value={p.type}
                onChange={(e) => updateProperty(edge.id, p.id, { type: e.target.value as PropertyType })}
              >
                {TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn"
                title="Remove field"
                aria-label="Remove field"
                onClick={() => removeProperty(edge.id, p.id)}
              >
                ×
              </button>
            </div>
            <input
              placeholder="description"
              value={p.description}
              onChange={(e) => updateProperty(edge.id, p.id, { description: e.target.value })}
            />
            {p.type === 'string' && (
              <input
                placeholder="allowed values, comma-separated (optional)"
                value={p.enumText}
                onChange={(e) => updateProperty(edge.id, p.id, { enumText: e.target.value })}
              />
            )}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={p.required}
                onChange={(e) => updateProperty(edge.id, p.id, { required: e.target.checked })}
              />
              Required
            </label>
            {issuesFor(issues, `property:${p.id}`).map((i) => (
              <span key={i.message} className="field__issue field__issue--error">
                {i.message}
              </span>
            ))}
          </div>
        ))}
      </section>

      <div className="form__footer">
        <button type="button" className="btn btn--danger" onClick={onDelete}>
          Delete edge
        </button>
      </div>
    </div>
  );
}
