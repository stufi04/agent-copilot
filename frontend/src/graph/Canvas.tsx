import { Background, Controls, ReactFlow, useReactFlow, type NodeTypes, type XYPosition } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { treeSubtree } from '../model/graph';
import { useEditor } from '../model/store';
import type { Id } from '../model/types';
import { AgentNodeCard } from './AgentNodeCard';
import { resolveDrop, type Dragged } from './drop';
import { EdgePill } from './EdgePill';
import { toFlow, type FlowNode } from './toFlow';

const nodeTypes: NodeTypes = { agentNode: AgentNodeCard, edgePill: EdgePill } as NodeTypes;
// Never zoom past 100% when fitting, so a small graph doesn't render huge.
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1, duration: 300 };

interface DragState {
  dragged: Dragged;
  /** How far the pointer has moved the dragged element from its laid-out position. */
  delta: XYPosition;
  /** The agent node under the pointer, if any. */
  over: Id | null;
}

const clientPoint = (e: MouseEvent | TouchEvent): XYPosition =>
  'touches' in e
    ? { x: (e.changedTouches[0] ?? e.touches[0]).clientX, y: (e.changedTouches[0] ?? e.touches[0]).clientY }
    : { x: e.clientX, y: e.clientY };

export function Canvas({ errored }: { errored: Set<Id> }) {
  const draft = useEditor((s) => s.draft);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const moveNode = useEditor((s) => s.moveNode);
  const repointEdge = useEditor((s) => s.repointEdge);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [drag, setDrag] = useState<DragState | null>(null);

  // What travels with a drag: a node brings its whole subtree; an edge moves alone.
  const movingIds = useCallback(
    (dragged: Dragged): Set<Id> => {
      if (dragged.kind === 'edge') return new Set([dragged.id]);
      const { nodes, edges } = treeSubtree(draft, dragged.id);
      return new Set([...nodes, ...edges]);
    },
    [draft],
  );
  const dragKind = drag?.dragged.kind;
  const dragId = drag?.dragged.id;
  const moving = useMemo(
    () => (dragKind && dragId ? movingIds({ kind: dragKind, id: dragId }) : new Set<Id>()),
    [dragKind, dragId, movingIds],
  );

  const over = drag?.over ?? null;
  const dropState = useMemo(() => {
    if (!over || !dragKind || !dragId) return null;
    const result = resolveDrop(draft, { kind: dragKind, id: dragId }, over);
    return { nodeId: over, state: result.ok ? ('valid' as const) : ('invalid' as const) };
  }, [over, dragKind, dragId, draft]);

  const layout = useMemo(() => toFlow(draft, selection, errored, dropState), [draft, selection, errored, dropState]);

  // While dragging, shift the moving elements by the drag offset; everything else stays put.
  const nodes = useMemo<FlowNode[]>(() => {
    if (!drag) return layout.nodes;
    const { x, y } = drag.delta;
    return layout.nodes.map((n) =>
      moving.has(n.id)
        ? { ...n, position: { x: n.position.x + x, y: n.position.y + y }, className: 'is-dragging', zIndex: 1000 }
        : n,
    );
  }, [layout.nodes, drag, moving]);

  /** The agent node under a screen point, ignoring whatever is being dragged. */
  const nodeAt = useCallback(
    (client: XYPosition, ignore: Set<Id>): Id | null => {
      const p = screenToFlowPosition(client);
      const hit = layout.nodes.find(
        (n) =>
          n.type === 'agentNode' &&
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

  const draggedOf = (node: FlowNode): Dragged => ({ kind: node.type === 'edgePill' ? 'edge' : 'node', id: node.id });

  const onNodeDrag = (event: MouseEvent | TouchEvent, node: FlowNode) => {
    const base = layout.nodes.find((n) => n.id === node.id);
    if (!base) return;
    const dragged = draggedOf(node);
    const delta = { x: node.position.x - base.position.x, y: node.position.y - base.position.y };
    setDrag({ dragged, delta, over: nodeAt(clientPoint(event), movingIds(dragged)) });
  };

  const onNodeDragStop = (event: MouseEvent | TouchEvent, node: FlowNode) => {
    const dragged = draggedOf(node);
    const over = nodeAt(clientPoint(event), movingIds(dragged));
    setDrag(null); // everything snaps back into the layout
    if (!over || !resolveDrop(draft, dragged, over).ok) return;
    if (dragged.kind === 'node') moveNode(dragged.id, over);
    else repointEdge(dragged.id, over);
    refit(); // the layout changed shape
  };

  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={layout.edges}
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
      <Background gap={20} size={1} />
      <Controls showInteractive={false} fitViewOptions={FIT_OPTIONS} />
    </ReactFlow>
  );
}
