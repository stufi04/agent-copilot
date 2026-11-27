import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { AgentDraft, Id, Selection } from '../model/types';

// Projects the domain model onto React Flow and lays it out as a top-down tree.
//
// Agent edges are drawn as their own React Flow *nodes* (a pill with the function
// name), not as React Flow edges: they must be clickable and hoverable and carry
// a [+], including while dangling (no target yet), which a React Flow edge can't
// represent. The lines on screen are plain connectors: source -> pill -> target.

export const NODE_W = 200;
export const NODE_H = 64;
export const PILL_W = 170;
export const PILL_H = 34;

export type AgentNodeData = {
  name: string;
  isStart: boolean;
  isEnd: boolean;
  selected: boolean;
  hasError: boolean;
};
export type EdgePillData = {
  label: string;
  dangling: boolean;
  selected: boolean;
  hasError: boolean;
};
export type AgentFlowNode = Node<AgentNodeData, 'agentNode'>;
export type EdgePillNode = Node<EdgePillData, 'edgePill'>;
export type FlowNode = AgentFlowNode | EdgePillNode;

export function toFlow(
  draft: AgentDraft,
  selection: Selection,
  errored: Set<Id>,
): { nodes: FlowNode[]; edges: Edge[] } {
  const isSelected = (kind: 'node' | 'edge', id: Id) =>
    selection?.kind === kind && selection.id === id;

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const n of Object.values(draft.nodes)) {
    nodes.push({
      id: n.id,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      width: NODE_W,
      height: NODE_H,
      data: {
        name: n.name.trim() || 'Untitled node',
        isStart: n.id === draft.initialNodeId,
        isEnd: n.end,
        selected: isSelected('node', n.id),
        hasError: errored.has(n.id),
      },
    });
  }

  for (const e of Object.values(draft.edges)) {
    nodes.push({
      id: e.id,
      type: 'edgePill',
      position: { x: 0, y: 0 },
      width: PILL_W,
      height: PILL_H,
      data: {
        label: e.function.trim() || 'unnamed_edge',
        dangling: !e.targetId,
        selected: isSelected('edge', e.id),
        hasError: errored.has(e.id),
      },
    });
    edges.push({ id: `${e.sourceId}->${e.id}`, source: e.sourceId, target: e.id });
    if (e.targetId) {
      edges.push({
        id: `${e.id}->${e.targetId}`,
        source: e.id,
        target: e.targetId,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      });
    }
  }

  return { nodes: layoutTree(draft, nodes), edges };
}

const H_GAP = 36; // horizontal gap between sibling subtrees
const V_GAP = 44; // vertical gap between a node and its edge pills (and pill -> target)

/**
 * Tidy tree layout. The editor only ever creates nodes from an edge's [+], so the
 * graph is a tree rooted at the initial node: each node's edges fan out beneath it
 * in creation order with equal gaps, and each parent is centred over its children.
 */
function layoutTree(draft: AgentDraft, nodes: FlowNode[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = Object.values(draft.edges);

  // Each node is placed once, under the first edge that reaches it (breadth-first from the
  // start, then from anything left over). A saved agent may contain loops or shared nodes
  // (e.g. one made on another branch); without this the layout would recurse forever.
  const parentEdge = new Map<Id, Id>();
  const seen = new Set<Id>();
  for (const root of [draft.initialNodeId, ...Object.keys(draft.nodes)]) {
    if (seen.has(root) || !byId.has(root)) continue;
    seen.add(root);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges) {
        if (e.sourceId !== id || !e.targetId || seen.has(e.targetId) || !byId.has(e.targetId)) continue;
        seen.add(e.targetId);
        parentEdge.set(e.targetId, e.id);
        queue.push(e.targetId);
      }
    }
  }

  const children = (id: Id): Id[] => {
    const edge = draft.edges[id];
    if (edge) return edge.targetId && parentEdge.get(edge.targetId) === id ? [edge.targetId] : [];
    return edges.filter((e) => e.sourceId === id).map((e) => e.id);
  };

  const widths = new Map<Id, number>();
  const subtreeWidth = (id: Id): number => {
    const kids = children(id);
    const kidsW = kids.reduce((sum, k) => sum + subtreeWidth(k), 0) + H_GAP * Math.max(0, kids.length - 1);
    const w = Math.max(byId.get(id)!.width!, kidsW);
    widths.set(id, w);
    return w;
  };

  const positions = new Map<Id, { x: number; y: number }>();
  const place = (id: Id, left: number, y: number) => {
    const self = byId.get(id)!;
    const w = widths.get(id)!;
    positions.set(id, { x: left + (w - self.width!) / 2, y });
    const kids = children(id);
    const kidsW = kids.reduce((sum, k) => sum + widths.get(k)!, 0) + H_GAP * Math.max(0, kids.length - 1);
    let x = left + (w - kidsW) / 2;
    for (const k of kids) {
      place(k, x, y + self.height! + V_GAP);
      x += widths.get(k)! + H_GAP;
    }
  };

  // The initial node is the root. Anything unreachable gets laid out to its right.
  let left = 0;
  for (const root of [draft.initialNodeId, ...Object.keys(draft.nodes)]) {
    if (positions.has(root) || !byId.has(root)) continue;
    const w = subtreeWidth(root);
    place(root, left, 0);
    left += w + H_GAP * 2;
  }
  return nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } }));
}
