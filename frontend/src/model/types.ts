// The editor's in-memory model. It mirrors backend/agent_builder/schema.py
// (AgentConfig / Node / Edge), with one difference: entities have stable internal
// ids, so renaming a node never breaks the edges that point at it. Ids are mapped
// back to names on export (see export.ts).

export type Id = string;

export type PropertyType = 'string' | 'number' | 'integer' | 'boolean';

/** One field the LLM collects when taking an edge (a JSON-schema property). */
export interface EdgeProperty {
  id: Id;
  key: string;
  type: PropertyType;
  description: string;
  required: boolean;
  /** Comma-separated allowed values (string type only). Kept raw so typing commas works. */
  enumText: string;
}

export interface AgentNode {
  id: Id;
  name: string;
  /** Exported as task_messages: [{ role: "developer", content }]. */
  taskMessage: string;
  /** Optional override of the agent-wide persona. */
  roleMessage: string;
  /** Terminal node: ends the call after it speaks. */
  end: boolean;
}

export interface AgentEdge {
  id: Id;
  sourceId: Id;
  /** null = dangling: created with [+] under a node, no target node yet. */
  targetId: Id | null;
  function: string;
  description: string;
  properties: EdgeProperty[];
}

export interface AgentDraft {
  name: string;
  persona: string;
  voiceId: string;
  model: string;
  initialNodeId: Id;
  nodes: Record<Id, AgentNode>;
  /** Insertion order is preserved, which keeps sibling edges in creation order. */
  edges: Record<Id, AgentEdge>;
}

export type Selection =
  | { kind: 'node'; id: Id }
  | { kind: 'edge'; id: Id }
  | { kind: 'agent' }
  | null;
