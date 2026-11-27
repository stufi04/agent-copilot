import type { XYPosition } from '@xyflow/react';
import { create } from 'zustand';
import type { Id } from '../model/types';

// Dragging from a [+] to an existing node links to it, instead of adding a new one.
// The [+] button runs the gesture; the canvas reads this store to draw the preview line
// and highlight the node under the pointer.

export interface LinkDrag {
  /** Where the line starts: the [+], in flow coordinates. */
  from: XYPosition;
  /** The pointer, in flow coordinates. */
  to: XYPosition;
  /** The agent node under the pointer, if any. */
  over: Id | null;
}

export const useLinkDrag = create<{ drag: LinkDrag | null }>(() => ({ drag: null }));
