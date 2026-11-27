import type { AgentDraft, AgentEdge, AgentNode, EdgeProperty, Id, PropertyType } from './types';

// Reads an agent JSON in the backend format (backend/agent_builder/schema.py, as
// written by export.ts) back into an editor draft. It checks what the backend's
// AgentBuilder checks, plus what this editor can't represent:
//
// - Errors reject the file and leave the current agent untouched.
// - Warnings describe anything dropped or changed on the way in, so a later export
//   won't silently differ from the file.
//
// Loops and nodes reached by several edges are fine. Every node must be reachable
// from the start node, as in the editor.

export type ImportResult =
  | { ok: true; draft: AgentDraft; warnings: string[] }
  | { ok: false; errors: string[] };

// Mirrors the defaults in backend/agent_builder/schema.py.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL = 'gpt-4o';
const PROPERTY_TYPES: PropertyType[] = ['string', 'number', 'integer', 'boolean'];

const AGENT_KEYS = ['name', 'voice_id', 'model', 'persona', 'initial_node', 'nodes'];
const NODE_KEYS = ['name', 'role_message', 'task_messages', 'edges', 'end', 'pre_actions', 'post_actions'];
const EDGE_KEYS = ['function', 'description', 'target', 'properties', 'required'];

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const newId = (): Id => crypto.randomUUID();

export function importAgent(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  return importAgentData(data);
}

export function importAgentData(data: unknown): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(data)) return { ok: false, errors: ['The file must contain a JSON object describing one agent.'] };

  const unknownKeys = (obj: Json, allowed: string[], where: string) => {
    const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
    if (extra.length) warnings.push(`${where}: ignored unknown key${extra.length > 1 ? 's' : ''} ${extra.map((k) => `"${k}"`).join(', ')}.`);
  };
  const optionalString = (obj: Json, key: string, where: string, fallback: string): string => {
    if (obj[key] === undefined) return fallback;
    if (isString(obj[key])) return obj[key];
    errors.push(`${where}: "${key}" must be a string.`);
    return fallback;
  };

  // ---- agent ----
  unknownKeys(data, AGENT_KEYS, 'Agent');
  if (!isString(data.name)) errors.push('Agent: "name" is required and must be a string.');
  if (!isString(data.initial_node)) errors.push('Agent: "initial_node" is required and must be a string.');
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) errors.push('Agent: "nodes" must be a non-empty list.');
  const persona = optionalString(data, 'persona', 'Agent', '');
  const voiceId = optionalString(data, 'voice_id', 'Agent', DEFAULT_VOICE_ID);
  const model = optionalString(data, 'model', 'Agent', DEFAULT_MODEL);
  if (errors.length) return { ok: false, errors };

  // ---- nodes (first pass: names, so edges can resolve targets) ----
  const rawNodes = data.nodes as unknown[];
  const nodeIdByName = new Map<string, Id>();
  rawNodes.forEach((raw, i) => {
    if (!isObject(raw) || !isString(raw.name) || !raw.name.trim()) {
      errors.push(`Node ${i + 1}: must be an object with a non-empty "name".`);
      return;
    }
    if (nodeIdByName.has(raw.name)) errors.push(`Node "${raw.name}" is defined more than once.`);
    else nodeIdByName.set(raw.name, newId());
  });
  if (errors.length) return { ok: false, errors };

  const initialName = data.initial_node as string;
  if (!nodeIdByName.has(initialName)) return { ok: false, errors: [`Agent: initial_node "${initialName}" is not one of the nodes.`] };

  // ---- nodes and edges ----
  const nodes: Record<Id, AgentNode> = {};
  const edges: Record<Id, AgentEdge> = {};

  for (const raw of rawNodes as Json[]) {
    const name = raw.name as string;
    const where = `Node "${name}"`;
    const id = nodeIdByName.get(name)!;
    unknownKeys(raw, NODE_KEYS, where);

    // task_messages -> one task message.
    let taskMessage = '';
    if (raw.task_messages !== undefined) {
      if (!Array.isArray(raw.task_messages) || !raw.task_messages.every((m) => isObject(m) && isString(m.content))) {
        errors.push(`${where}: "task_messages" must be a list of { "role", "content" } objects.`);
      } else {
        const messages = raw.task_messages as Json[];
        taskMessage = messages.map((m) => m.content as string).join('\n\n');
        if (messages.length > 1) warnings.push(`${where}: its ${messages.length} task messages were joined into one.`);
        if (messages.some((m) => m.role !== 'developer'))
          warnings.push(`${where}: task message roles other than "developer" will be exported as "developer".`);
      }
    }

    for (const key of ['pre_actions', 'post_actions'] as const) {
      if (Array.isArray(raw[key]) && raw[key].length)
        warnings.push(`${where}: "${key}" isn't supported by the editor yet and was dropped.`);
    }
    if (raw.end !== undefined && typeof raw.end !== 'boolean') errors.push(`${where}: "end" must be true or false.`);

    nodes[id] = {
      id,
      name,
      taskMessage,
      roleMessage: optionalString(raw, 'role_message', where, ''),
      end: raw.end === true,
    };

    if (raw.edges === undefined) continue;
    if (!Array.isArray(raw.edges)) {
      errors.push(`${where}: "edges" must be a list.`);
      continue;
    }
    raw.edges.forEach((rawEdge: unknown, i: number) => {
      const edge = importEdge(rawEdge, `${where}, edge ${i + 1}`, id, nodeIdByName, errors, warnings, unknownKeys);
      if (edge) edges[edge.id] = edge;
    });
  }
  if (errors.length) return { ok: false, errors };

  const draft: AgentDraft = {
    name: data.name as string,
    persona,
    voiceId,
    model,
    initialNodeId: nodeIdByName.get(initialName)!,
    nodes,
    edges,
  };

  const cut = disconnected(draft);
  if (cut.length) return { ok: false, errors: [`Not connected to the start node: ${cut.join(', ')}.`] };
  return { ok: true, draft, warnings };
}

function importEdge(
  raw: unknown,
  where: string,
  sourceId: Id,
  nodeIdByName: Map<string, Id>,
  errors: string[],
  warnings: string[],
  unknownKeys: (obj: Json, allowed: string[], where: string) => void,
): AgentEdge | null {
  if (!isObject(raw)) {
    errors.push(`${where}: must be an object.`);
    return null;
  }
  if (isString(raw.function)) where = where.replace(/edge \d+$/, `edge "${raw.function}"`);
  unknownKeys(raw, EDGE_KEYS, where);
  const errorsBefore = errors.length;
  const failed = () => errors.length > errorsBefore;

  for (const key of ['function', 'description', 'target'] as const) {
    if (!isString(raw[key])) errors.push(`${where}: "${key}" is required and must be a string.`);
  }
  if (failed()) return null;
  const targetId = nodeIdByName.get(raw.target as string);
  if (!targetId) {
    errors.push(`${where}: targets unknown node "${raw.target}".`);
    return null;
  }

  const rawProps = raw.properties ?? {};
  const required = raw.required ?? [];
  if (!isObject(rawProps)) errors.push(`${where}: "properties" must be an object.`);
  if (!Array.isArray(required) || !required.every(isString)) errors.push(`${where}: "required" must be a list of strings.`);
  if (failed()) return null;

  const props = rawProps as Json;
  const requiredKeys = required as string[];
  const missing = requiredKeys.filter((k) => !(k in props));
  if (missing.length) warnings.push(`${where}: required field${missing.length > 1 ? 's' : ''} ${missing.map((k) => `"${k}"`).join(', ')} not in "properties" and ignored.`);

  const properties: EdgeProperty[] = [];
  for (const [key, spec] of Object.entries(props)) {
    if (!isObject(spec) || !PROPERTY_TYPES.includes(spec.type as PropertyType)) {
      errors.push(`${where}: field "${key}" must have "type" ${PROPERTY_TYPES.map((t) => `"${t}"`).join(', ')}.`);
      continue;
    }
    const type = spec.type as PropertyType;
    let enumText = '';
    if (spec.enum !== undefined) {
      if (type !== 'string') warnings.push(`${where}: field "${key}": allowed values are only supported for strings and were dropped.`);
      else if (!Array.isArray(spec.enum) || !spec.enum.every(isString))
        errors.push(`${where}: field "${key}": "enum" must be a list of strings.`);
      else enumText = spec.enum.join(', ');
    }
    const extra = Object.keys(spec).filter((k) => !['type', 'description', 'enum'].includes(k));
    if (extra.length) warnings.push(`${where}: field "${key}": ignored ${extra.map((k) => `"${k}"`).join(', ')}.`);
    properties.push({
      id: newId(),
      key,
      type,
      description: isString(spec.description) ? spec.description : '',
      required: requiredKeys.includes(key),
      enumText,
    });
  }

  return {
    id: newId(),
    sourceId,
    targetId,
    function: raw.function as string,
    description: raw.description as string,
    properties,
  };
}

/** Names (quoted) of nodes not reachable from the start node. */
function disconnected(d: AgentDraft): string[] {
  const reachable = new Set<Id>();
  const queue = [d.initialNodeId];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const e of Object.values(d.edges)) if (e.sourceId === id) queue.push(e.targetId!);
  }
  return Object.keys(d.nodes)
    .filter((id) => !reachable.has(id))
    .map((id) => `"${d.nodes[id].name}"`);
}
