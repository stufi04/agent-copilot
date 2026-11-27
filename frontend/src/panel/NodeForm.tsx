import { nodesRemovedBy } from '../model/graph';
import { useEditor } from '../model/store';
import type { AgentNode } from '../model/types';
import { issuesFor, type Issue } from '../model/validate';
import { Field } from './Field';

export function NodeForm({ node, issues }: { node: AgentNode; issues: Issue[] }) {
  const isInitial = useEditor((s) => s.draft.initialNodeId === node.id);
  const updateNode = useEditor((s) => s.updateNode);
  const deleteNode = useEditor((s) => s.deleteNode);
  const update = (patch: Partial<AgentNode>) => updateNode(node.id, patch);

  const onDelete = () => {
    const below = nodesRemovedBy(useEditor.getState().draft, { kind: 'node', id: node.id }).size - 1;
    const msg = below
      ? `Delete "${node.name}" and the ${below} node(s) below it?`
      : `Delete "${node.name}"?`;
    if (window.confirm(msg)) deleteNode(node.id);
  };

  return (
    <div className="form">
      <Field label="Name" issues={issuesFor(issues, 'name')}>
        <input value={node.name} onChange={(e) => update({ name: e.target.value })} autoFocus />
      </Field>

      <Field
        label="Task message"
        hint="What the agent should do in this step. Sent to the LLM as a developer message."
        issues={issuesFor(issues, 'taskMessage')}
      >
        <textarea
          rows={6}
          value={node.taskMessage}
          placeholder="e.g. Greet the caller and ask whether they'd like to book, reschedule, or cancel."
          onChange={(e) => update({ taskMessage: e.target.value })}
        />
      </Field>

      <Field
        label="Role message override"
        hint="Optional. Replaces the agent's persona while in this node."
        issues={issuesFor(issues, 'roleMessage')}
      >
        <textarea
          rows={3}
          value={node.roleMessage}
          placeholder="Leave empty to use the agent persona"
          onChange={(e) => update({ roleMessage: e.target.value })}
        />
      </Field>

      <Field label="Behaviour" issues={issuesFor(issues, 'end')}>
        <span className="checkbox">
          <input type="checkbox" checked={node.end} onChange={(e) => update({ end: e.target.checked })} />
          Ends the call after this step
        </span>
      </Field>

      {!isInitial && (
        <p className="field__hint">Drag this node onto another node to move it there, together with everything below it.</p>
      )}

      <div className="form__footer">
        {isInitial ? (
          <span className="muted">This is the start node, so it can't be deleted.</span>
        ) : (
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            Delete node
          </button>
        )}
      </div>
    </div>
  );
}
