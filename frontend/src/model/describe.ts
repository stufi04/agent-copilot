import { exportProperty } from './export';
import type { AgentDraft, Id } from './types';
import { validate, type Issue } from './validate';

// The agent as the copilot sees it: the backend JSON format (names, not ids), plus the
// validation issues. Unlike exportAgent, it works on an agent that's mid-edit: an edge
// with no target yet has `target: null`, and nodes not connected to the start are listed.

const UNNAMED = '(unnamed)';

export function describeAgent(d: AgentDraft) {
  const nameOf = (id: Id) => d.nodes[id]?.name.trim() || UNNAMED;
  const edges = Object.values(d.edges);

  // Conversation order: breadth-first from the start node, then anything not connected.
  const order: Id[] = [];
  const queue: Id[] = [d.initialNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (order.includes(id) || !d.nodes[id]) continue;
    order.push(id);
    for (const e of edges) if (e.sourceId === id && e.targetId) queue.push(e.targetId);
  }
  for (const id of Object.keys(d.nodes)) if (!order.includes(id)) order.push(id);

  return {
    name: d.name.trim(),
    voice_id: d.voiceId.trim(),
    model: d.model.trim(),
    persona: d.persona.trim(),
    initial_node: nameOf(d.initialNodeId),
    nodes: order.map((id) => {
      const n = d.nodes[id];
      const out = edges.filter((e) => e.sourceId === id);
      return {
        name: nameOf(id),
        ...(n.roleMessage.trim() ? { role_message: n.roleMessage.trim() } : {}),
        task_messages: [{ role: 'developer', content: n.taskMessage.trim() }],
        ...(out.length
          ? {
              edges: out.map((e) => ({
                function: e.function.trim(),
                description: e.description.trim(),
                target: e.targetId ? nameOf(e.targetId) : null,
                properties: Object.fromEntries(e.properties.map((p) => [p.key.trim(), exportProperty(p)])),
                required: e.properties.filter((p) => p.required).map((p) => p.key.trim()),
              })),
            }
          : {}),
        ...(n.end ? { end: true } : {}),
      };
    }),
    issues: describeIssues(d),
  };
}

/** Validation issues as plain sentences naming what they're about, e.g. `Error in node "x": …`. */
export function describeIssues(d: AgentDraft, issues: Issue[] = validate(d)): string[] {
  return issues.map((i) => {
    const severity = i.severity === 'error' ? 'Error' : 'Warning';
    const t = i.target;
    if (t.kind === 'node') return `${severity} in node "${d.nodes[t.id]?.name.trim() || UNNAMED}": ${i.message}`;
    if (t.kind === 'edge') {
      const e = d.edges[t.id];
      const fn = e?.function.trim() || UNNAMED;
      const from = e ? d.nodes[e.sourceId]?.name.trim() || UNNAMED : UNNAMED;
      return `${severity} in edge "${fn}" from "${from}": ${i.message}`;
    }
    return `${severity} in the agent settings: ${i.message}`;
  });
}
