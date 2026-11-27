import type { AgentDraft, Id } from './types';

// Graph queries over the draft. Since edges can be dragged onto any node, the agent
// is a general directed graph: a node can have several incoming edges, there can be
// loops (e.g. "go back to collect_details"), and parts can be disconnected from the
// start node. These helpers are shared by the store, validation and layout.

function outgoing(d: AgentDraft, nodeId: Id) {
  return Object.values(d.edges).filter((e) => e.sourceId === nodeId);
}

/** Nodes reachable from `from` by following edges (includes `from`), optionally never entering `avoid`. */
export function reachableFrom(d: AgentDraft, from: Id, avoid?: Id): Set<Id> {
  const seen = new Set<Id>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || id === avoid || !d.nodes[id]) continue;
    seen.add(id);
    for (const e of outgoing(d, id)) if (e.targetId) queue.push(e.targetId);
  }
  return seen;
}

/** Nodes reachable from the start node. Everything else is disconnected. */
export function reachableNodes(d: AgentDraft): Set<Id> {
  return reachableFrom(d, d.initialNodeId);
}

export interface SpanningTree {
  /** For each node except roots: the edge it hangs under in the layout. */
  parentEdge: Map<Id, Id>;
  /** Layout roots: the start node first, then one per disconnected part. */
  roots: Id[];
}

/**
 * Picks one incoming edge per node, breadth-first from the start node and in
 * creation order, so the graph can be drawn as a tree. Edges not picked are loops
 * or cross-links. Disconnected parts get their own roots, earliest-created first,
 * which for a subtree cut off by repointing an edge is its old top node.
 */
export function spanningTree(d: AgentDraft): SpanningTree {
  const parentEdge = new Map<Id, Id>();
  const visited = new Set<Id>();
  const roots: Id[] = [];

  const walk = (root: Id) => {
    roots.push(root);
    visited.add(root);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of outgoing(d, id)) {
        if (!e.targetId || visited.has(e.targetId) || !d.nodes[e.targetId]) continue;
        visited.add(e.targetId);
        parentEdge.set(e.targetId, e.id);
        queue.push(e.targetId);
      }
    }
  };

  if (d.nodes[d.initialNodeId]) walk(d.initialNodeId);
  for (const id of Object.keys(d.nodes)) if (!visited.has(id)) walk(id);
  return { parentEdge, roots };
}

/**
 * The nodes that go when a node or edge is deleted: the node itself, plus anything
 * below that nothing else connects to the start node. Shared nodes and loops back
 * up the graph survive. The start node never goes.
 */
export function nodesRemovedBy(d: AgentDraft, target: { kind: 'node' | 'edge'; id: Id }): Set<Id> {
  let below: Set<Id>;
  let stillReachable: Set<Id>;
  if (target.kind === 'node') {
    below = reachableFrom(d, target.id);
    stillReachable = reachableFrom(d, d.initialNodeId, target.id);
  } else {
    const edge = d.edges[target.id];
    if (!edge?.targetId) return new Set();
    below = reachableFrom(d, edge.targetId);
    const without: AgentDraft = { ...d, edges: { ...d.edges } };
    delete without.edges[target.id];
    stillReachable = reachableFrom(without, d.initialNodeId);
  }
  const removed = new Set([...below].filter((id) => !stillReachable.has(id)));
  if (target.kind === 'node') removed.add(target.id);
  removed.delete(d.initialNodeId);
  return removed;
}

/**
 * A node's subtree as drawn: the node, the edges it hangs out of it, and everything
 * under those edges in the spanning tree. Loops and cross-links aren't followed.
 * This is what travels with a node when it's dragged.
 */
export function treeSubtree(d: AgentDraft, rootId: Id, tree = spanningTree(d)): { nodes: Set<Id>; edges: Set<Id> } {
  const nodes = new Set<Id>();
  const edges = new Set<Id>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (nodes.has(id)) continue;
    nodes.add(id);
    for (const e of outgoing(d, id)) {
      edges.add(e.id);
      if (e.targetId && tree.parentEdge.get(e.targetId) === e.id) stack.push(e.targetId);
    }
  }
  return { nodes, edges };
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** Can `nodeId` (with its subtree) be moved under `newParentId`? */
export function canMoveNode(d: AgentDraft, nodeId: Id, newParentId: Id): MoveCheck {
  if (!d.nodes[nodeId] || !d.nodes[newParentId]) return { ok: false, reason: 'Unknown node.' };
  if (nodeId === d.initialNodeId) return { ok: false, reason: "The start node can't be moved." };
  if (nodeId === newParentId) return { ok: false, reason: "A node can't be moved under itself." };
  if (treeSubtree(d, nodeId).nodes.has(newParentId))
    return { ok: false, reason: "A node can't be moved under its own subtree." };
  return { ok: true };
}
