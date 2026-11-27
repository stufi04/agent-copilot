import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { reachableNodes, spanningTree, type SpanningTree } from '../model/graph';
import type { AgentDraft, Id, Selection } from '../model/types';

// Projects the domain model onto React Flow and lays it out top-down.
//
// Agent edges are drawn as their own React Flow *nodes* (a pill with the function
// name), not as React Flow edges: they must be clickable, hoverable and draggable
// and carry a [+], including while dangling (no target yet), which a React Flow
// edge can't represent. The lines on screen are plain connectors: source -> pill -> target.
//
// The agent graph can have loops, shared nodes and disconnected parts, so it's laid
// out along a spanning tree (model/graph.ts): each node sits under one incoming edge,
// and any other edge into it is drawn as a dashed "link" connector instead.

export const NODE_W = 200;
export const NODE_H = 64;
export const PILL_W = 170;
export const PILL_H = 34;

/** Drop feedback while something is dragged over this node. */
export type DropState = 'valid' | 'invalid' | null;

export type AgentNodeData = {
  name: string;
  isStart: boolean;
  isEnd: boolean;
  selected: boolean;
  hasError: boolean;
  /** Not connected to the start node. */
  unreachable: boolean;
  drop: DropState;
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
  drop: { nodeId: Id; state: Exclude<DropState, null> } | null = null,
): { nodes: FlowNode[]; edges: Edge[] } {
  const isSelected = (kind: 'node' | 'edge', id: Id) =>
    selection?.kind === kind && selection.id === id;
  const tree = spanningTree(draft);
  const reachable = reachableNodes(draft);

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];

  for (const n of Object.values(draft.nodes)) {
    nodes.push({
      id: n.id,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      width: NODE_W,
      height: NODE_H,
      // The start node is the root of everything, so it can't be dragged anywhere.
      draggable: n.id !== draft.initialNodeId,
      data: {
        name: n.name.trim() || 'Untitled node',
        isStart: n.id === draft.initialNodeId,
        isEnd: n.end,
        selected: isSelected('node', n.id),
        hasError: errored.has(n.id),
        unreachable: !reachable.has(n.id),
        drop: drop?.nodeId === n.id ? drop.state : null,
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
      const isTreeLink = tree.parentEdge.get(e.targetId) === e.id;
      edges.push({
        id: `${e.id}->${e.targetId}`,
        source: e.id,
        target: e.targetId,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        // Loops and links to nodes drawn elsewhere: a dashed line between the right-hand
        // sides, stepping out to the right so it goes around the tree rather than behind it.
        ...(isTreeLink
          ? {}
          : {
              type: 'smoothstep',
              pathOptions: { offset: 36, borderRadius: 12 },
              sourceHandle: 'link',
              targetHandle: 'link',
              className: 'link-edge',
              style: { strokeDasharray: '6 4', strokeWidth: 1.5 },
            }),
      });
    }
  }

  return { nodes: layoutTree(draft, tree, nodes), edges };
}

const H_GAP = 36; // horizontal gap between sibling subtrees
const V_GAP = 44; // vertical gap between a node and its edge pills (and pill -> target)

/**
 * Tidy tree layout along the spanning tree: each node's edges fan out beneath it
 * in creation order with equal gaps, and each parent is centred over its children.
 * The start node's tree comes first; disconnected parts are laid out to its right.
 */
function layoutTree(draft: AgentDraft, tree: SpanningTree, nodes: FlowNode[]): FlowNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = Object.values(draft.edges);

  const children = (id: Id): Id[] => {
    const edge = draft.edges[id];
    if (edge) return edge.targetId && tree.parentEdge.get(edge.targetId) === id ? [edge.targetId] : [];
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

  let left = 0;
  for (const root of tree.roots) {
    const w = subtreeWidth(root);
    place(root, left, 0);
    left += w + H_GAP * 3;
  }
  return nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? { x: 0, y: 0 } }));
}
