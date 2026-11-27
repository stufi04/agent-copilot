import type { AgentDraft, AgentEdge, EdgeProperty, Id } from './types';

// Converts the editor draft into the exact JSON shape backend/agent_builder/schema.py
// reads (see backend/example_flow.json). Run validate() first: this assumes a valid draft.

interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
}

function exportProperty(p: EdgeProperty): JsonSchemaProperty {
  const out: JsonSchemaProperty = { type: p.type };
  if (p.description.trim()) out.description = p.description.trim();
  if (p.type === 'string') {
    const values = p.enumText.split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length) out.enum = values;
  }
  return out;
}

function exportEdge(e: AgentEdge, nameOf: (id: Id) => string) {
  return {
    function: e.function.trim(),
    description: e.description.trim(),
    target: nameOf(e.targetId!),
    properties: Object.fromEntries(e.properties.map((p) => [p.key.trim(), exportProperty(p)])),
    required: e.properties.filter((p) => p.required).map((p) => p.key.trim()),
  };
}

export function exportAgent(d: AgentDraft) {
  const nameOf = (id: Id) => d.nodes[id].name.trim();
  const edges = Object.values(d.edges);

  // Breadth-first from the initial node so the file reads in conversation order.
  const order: Id[] = [];
  const queue: Id[] = [d.initialNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (order.includes(id) || !d.nodes[id]) continue;
    order.push(id);
    for (const e of edges) if (e.sourceId === id && e.targetId) queue.push(e.targetId);
  }

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
        name: n.name.trim(),
        ...(n.roleMessage.trim() ? { role_message: n.roleMessage.trim() } : {}),
        task_messages: [{ role: 'developer', content: n.taskMessage.trim() }],
        ...(out.length ? { edges: out.map((e) => exportEdge(e, nameOf)) } : {}),
        ...(n.end ? { end: true } : {}),
      };
    }),
  };
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
