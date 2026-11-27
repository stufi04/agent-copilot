import { canMoveNode } from '../model/graph';
import type { AgentDraft, Id } from '../model/types';

// What happens when something is dragged onto a node. Only agent nodes are drop
// targets; dropping on empty canvas or on a pill does nothing.
//
//   node -> node   move the node, with its subtree, under the target node
//   edge -> node   repoint the edge at the target node (loops and self-loops allowed)

export type Dragged = { kind: 'node' | 'edge'; id: Id };

export type DropResult =
  | { ok: true; action: 'move' | 'repoint' }
  | { ok: false; reason: string };

export function resolveDrop(draft: AgentDraft, dragged: Dragged, overNodeId: Id): DropResult {
  if (!draft.nodes[overNodeId]) return { ok: false, reason: 'Not a node.' };

  if (dragged.kind === 'node') {
    const check = canMoveNode(draft, dragged.id, overNodeId);
    return check.ok ? { ok: true, action: 'move' } : check;
  }

  const edge = draft.edges[dragged.id];
  if (!edge) return { ok: false, reason: 'Unknown edge.' };
  if (edge.targetId === overNodeId) return { ok: false, reason: 'The edge already points here.' };
  return { ok: true, action: 'repoint' };
}
