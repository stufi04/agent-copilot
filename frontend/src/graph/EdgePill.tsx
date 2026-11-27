import { Handle, Position, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useEditor } from '../model/store';
import type { EdgePillNode } from './toFlow';
import { PlusButton } from './PlusButton';

export const EdgePill = memo(function EdgePill({ id, data }: NodeProps<EdgePillNode>) {
  const addNodeFromEdge = useEditor((s) => s.addNodeFromEdge);
  const connectEdge = useEditor((s) => s.connectEdge);
  const classes = [
    'edge-pill',
    data.selected && 'is-selected',
    data.hasError && 'has-error',
    data.dangling && 'is-dangling',
    data.drop && `drop-${data.drop}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      <Handle type="target" position={Position.Top} isConnectable={false} className="hidden-handle" />
      <span className="edge-pill__fn">ƒ</span>
      <span className="edge-pill__label" title={data.label}>
        {data.label}
      </span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="hidden-handle" />
      <Handle id="link" type="source" position={Position.Right} isConnectable={false} className="hidden-handle" />
      {/* An edge has exactly one target, so [+] only exists while it's dangling. */}
      {data.dangling && (
        <PlusButton
          label="Add the target node"
          onClick={() => addNodeFromEdge(id)}
          onLink={(target) => connectEdge(id, target)}
        />
      )}
    </div>
  );
});
