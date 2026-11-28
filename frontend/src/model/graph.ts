import type { AgentDraft, AgentEdge, Id } from './types';

// Graph queries over the draft, shared by the store, validation and the layout.
//
// The agent is a directed graph that always alternates node -> edge -> node. Dragging
// moves a node or an edge together with everything hanging below it in the tree, so
// it can't cut anything off from the start node. Loops and shared nodes are made on
// purpose, by dragging from a [+] to an existing node; they're drawn as extra links
// on top of a spanning tree (see spanningTree).

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
 * creation order. For a tree that's simply every edge; for a malformed draft it
 * skips loops and extra links, and gives disconnected parts their own roots.
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

/** Remove the given nodes, their outgoing edges, and detach edges pointing at them. */
export function removeNodes(draft: AgentDraft, ids: Set<Id>): Pick<AgentDraft, 'nodes' | 'edges'> {
  const nodes = Object.fromEntries(Object.entries(draft.nodes).filter(([id]) => !ids.has(id)));
  const edges: Record<Id, AgentEdge> = {};
  for (const [id, e] of Object.entries(draft.edges)) {
    if (ids.has(e.sourceId)) continue;
    edges[id] = e.targetId && ids.has(e.targetId) ? { ...e, targetId: null } : e;
  }
  return { nodes, edges };
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

/** Breadth-first depth of every node along the spanning tree (roots are 0). */
export function depths(d: AgentDraft, tree = spanningTree(d)): Map<Id, number> {
  const depth = new Map<Id, number>();
  for (const root of tree.roots) {
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of outgoing(d, id)) {
        if (e.targetId && tree.parentEdge.get(e.targetId) === e.id && !depth.has(e.targetId)) {
          depth.set(e.targetId, depth.get(id)! + 1);
          queue.push(e.targetId);
        }
      }
    }
  }
  return depth;
}

/**
 * What travels with a dragged edge: the edge itself and, if it's the edge its target
 * hangs from in the tree, the target's whole subtree. A link (loop or shared node)
 * moves alone.
 */
export function edgeSubtree(d: AgentDraft, edgeId: Id, tree = spanningTree(d)): { nodes: Set<Id>; edges: Set<Id> } {
  const edge = d.edges[edgeId];
  const nodes = new Set<Id>();
  const edges = new Set<Id>([edgeId]);
  if (edge?.targetId && tree.parentEdge.get(edge.targetId) === edgeId) {
    const below = treeSubtree(d, edge.targetId, tree);
    below.nodes.forEach((n) => nodes.add(n));
    below.edges.forEach((e) => edges.add(e));
  }
  return { nodes, edges };
}

/** Can node `nodeId` (with its subtree) be attached to the end of edge `edgeId`? */
export function canAttachNode(d: AgentDraft, nodeId: Id, edgeId: Id): MoveCheck {
  const edge = d.edges[edgeId];
  if (!d.nodes[nodeId] || !edge) return { ok: false, reason: 'Unknown node or edge.' };
  if (nodeId === d.initialNodeId) return { ok: false, reason: "The start node can't be moved." };
  if (edge.targetId === nodeId) return { ok: false, reason: 'The node is already attached to this edge.' };
  if (edge.targetId) return { ok: false, reason: 'This edge already leads to a node. Only an empty edge can take one.' };
  if (treeSubtree(d, nodeId).edges.has(edgeId)) return { ok: false, reason: "A node can't be attached below itself." };
  return { ok: true };
}

/** Can node `nodeId` (with its subtree) be hung under node `parentId`, through a new edge? */
export function canAttachNodeToNode(d: AgentDraft, nodeId: Id, parentId: Id): MoveCheck {
  if (!d.nodes[nodeId] || !d.nodes[parentId]) return { ok: false, reason: 'Unknown node.' };
  if (nodeId === d.initialNodeId) return { ok: false, reason: "The start node can't be moved." };
  const tree = spanningTree(d);
  const parentEdge = tree.parentEdge.get(nodeId);
  if (parentEdge && d.edges[parentEdge].sourceId === parentId)
    return { ok: false, reason: 'The node already hangs under this node.' };
  if (treeSubtree(d, nodeId, tree).nodes.has(parentId)) return { ok: false, reason: "A node can't be moved below itself." };
  return { ok: true };
}

/** Can edge `edgeId` (with what hangs below it) be moved to come out of `nodeId`? */
export function canMoveEdge(d: AgentDraft, edgeId: Id, nodeId: Id): MoveCheck {
  const edge = d.edges[edgeId];
  if (!edge || !d.nodes[nodeId]) return { ok: false, reason: 'Unknown node or edge.' };
  if (edge.sourceId === nodeId) return { ok: false, reason: 'The edge already comes out of this node.' };
  if (edgeSubtree(d, edgeId).nodes.has(nodeId)) return { ok: false, reason: "An edge can't be moved below its own target." };
  return { ok: true };
}
