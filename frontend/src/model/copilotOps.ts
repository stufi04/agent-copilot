import { nodesRemovedBy, removeNodes } from './graph';
import { importAgentData } from './import';
import type { AgentDraft, AgentEdge, AgentNode, EdgeProperty, Id, PropertyType } from './types';

// The copilot's graph-editing tools (defined for the model in backend/copilot/tools.json),
// as pure functions over the editor draft. Nodes are named by name and edges by
// (node they leave, function name), because that's what the model sees (describe.ts).
// A tool that can't do what it was asked changes nothing and says why, so the model
// can correct itself.

/** `hint` is for the model only: a nudge about what else the change may call for. */
export type ToolResult = { ok: true; summary: string; hint?: string } | { ok: false; error: string };

type Args = Record<string, unknown>;
type Tool = (d: AgentDraft, args: Args) => { draft: AgentDraft; summary: string; hint?: string };

/** Adding or removing an option out of a node: its task message may list the options. */
const optionsHint = (nodeName: string) =>
  `If the task message of "${nodeName}" lists or mentions the options the caller has, update it to match (update_node).`;

class ToolError extends Error {}
const fail = (message: string): never => {
  throw new ToolError(message);
};

const PROPERTY_TYPES: PropertyType[] = ['string', 'number', 'integer', 'boolean'];
const newId = (): Id => crypto.randomUUID();

// ---- reading arguments ----

function text(args: Args, key: string): string;
function text(args: Args, key: string, optional: true): string | undefined;
function text(args: Args, key: string, optional = false): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return optional ? undefined : fail(`"${key}" is required.`);
  if (typeof v !== 'string') return fail(`"${key}" must be a string.`);
  return v;
}

function name(args: Args, key: string): string;
function name(args: Args, key: string, optional: true): string | undefined;
function name(args: Args, key: string, optional = false): string | undefined {
  const v = optional ? text(args, key, true) : text(args, key);
  if (v !== undefined && !v.trim()) fail(`"${key}" can't be empty.`);
  return v?.trim();
}

function flag(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'boolean') fail(`"${key}" must be true or false.`);
  return v as boolean;
}

function fields(args: Args): EdgeProperty[] | undefined {
  const raw = args.fields;
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) return fail('"fields" must be a list.');
  return raw.map((f: unknown, i) => {
    if (typeof f !== 'object' || f === null) return fail(`Field ${i + 1} must be an object.`);
    const field = f as Args;
    const key = name(field, 'name');
    const type = field.type;
    if (!PROPERTY_TYPES.includes(type as PropertyType))
      fail(`Field "${key}": "type" must be one of ${PROPERTY_TYPES.join(', ')}.`);
    const values = field.enum ?? [];
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string'))
      fail(`Field "${key}": "enum" must be a list of strings.`);
    return {
      id: newId(),
      key,
      type: type as PropertyType,
      description: text(field, 'description', true) ?? '',
      required: flag(field, 'required') ?? true,
      enumText: type === 'string' ? (values as string[]).join(', ') : '',
    };
  });
}

// ---- finding things by name ----

const nodeNames = (d: AgentDraft) => Object.values(d.nodes).map((n) => n.name.trim());

function findNode(d: AgentDraft, nodeName: string): AgentNode {
  const nodes = Object.values(d.nodes);
  const matches = nodes.filter((n) => n.name.trim() === nodeName);
  if (matches.length > 1) fail(`Several nodes are named "${nodeName}"; rename one first.`);
  if (matches.length) return matches[0];
  // "greeting" for "Greeting": take it when the case is the only difference and only one node fits.
  const loose = nodes.filter((n) => n.name.trim().toLowerCase() === nodeName.toLowerCase());
  if (loose.length === 1) return loose[0];
  return fail(`There's no node named "${nodeName}". Nodes: ${nodeNames(d).join(', ')}.`);
}

function findEdge(d: AgentDraft, from: string, fn: string): AgentEdge {
  const source = findNode(d, from);
  const out = Object.values(d.edges).filter((e) => e.sourceId === source.id);
  const matches = out.filter((e) => e.function.trim() === fn);
  if (matches.length > 1) fail(`Node "${from}" has several edges called "${fn}".`);
  if (!matches.length) {
    const names = out.map((e) => e.function.trim() || '(unnamed)');
    fail(`Node "${from}" has no edge called "${fn}". ${names.length ? `Its edges: ${names.join(', ')}.` : 'It has no edges.'}`);
  }
  return matches[0];
}

function assertNodeNameFree(d: AgentDraft, nodeName: string) {
  if (nodeNames(d).includes(nodeName)) fail(`A node named "${nodeName}" already exists.`);
}

function assertFunctionFree(d: AgentDraft, sourceId: Id, fn: string, from: string) {
  if (Object.values(d.edges).some((e) => e.sourceId === sourceId && e.function.trim() === fn))
    fail(`Node "${from}" already has an edge called "${fn}".`);
}

/** Delete what `target` takes with it (see nodesRemovedBy), and say what went. */
function remove(d: AgentDraft, target: { kind: 'node' | 'edge'; id: Id }) {
  const gone = nodesRemovedBy(d, target);
  const { nodes, edges } = removeNodes(d, gone);
  if (target.kind === 'edge') delete edges[target.id];
  const names = [...gone].filter((id) => id !== target.id).map((id) => `"${d.nodes[id].name.trim()}"`);
  return { draft: { ...d, nodes, edges }, alsoRemoved: names.length ? ` It also removed ${names.join(', ')}, which nothing else led to.` : '' };
}

// ---- the tools ----

const tools: Record<string, Tool> = {
  add_node: (d, args) => {
    const nodeName = name(args, 'name');
    assertNodeNameFree(d, nodeName);
    const node: AgentNode = {
      id: newId(),
      name: nodeName,
      taskMessage: text(args, 'task_message'),
      roleMessage: text(args, 'role_message', true) ?? '',
      end: flag(args, 'end') ?? false,
    };
    return {
      draft: { ...d, nodes: { ...d.nodes, [node.id]: node } },
      summary: `Added node "${nodeName}".`,
    };
  },

  update_node: (d, args) => {
    const node = findNode(d, name(args, 'name'));
    const newName = name(args, 'new_name', true);
    if (newName !== undefined && newName !== node.name.trim()) assertNodeNameFree(d, newName);
    const next: AgentNode = {
      ...node,
      name: newName ?? node.name,
      taskMessage: text(args, 'task_message', true) ?? node.taskMessage,
      roleMessage: text(args, 'role_message', true) ?? node.roleMessage,
      end: flag(args, 'end') ?? node.end,
    };
    return {
      draft: { ...d, nodes: { ...d.nodes, [node.id]: next } },
      summary: newName && newName !== node.name.trim() ? `Renamed node "${node.name.trim()}" to "${newName}".` : `Updated node "${next.name.trim()}".`,
    };
  },

  delete_node: (d, args) => {
    const node = findNode(d, name(args, 'name'));
    if (node.id === d.initialNodeId) fail(`"${node.name.trim()}" is the start node and can't be deleted. Use set_start_node first.`);
    // Refuse to leave other steps with edges into nothing. That also stops a batch of deletes,
    // planned before any result is seen, from taking out a node another path still needs.
    const incoming = Object.values(d.edges).filter((e) => e.targetId === node.id && e.sourceId !== node.id);
    if (incoming.length) {
      const list = incoming.map((e) => `"${e.function.trim()}" from "${d.nodes[e.sourceId]?.name.trim()}"`).join(', ');
      fail(
        `"${node.name.trim()}" is still the target of edge ${list}. Retarget or delete ${incoming.length === 1 ? 'that edge' : 'those edges'} first (delete_edge also removes the nodes only that edge led to).`,
      );
    }
    const { draft, alsoRemoved } = remove(d, { kind: 'node', id: node.id });
    return { draft, summary: `Deleted node "${node.name.trim()}".${alsoRemoved}` };
  },

  add_edge: (d, args) => {
    const from = name(args, 'from');
    const source = findNode(d, from);
    const fn = name(args, 'function');
    assertFunctionFree(d, source.id, fn, from);
    const target = findNode(d, name(args, 'to'));
    const edge: AgentEdge = {
      id: newId(),
      sourceId: source.id,
      targetId: target.id,
      function: fn,
      description: text(args, 'description'),
      properties: fields(args) ?? [],
    };
    return {
      draft: { ...d, edges: { ...d.edges, [edge.id]: edge } },
      summary: `Added edge "${fn}" from "${from}" to "${target.name.trim()}".`,
      hint: optionsHint(source.name.trim()),
    };
  },

  update_edge: (d, args) => {
    const from = name(args, 'from');
    const edge = findEdge(d, from, name(args, 'function'));
    const newFn = name(args, 'new_function', true);
    if (newFn !== undefined && newFn !== edge.function.trim()) assertFunctionFree(d, edge.sourceId, newFn, from);
    const to = name(args, 'to', true);
    const next: AgentEdge = {
      ...edge,
      function: newFn ?? edge.function,
      description: text(args, 'description', true) ?? edge.description,
      targetId: to !== undefined ? findNode(d, to).id : edge.targetId,
      properties: fields(args) ?? edge.properties,
    };
    return {
      draft: { ...d, edges: { ...d.edges, [edge.id]: next } },
      summary: `Updated edge "${next.function.trim()}" from "${from}".`,
    };
  },

  delete_edge: (d, args) => {
    const from = name(args, 'from');
    const edge = findEdge(d, from, name(args, 'function'));
    const { draft, alsoRemoved } = remove(d, { kind: 'edge', id: edge.id });
    return {
      draft,
      summary: `Deleted edge "${edge.function.trim()}" from "${from}".${alsoRemoved}`,
      hint: optionsHint(d.nodes[edge.sourceId].name.trim()),
    };
  },

  set_start_node: (d, args) => {
    const node = findNode(d, name(args, 'name'));
    return { draft: { ...d, initialNodeId: node.id }, summary: `"${node.name.trim()}" is now the start node.` };
  },

  update_agent: (d, args) => {
    const agentName = name(args, 'name', true);
    const persona = text(args, 'persona', true);
    if (agentName === undefined && persona === undefined) fail('Give "name" and/or "persona".');
    return {
      draft: { ...d, name: agentName ?? d.name, persona: persona ?? d.persona },
      summary: [agentName !== undefined && `Renamed the agent to "${agentName}".`, persona !== undefined && 'Updated the persona.']
        .filter(Boolean)
        .join(' '),
    };
  },

  replace_agent: (d, args) => {
    const agent = args.agent;
    if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) return fail('"agent" must be a JSON object.');
    // Keep the voice and model unless the new agent sets them; ignore the issues list we showed it.
    const { issues: _issues, ...rest } = agent as Args;
    const result = importAgentData({ voice_id: d.voiceId, model: d.model, ...rest });
    if (!result.ok) return fail(`The agent wasn't replaced: ${result.errors.join(' ')}`);
    const warnings = result.warnings.length ? ` Notes: ${result.warnings.join(' ')}` : '';
    return {
      draft: result.draft,
      summary: `Replaced the agent with "${result.draft.name}" (${Object.keys(result.draft.nodes).length} nodes).${warnings}`,
    };
  },
};

/** Names of the tools implemented here; must cover backend/copilot/tools.json. */
export const TOOL_NAMES = Object.keys(tools);

/** Run one tool call. On failure the draft comes back unchanged, with the reason. */
export function applyTool(d: AgentDraft, toolName: string, args: unknown): { draft: AgentDraft; result: ToolResult } {
  const tool = tools[toolName];
  if (!tool) return { draft: d, result: { ok: false, error: `There's no tool called "${toolName}".` } };
  if (typeof args !== 'object' || args === null || Array.isArray(args))
    return { draft: d, result: { ok: false, error: 'The arguments must be a JSON object.' } };
  try {
    const { draft, summary, hint } = tool(d, args as Args);
    return { draft, result: hint ? { ok: true, summary, hint } : { ok: true, summary } };
  } catch (e) {
    if (e instanceof ToolError) return { draft: d, result: { ok: false, error: e.message } };
    throw e;
  }
}
