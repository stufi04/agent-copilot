import { Background, Controls, ReactFlow, useReactFlow, type NodeTypes } from '@xyflow/react';
import { useEffect, useMemo } from 'react';
import { useEditor } from '../model/store';
import type { Id } from '../model/types';
import { AgentNodeCard } from './AgentNodeCard';
import { EdgePill } from './EdgePill';
import { toFlow, type FlowNode } from './toFlow';

const nodeTypes: NodeTypes = { agentNode: AgentNodeCard, edgePill: EdgePill } as NodeTypes;
// Never zoom past 100% when fitting, so a small graph doesn't render huge.
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1, duration: 300 };

export function Canvas({ errored }: { errored: Set<Id> }) {
  const draft = useEditor((s) => s.draft);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => toFlow(draft, selection, errored), [draft, selection, errored]);

  // Re-fit whenever an element is added or removed, so the whole graph stays in view.
  // Zooming by hand between changes is left alone.
  // A new initial node id means a different agent was loaded (import or reset).
  const count = nodes.length;
  const agentId = draft.initialNodeId;
  useEffect(() => {
    const frame = requestAnimationFrame(() => void fitView(FIT_OPTIONS));
    return () => cancelAnimationFrame(frame);
  }, [count, agentId, fitView]);

  return (
    <ReactFlow<FlowNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => select({ kind: n.type === 'edgePill' ? 'edge' : 'node', id: n.id })}
      onPaneClick={() => select(null)}
      nodesDraggable={false}
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
