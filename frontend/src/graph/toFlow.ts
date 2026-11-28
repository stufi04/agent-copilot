import { MarkerType, type Edge, type Node } from '@xyflow/react';
import { depths, spanningTree, type SpanningTree } from '../model/graph';
import type { AgentDraft, Id, Selection } from '../model/types';

// Projects the domain model onto React Flow and lays it out top-down.
//
// Agent edges are drawn as their own React Flow *nodes* (a pill with the function
// name), not as React Flow edges: they must be clickable, hoverable and draggable
// and carry a [+], including while dangling (no target yet), which a React Flow
// edge can't represent. The lines on screen are plain connectors: source -> pill -> target.
//
// The agent can have loops and nodes reached by several edges, so it's laid out along
// a spanning tree (model/graph.ts): each node sits under one incoming edge. Any other
// edge into it is a link: solid if it points further down the tree, dashed (and routed
// around the right-hand side) if it points back up or sideways.

// SIZED: every element has a fixed size and says so in `measured`. React Flow rebuilds
// its record of a node whenever it gets a new node object (every drag frame, every
// layout change), and only keeps the node's measured connection points if `measured`
// is set. Without it, the lines to that node vanish until the DOM is measured again,
// which during a drag means they flicker or disappear entirely.
export const NODE_W = 200;
export const NODE_H = 64;
export const PILL_W = 170;
export const PILL_H = 34;

/** Drop feedback while something is dragged over this element. */
export type DropState = 'valid' | 'invalid' | null;

export type AgentNodeData = {
  name: string;
  isStart: boolean;
  isEnd: boolean;
  selected: boolean;
  hasError: boolean;
  drop: DropState;
  /** The conversation is in this node right now, during a call. */
  active: boolean;
};
export type EdgePillData = {
  label: string;
  dangling: boolean;
  selected: boolean;
  hasError: boolean;
  drop: DropState;
};
export type AgentFlowNode = Node<AgentNodeData, 'agentNode'>;
export type EdgePillNode = Node<EdgePillData, 'edgePill'>;
export type FlowNode = AgentFlowNode | EdgePillNode;

export function toFlow(
  draft: AgentDraft,
  selection: Selection,
  errored: Set<Id>,
  drop: { nodeId: Id; state: Exclude<DropState, null> } | null = null,
  activeNodeId: Id | null = null,
): { nodes: FlowNode[]; edges: Edge[] } {
  const isSelected = (kind: 'node' | 'edge', id: Id) =>
    selection?.kind === kind && selection.id === id;
  const tree = spanningTree(draft);
  const depth = depths(draft, tree);

  const nodes: FlowNode[] = [];
  const edges: Edge[] = [];
  /** A link that points back up the tree, or across at the same level (including a node to itself). */
  const isBackLink = (edgeId: Id, sourceId: Id, targetId: Id) =>
    tree.parentEdge.get(targetId) !== edgeId && (depth.get(targetId) ?? 0) <= (depth.get(sourceId) ?? 0);

  for (const n of Object.values(draft.nodes)) {
    nodes.push({
      id: n.id,
      type: 'agentNode',
      position: { x: 0, y: 0 },
      width: NODE_W,
      height: NODE_H,
      measured: { width: NODE_W, height: NODE_H }, // see SIZED below
      // The start node is the root of everything, so it can't be dragged anywhere.
      draggable: n.id !== draft.initialNodeId,
      data: {
        name: n.name.trim() || 'Untitled node',
        isStart: n.id === draft.initialNodeId,
        isEnd: n.end,
        selected: isSelected('node', n.id),
        hasError: errored.has(n.id),
        drop: drop?.nodeId === n.id ? drop.state : null,
        active: n.id === activeNodeId,
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
      measured: { width: PILL_W, height: PILL_H }, // see SIZED below
      data: {
        label: e.function.trim() || 'unnamed_edge',
        dangling: !e.targetId,
        selected: isSelected('edge', e.id),
        hasError: errored.has(e.id),
        drop: drop?.nodeId === e.id ? drop.state : null,
      },
    });
    edges.push({ id: `${e.sourceId}->${e.id}`, source: e.sourceId, target: e.id });
    if (e.targetId) {
      edges.push({
        id: `${e.id}->${e.targetId}`,
        source: e.id,
        target: e.targetId,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        ...(isBackLink(e.id, e.sourceId, e.targetId)
          ? {
              // Between the right-hand sides, stepping out to the right so it goes around
              // the tree rather than through it.
              type: 'smoothstep',
              pathOptions: { offset: 36, borderRadius: 12 },
              sourceHandle: 'link',
              targetHandle: 'link',
              className: 'link-edge',
              style: { strokeDasharray: '6 4', strokeWidth: 1.5 },
            }
          : {}),
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
 * The start node's tree comes first; anything else (only in a malformed draft) goes to its right.
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
