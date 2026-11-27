import { useReactFlow, type XYPosition } from '@xyflow/react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { Id } from '../model/types';
import { useLinkDrag } from './linkDrag';
import { NODE_H, NODE_W } from './toFlow';

/** How far the pointer must move before a press on [+] becomes a drag. */
const DRAG_THRESHOLD = 4;

/**
 * The [+] shown under a hovered node or edge pill (revealed via CSS on parent :hover).
 * Click: add a new element. Press and drag to an existing node: `onLink(nodeId)`.
 */
export function PlusButton({
  label,
  onClick,
  onLink,
}: {
  label: string;
  onClick: () => void;
  onLink?: (nodeId: Id) => void;
}) {
  const { screenToFlowPosition, getNodes } = useReactFlow();
  const dragged = useRef(false);

  const nodeAt = (p: XYPosition): Id | null =>
    getNodes().find(
      (n) =>
        n.type === 'agentNode' &&
        p.x >= n.position.x &&
        p.x <= n.position.x + (n.width ?? NODE_W) &&
        p.y >= n.position.y &&
        p.y <= n.position.y + (n.height ?? NODE_H),
    )?.id ?? null;

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!onLink || e.button !== 0) return;
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY };
    const box = e.currentTarget.getBoundingClientRect();
    const from = screenToFlowPosition({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    dragged.current = false;

    const move = (ev: PointerEvent) => {
      if (!dragged.current && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
      dragged.current = true;
      const to = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      useLinkDrag.setState({ drag: { from, to, over: nodeAt(to) } });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      useLinkDrag.setState({ drag: null });
      if (!dragged.current || ev.type === 'pointercancel') return;
      const over = nodeAt(screenToFlowPosition({ x: ev.clientX, y: ev.clientY }));
      if (over) onLink(over);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    // The wrapper's padding bridges the gap to the element, so hover isn't lost on the way down.
    <div className="plus-slot nodrag nopan">
      <button
        type="button"
        className="plus-button"
        title={onLink ? `${label} (or drag to an existing node)` : label}
        aria-label={label}
        onPointerDown={onPointerDown}
        onClick={(e) => {
          e.stopPropagation(); // don't also select the element underneath
          if (dragged.current) {
            dragged.current = false; // that was the end of a drag, not a click
            return;
          }
          onClick();
        }}
      >
        +
      </button>
    </div>
  );
}
