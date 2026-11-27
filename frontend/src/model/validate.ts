import { reachableNodes } from './graph';
import type { AgentDraft, Id } from './types';

export type IssueTarget = { kind: 'node'; id: Id } | { kind: 'edge'; id: Id } | { kind: 'agent' };

export interface Issue {
  target: IssueTarget;
  /** Form field the issue belongs to, for inline display. */
  field: string;
  message: string;
  /** Errors block export; warnings are advisory. */
  severity: 'error' | 'warning';
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Checks the draft against what backend AgentBuilder + Pipecat Flows will accept. */
export function validate(d: AgentDraft): Issue[] {
  const issues: Issue[] = [];
  const err = (target: IssueTarget, field: string, message: string) =>
    issues.push({ target, field, message, severity: 'error' });
  const warn = (target: IssueTarget, field: string, message: string) =>
    issues.push({ target, field, message, severity: 'warning' });

  if (!d.name.trim()) err({ kind: 'agent' }, 'name', 'Agent name is required.');
  if (!d.model.trim()) err({ kind: 'agent' }, 'model', 'Model is required.');
  if (!d.voiceId.trim()) err({ kind: 'agent' }, 'voiceId', 'Voice ID is required.');

  const nodes = Object.values(d.nodes);
  const edges = Object.values(d.edges);

  const reachable = reachableNodes(d);
  const canFinish = nodesThatCanFinish(d);

  const nameCounts = new Map<string, number>();
  for (const n of nodes) nameCounts.set(n.name.trim(), (nameCounts.get(n.name.trim()) ?? 0) + 1);

  for (const n of nodes) {
    const t: IssueTarget = { kind: 'node', id: n.id };
    const name = n.name.trim();
    if (!name) err(t, 'name', 'Name is required.');
    else if ((nameCounts.get(name) ?? 0) > 1) err(t, 'name', `Another node is also named "${name}".`);
    if (!n.taskMessage.trim()) err(t, 'taskMessage', 'Task message is required.');

    const outgoing = edges.filter((e) => e.sourceId === n.id);
    if (n.end && outgoing.length)
      warn(t, 'end', 'Ends the call, but has outgoing edges. They will never be taken.');
    // The agent is a tree, so every branch finishes at a leaf, and every leaf must end
    // the call. Otherwise the conversation reaches it and has nowhere to go.
    if (!n.end && !outgoing.length)
      err(t, 'end', 'Every branch must end the call: tick "Ends the call", or add an edge to carry on.');
    else if (!canFinish.has(n.id))
      err(t, 'end', 'This part of the conversation loops forever: no path from here ends the call.');
    if (!reachable.has(n.id)) err(t, 'reachable', 'Not connected to the start node.');
  }

  for (const e of edges) {
    const t: IssueTarget = { kind: 'edge', id: e.id };
    const fn = e.function.trim();
    if (!fn) err(t, 'function', 'Function name is required.');
    else if (!IDENTIFIER.test(fn))
      err(t, 'function', 'Use letters, digits and underscores only, not starting with a digit.');
    else if (edges.some((o) => o.id !== e.id && o.sourceId === e.sourceId && o.function.trim() === fn))
      err(t, 'function', `Another edge from this node is also called "${fn}".`);
    if (!e.description.trim()) err(t, 'description', 'Description is required: it tells the LLM when to take this edge.');
    if (!e.targetId) err(t, 'target', 'No target node yet. Hover the edge and click [+] to add one.');

    const keys = new Map<string, number>();
    for (const p of e.properties) keys.set(p.key.trim(), (keys.get(p.key.trim()) ?? 0) + 1);
    e.properties.forEach((p, i) => {
      const field = `property:${p.id}`;
      const key = p.key.trim();
      if (!key) err(t, field, `Field ${i + 1}: name is required.`);
      else if (!IDENTIFIER.test(key)) err(t, field, `Field "${key}": use letters, digits and underscores only.`);
      else if ((keys.get(key) ?? 0) > 1) err(t, field, `Field "${key}" is defined more than once.`);
    });
  }

  return issues;
}

/**
 * Nodes with some path to the end of the call: a node marked "Ends the call", or an
 * unfinished part (a leaf or a dangling edge, which have errors of their own).
 * Anything else is stuck in a loop.
 */
function nodesThatCanFinish(d: AgentDraft): Set<Id> {
  const edges = Object.values(d.edges);
  const done = new Set<Id>();
  const queue: Id[] = [];
  for (const n of Object.values(d.nodes)) {
    const out = edges.filter((e) => e.sourceId === n.id);
    if (n.end || !out.length || out.some((e) => !e.targetId)) {
      done.add(n.id);
      queue.push(n.id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const e of edges) {
      if (e.targetId === id && !done.has(e.sourceId)) {
        done.add(e.sourceId);
        queue.push(e.sourceId);
      }
    }
  }
  return done;
}

/** Ids of nodes/edges with at least one blocking error, for highlighting on the graph. */
export function erroredIds(issues: Issue[]): Set<Id> {
  const ids = new Set<Id>();
  for (const i of issues) if (i.severity === 'error' && i.target.kind !== 'agent') ids.add(i.target.id);
  return ids;
}

/** Issues attached to one form field. */
export function issuesFor(issues: Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field);
}
