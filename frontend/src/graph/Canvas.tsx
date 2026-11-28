import { Background, Controls, ReactFlow, useReactFlow, ViewportPortal, type NodeTypes, type XYPosition } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { canAttachNode, canAttachNodeToNode, canMoveEdge, edgeSubtree, spanningTree, treeSubtree } from '../model/graph';
import { useEditor } from '../model/store';
import type { Id } from '../model/types';
import { AgentNodeCard } from './AgentNodeCard';
import { EdgePill } from './EdgePill';
import { useLinkDrag } from './linkDrag';
import { useCall } from '../call/call';
import { toFlow, type FlowNode } from './toFlow';

const nodeTypes: NodeTypes = { agentNode: AgentNodeCard, edgePill: EdgePill } as NodeTypes;
// Never zoom past 100% when fitting, so a small graph doesn't render huge.
// Padding is in px (a bare number is px too, so 0.2 meant none): room at the top for the
// call button, and at the bottom for the [+] that hangs under the last node.
const FIT_OPTIONS = { padding: { top: 56, bottom: 48, x: 48 }, maxZoom: 1, duration: 300 };

// Dragging keeps the node -> edge -> node alternation:
//
//   node onto an empty edge   the node leaves the edge it hung from and hangs there instead
//   node onto a node          a new edge joins them; the node's old edge stays, left empty
//   edge onto a node          the edge comes out of that node instead
//
// Whatever hangs below the dragged element travels with it, and the one line being
// broken (into the node, or out to the edge) is hidden for the duration of the drag.

type Dragged = { kind: 'node' | 'edge'; id: Id };

interface DragState {
  dragged: Dragged;
  /** How far the pointer has moved the dragged element from its laid-out position. */
  delta: XYPosition;
  /** The drop target under the pointer: an edge pill or agent node for a node, an agent node for an edge. */
  over: Id | null;
}

const clientPoint = (e: MouseEvent | TouchEvent): XYPosition =>
  'touches' in e
    ? { x: (e.changedTouches[0] ?? e.touches[0]).clientX, y: (e.changedTouches[0] ?? e.touches[0]).clientY }
    : { x: e.clientX, y: e.clientY };

const draggedOf = (n: FlowNode): Dragged => ({ kind: n.type === 'edgePill' ? 'edge' : 'node', id: n.id });

export function Canvas({ errored }: { errored: Set<Id> }) {
  const draft = useEditor((s) => s.draft);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const attachNodeToEdge = useEditor((s) => s.attachNodeToEdge);
  const attachNodeToNode = useEditor((s) => s.attachNodeToNode);
  const moveEdge = useEditor((s) => s.moveEdge);
  const link = useLinkDrag((s) => s.drag);
  const linkOver = link?.over ?? null;
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<DragState | null>(null);

  const tree = useMemo(() => spanningTree(draft), [draft]);

  /** Everything that travels with a drag, and the id of the line it breaks. */
  const detach = useCallback(
    (dragged: Dragged): { moving: Set<Id>; broken: string | null } => {
      if (dragged.kind === 'node') {
        const { nodes, edges } = treeSubtree(draft, dragged.id, tree);
        const parent = tree.parentEdge.get(dragged.id);
        return { moving: new Set([...nodes, ...edges]), broken: parent ? `${parent}->${dragged.id}` : null };
      }
      const { nodes, edges } = edgeSubtree(draft, dragged.id, tree);
      const edge = draft.edges[dragged.id];
      return { moving: new Set([...nodes, ...edges]), broken: edge ? `${edge.sourceId}->${edge.id}` : null };
    },
    [draft, tree],
  );
  const dragKind = drag?.dragged.kind;
  const dragId = drag?.dragged.id;
  const detached = useMemo(
    () => (dragKind && dragId ? detach({ kind: dragKind, id: dragId }) : { moving: new Set<Id>(), broken: null }),
    [dragKind, dragId, detach],
  );

  const canDrop = useCallback(
    (dragged: Dragged, over: Id) =>
      dragged.kind === 'edge'
        ? canMoveEdge(draft, dragged.id, over)
        : draft.edges[over]
          ? canAttachNode(draft, dragged.id, over)
          : canAttachNodeToNode(draft, dragged.id, over),
    [draft],
  );

  const over = drag?.over ?? null;
  const dropState = useMemo(() => {
    if (linkOver) return { nodeId: linkOver, state: 'valid' as const };
    if (!over || !dragKind || !dragId) return null;
    const result = canDrop({ kind: dragKind, id: dragId }, over);
    return { nodeId: over, state: result.ok ? ('valid' as const) : ('invalid' as const) };
  }, [linkOver, over, dragKind, dragId, canDrop]);

  // During a call, the backend names the node the conversation is in; node names are unique.
  const activeName = useCall((s) => s.activeNode);
  const activeId = useMemo(
    () => (activeName ? (Object.values(draft.nodes).find((n) => n.name.trim() === activeName)?.id ?? null) : null),
    [activeName, draft.nodes],
  );

  const layout = useMemo(
    () => toFlow(draft, selection, errored, dropState, activeId),
    [draft, selection, errored, dropState, activeId],
  );

  // While dragging, shift the moving elements by the drag offset; everything else stays put.
  const nodes = useMemo<FlowNode[]>(() => {
    if (!drag) return layout.nodes;
    const { x, y } = drag.delta;
    return layout.nodes.map((n) =>
      detached.moving.has(n.id)
        ? { ...n, position: { x: n.position.x + x, y: n.position.y + y }, className: 'is-dragging', zIndex: 1000 }
        : n,
    );
  }, [layout.nodes, drag, detached]);
  const edges = useMemo(
    () => (detached.broken ? layout.edges.filter((e) => e.id !== detached.broken) : layout.edges),
    [layout.edges, detached.broken],
  );

  /** The element of the given type under a screen point, ignoring whatever is being dragged. */
  const elementAt = useCallback(
    (client: XYPosition, type: FlowNode['type'], ignore: Set<Id>): Id | null => {
      const p = screenToFlowPosition(client);
      const hit = layout.nodes.find(
        (n) =>
          n.type === type &&
          !ignore.has(n.id) &&
          p.x >= n.position.x &&
          p.x <= n.position.x + n.width! &&
          p.y >= n.position.y &&
          p.y <= n.position.y + n.height!,
      );
      return hit?.id ?? null;
    },
    [layout.nodes, screenToFlowPosition],
  );

  const refit = useCallback(() => requestAnimationFrame(() => void fitView(FIT_OPTIONS)), [fitView]);

  // Re-fit whenever an element is added or removed, so the whole graph stays in view.
  // Zooming by hand between changes is left alone.
  // A new initial node id means a different agent was loaded (import or reset).
  const count = layout.nodes.length;
  const agentId = draft.initialNodeId;
  useEffect(() => {
    const frame = refit();
    return () => cancelAnimationFrame(frame);
  }, [count, agentId, refit]);

  /** A node is dropped on an edge pill or an agent node; an edge on an agent node. */
  const targetAt = (event: MouseEvent | TouchEvent, dragged: Dragged) => {
    const ignore = detach(dragged).moving;
    const point = clientPoint(event);
    return (
      (dragged.kind === 'node' ? elementAt(point, 'edgePill', ignore) : null) ?? elementAt(point, 'agentNode', ignore)
    );
  };

  const onNodeDrag = (event: MouseEvent | TouchEvent, node: FlowNode) => {
    const base = layout.nodes.find((n) => n.id === node.id);
    if (!base) return;
    const dragged = draggedOf(node);
    const delta = { x: node.position.x - base.position.x, y: node.position.y - base.position.y };
    setDrag({ dragged, delta, over: targetAt(event, dragged) });
  };

  const onNodeDragStop = (event: MouseEvent | TouchEvent, node: FlowNode) => {
    const dragged = draggedOf(node);
    const over = targetAt(event, dragged);
    setDrag(null); // everything snaps back into the layout
    if (!over) return;
    const result =
      dragged.kind === 'edge'
        ? moveEdge(dragged.id, over)
        : draft.edges[over]
          ? attachNodeToEdge(dragged.id, over)
          : attachNodeToNode(dragged.id, over);
    if (result.ok) refit(); // the layout changed shape
  };

  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => select({ kind: n.type === 'edgePill' ? 'edge' : 'node', id: n.id })}
      onPaneClick={() => select(null)}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      nodeDragThreshold={4}
      nodesConnectable={false}
      elementsSelectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={FIT_OPTIONS}
      minZoom={0.1}
      maxZoom={2}
      defaultEdgeOptions={{ type: 'smoothstep', style: { strokeWidth: 1.5 } }}
      proOptions={{ hideAttribution: true }}
    >
      {link && (
        <ViewportPortal>
          <svg className="link-preview-layer" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <line className="link-preview" x1={link.from.x} y1={link.from.y} x2={link.to.x} y2={link.to.y} />
          </svg>
        </ViewportPortal>
      )}
      <Background gap={20} size={1} />
      <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
    </ReactFlow>
  );
}
