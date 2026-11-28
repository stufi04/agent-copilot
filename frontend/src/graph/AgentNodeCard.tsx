import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useEditor } from '../model/store';
import type { AgentFlowNode } from './toFlow';
import { PlusButton } from './PlusButton';

export const AgentNodeCard = memo(function AgentNodeCard({ id, data }: NodeProps<AgentFlowNode>) {
  const addEdge = useEditor((s) => s.addEdge);
  const linkNodes = useEditor((s) => s.linkNodes);
  const classes = [
    'agent-node',
    data.selected && 'is-selected',
    data.hasError && 'has-error',
    data.drop && `drop-${data.drop}`,
    data.active && 'is-active',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="hidden-handle" />
      <div className="agent-node__badges">
        {data.isStart && <span className="badge badge--start">start</span>}
        {data.isEnd && <span className="badge badge--end">ends call</span>}
        {data.active && <span className="badge badge--live">live</span>}
      </div>
      <div className="agent-node__name" title={data.name}>
        {data.name}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="hidden-handle" />
      {/* Links back up the tree arrive on the right, so they curve around it instead of through it. */}
      <Handle id="link" type="target" position={Position.Right} isConnectable={false} className="hidden-handle" />
      <PlusButton label="Add an edge" onClick={() => addEdge(id)} onLink={(target) => linkNodes(id, target)} />
    </div>
  );
});
