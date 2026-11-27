import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useEditor } from '../model/store';
import type { AgentFlowNode } from './toFlow';
import { PlusButton } from './PlusButton';

export const AgentNodeCard = memo(function AgentNodeCard({ id, data }: NodeProps<AgentFlowNode>) {
  const addEdge = useEditor((s) => s.addEdge);
  const classes = [
    'agent-node',
    data.selected && 'is-selected',
    data.hasError && 'has-error',
    data.unreachable && 'is-unreachable',
    data.drop && `drop-${data.drop}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="hidden-handle" />
      <div className="agent-node__badges">
        {data.isStart && <span className="badge badge--start">start</span>}
        {data.isEnd && <span className="badge badge--end">ends call</span>}
        {data.unreachable && <span className="badge badge--orphan">disconnected</span>}
      </div>
      <div className="agent-node__name" title={data.name}>
        {data.name}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="hidden-handle" />
      {/* Loops and cross-links arrive on the right, so they curve around the tree instead of through it. */}
      <Handle id="link" type="target" position={Position.Right} isConnectable={false} className="hidden-handle" />
      <PlusButton label="Add an edge" onClick={() => addEdge(id)} />
    </div>
  );
});
