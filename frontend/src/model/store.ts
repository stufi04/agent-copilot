import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { canAttachNode, canAttachNodeToNode, canMoveEdge, nodesRemovedBy, removeNodes, spanningTree, type MoveCheck } from './graph';
import type { AgentDraft, AgentEdge, AgentNode, EdgeProperty, Id, Selection } from './types';

// Defaults mirror backend/agent_builder/schema.py and example_flow.json.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_PERSONA =
  "You are a warm, efficient scheduling assistant for a healthcare clinic. Your responses are spoken aloud, so avoid emojis, lists, or anything that can't be read out. Keep replies to one or two short sentences. Always use an available function to move the conversation forward.";

const newId = (): Id => crypto.randomUUID();

function initialDraft(): AgentDraft {
  const greeting: AgentNode = {
    id: newId(),
    name: 'Greeting',
    taskMessage: '',
    roleMessage: '',
    end: false,
  };
  return {
    name: 'New agent',
    persona: DEFAULT_PERSONA,
    voiceId: DEFAULT_VOICE_ID,
    model: DEFAULT_MODEL,
    initialNodeId: greeting.id,
    nodes: { [greeting.id]: greeting },
    edges: {},
  };
}

/** First `${prefix}_N` not already taken. */
function nextName(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

/** `name` if free, otherwise `${name}_2`, `${name}_3`, ... */
function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;
  let n = 2;
  while (used.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}

// ---- undo history ----
// Each change that touches the agent saves the version before it. Typing is merged:
// consecutive edits to the same text field become one step, until you switch fields
// or pause for MERGE_MS. History lives in memory only; a reload starts it afresh.
export const HISTORY_LIMIT = 100;
export const MERGE_MS = 1000;

/** Text edits merge into one undo step; toggles and other values never do. */
const mergeKey = (scope: string, patch: object): string | undefined =>
  Object.values(patch).every((v) => typeof v === 'string') ? `${scope}:${Object.keys(patch).sort().join()}` : undefined;

/**
 * Selection after jumping to another version: select what came back (prefer a node),
 * drop a selection that no longer exists, otherwise keep it.
 */
function selectionAfter(selection: Selection, to: AgentDraft, from: AgentDraft): Selection {
  const restoredNode = Object.keys(to.nodes).find((id) => !from.nodes[id]);
  if (restoredNode) return { kind: 'node', id: restoredNode };
  const restoredEdge = Object.keys(to.edges).find((id) => !from.edges[id]);
  if (restoredEdge) return { kind: 'edge', id: restoredEdge };
  if (selection?.kind === 'node' && !to.nodes[selection.id]) return null;
  if (selection?.kind === 'edge' && !to.edges[selection.id]) return null;
  return selection;
}

interface EditorState {
  draft: AgentDraft;
  selection: Selection;
  /** Earlier versions of the draft, oldest first. */
  past: AgentDraft[];
  /** Undone versions, next to redo first. */
  future: AgentDraft[];

  undo: () => void;
  redo: () => void;

  select: (selection: Selection) => void;
  updateAgent: (patch: Partial<Pick<AgentDraft, 'name' | 'persona' | 'voiceId' | 'model'>>) => void;
  updateNode: (id: Id, patch: Partial<Omit<AgentNode, 'id'>>) => void;
  updateEdge: (id: Id, patch: Partial<Omit<AgentEdge, 'id' | 'sourceId' | 'targetId'>>) => void;
  addEdge: (sourceNodeId: Id) => void;
  addNodeFromEdge: (edgeId: Id) => void;
  addProperty: (edgeId: Id) => void;
  updateProperty: (edgeId: Id, propId: Id, patch: Partial<Omit<EdgeProperty, 'id'>>) => void;
  removeProperty: (edgeId: Id, propId: Id) => void;
  /** Drag a node onto an empty edge: it leaves the edge it hung from and moves there, with its subtree. */
  attachNodeToEdge: (nodeId: Id, edgeId: Id) => MoveCheck;
  /**
   * Drag a node onto another node: a new edge (selected, for naming) joins them, and the
   * dragged node hangs from it with its subtree. Its old edge stays put, left empty.
   */
  attachNodeToNode: (nodeId: Id, parentId: Id) => MoveCheck;
  /** Drag an edge onto a node: it comes out of that node now, bringing what hangs below it. */
  moveEdge: (edgeId: Id, sourceId: Id) => MoveCheck;
  /** Drag from a dangling edge's [+] to a node: the edge leads there (may make a loop). */
  connectEdge: (edgeId: Id, targetId: Id) => void;
  /** Drag from a node's [+] to a node: a new edge between them (may make a loop). Selects it. */
  linkNodes: (sourceId: Id, targetId: Id) => void;
  deleteNode: (id: Id) => void;
  deleteEdge: (id: Id) => void;
  /** Replace the whole agent, e.g. with an imported one. */
  loadDraft: (draft: AgentDraft) => void;
  /**
   * Apply a change the copilot made. All its changes in one reply (same `turnId`) are a
   * single undo step, however long the reply takes, unless something else changes the
   * agent in between.
   */
  applyCopilotDraft: (draft: AgentDraft, turnId: string) => void;
  reset: () => void;
}

export const useEditor = create<EditorState>()(
  persist(
    (rawSet, get) => {
      let lastKey: string | undefined;
      let lastAt = 0;

      /** Apply a change; if it touches the draft, record the previous version for undo. */
      const set = (
        update: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>),
        key?: string,
      ) =>
        rawSet((s) => {
          const next = typeof update === 'function' ? update(s) : update;
          if (!next.draft || next.draft === s.draft) return next;
          const now = Date.now();
          const merge = key !== undefined && key === lastKey && now - lastAt < MERGE_MS && s.past.length > 0;
          lastKey = key;
          lastAt = now;
          return { ...next, past: merge ? s.past : [...s.past, s.draft].slice(-HISTORY_LIMIT), future: [] };
        });

      const setDraft = (fn: (d: AgentDraft) => Partial<AgentDraft>, key?: string) =>
        set((s) => ({ draft: { ...s.draft, ...fn(s.draft) } }), key);

      const patchEdge = (id: Id, fn: (e: AgentEdge) => AgentEdge, key?: string) =>
        setDraft((d) => (d.edges[id] ? { edges: { ...d.edges, [id]: fn(d.edges[id]) } } : {}), key);

      return {
        draft: initialDraft(),
        selection: null,
        past: [],
        future: [],

        undo: () => {
          lastKey = undefined; // the next edit starts a new step
          rawSet((s) => {
            const prev = s.past.at(-1);
            if (!prev) return {};
            return {
              draft: prev,
              past: s.past.slice(0, -1),
              future: [s.draft, ...s.future],
              selection: selectionAfter(s.selection, prev, s.draft),
            };
          });
        },

        redo: () => {
          lastKey = undefined;
          rawSet((s) => {
            const next = s.future[0];
            if (!next) return {};
            return {
              draft: next,
              past: [...s.past, s.draft],
              future: s.future.slice(1),
              selection: selectionAfter(s.selection, next, s.draft),
            };
          });
        },

        select: (selection) => set({ selection }),

        updateAgent: (patch) => setDraft(() => patch, mergeKey('agent', patch)),

        updateNode: (id, patch) =>
          setDraft(
            (d) => (d.nodes[id] ? { nodes: { ...d.nodes, [id]: { ...d.nodes[id], ...patch } } } : {}),
            mergeKey(`node:${id}`, patch),
          ),

        updateEdge: (id, patch) => patchEdge(id, (e) => ({ ...e, ...patch }), mergeKey(`edge:${id}`, patch)),

        addEdge: (sourceNodeId) => {
          const d = get().draft;
          if (!d.nodes[sourceNodeId]) return;
          const siblingNames = Object.values(d.edges)
            .filter((e) => e.sourceId === sourceNodeId)
            .map((e) => e.function);
          const edge: AgentEdge = {
            id: newId(),
            sourceId: sourceNodeId,
            targetId: null,
            function: nextName('edge', siblingNames),
            description: '',
            properties: [],
          };
          set({
            draft: { ...d, edges: { ...d.edges, [edge.id]: edge } },
            selection: { kind: 'edge', id: edge.id },
          });
        },

        addNodeFromEdge: (edgeId) => {
          const d = get().draft;
          const edge = d.edges[edgeId];
          if (!edge || edge.targetId) return; // an edge has exactly one target
          const node: AgentNode = {
            id: newId(),
            name: nextName('node', Object.values(d.nodes).map((n) => n.name)),
            taskMessage: '',
            roleMessage: '',
            end: false,
          };
          set({
            draft: {
              ...d,
              nodes: { ...d.nodes, [node.id]: node },
              edges: { ...d.edges, [edgeId]: { ...edge, targetId: node.id } },
            },
            selection: { kind: 'node', id: node.id },
          });
        },

        addProperty: (edgeId) =>
          patchEdge(edgeId, (e) => ({
            ...e,
            properties: [
              ...e.properties,
              { id: newId(), key: '', type: 'string', description: '', required: true, enumText: '' },
            ],
          })),

        updateProperty: (edgeId, propId, patch) =>
          patchEdge(
            edgeId,
            (e) => ({ ...e, properties: e.properties.map((p) => (p.id === propId ? { ...p, ...patch } : p)) }),
            mergeKey(`property:${propId}`, patch),
          ),

        removeProperty: (edgeId, propId) =>
          patchEdge(edgeId, (e) => ({ ...e, properties: e.properties.filter((p) => p.id !== propId) })),

        attachNodeToEdge: (nodeId, edgeId) => {
          const d = get().draft;
          const check = canAttachNode(d, nodeId, edgeId);
          if (!check.ok) return check;
          const edges = { ...d.edges, [edgeId]: { ...d.edges[edgeId], targetId: nodeId } };
          // The edge it hung from is left empty, ready for another node.
          const oldParent = spanningTree(d).parentEdge.get(nodeId);
          if (oldParent) edges[oldParent] = { ...d.edges[oldParent], targetId: null };
          set({ draft: { ...d, edges } });
          return check;
        },

        attachNodeToNode: (nodeId, parentId) => {
          const d = get().draft;
          const check = canAttachNodeToNode(d, nodeId, parentId);
          if (!check.ok) return check;
          const edge: AgentEdge = {
            id: newId(),
            sourceId: parentId,
            targetId: nodeId,
            function: nextName(
              'edge',
              Object.values(d.edges)
                .filter((e) => e.sourceId === parentId)
                .map((e) => e.function),
            ),
            description: '',
            properties: [],
          };
          const edges = { ...d.edges, [edge.id]: edge };
          const oldParent = spanningTree(d).parentEdge.get(nodeId);
          if (oldParent) edges[oldParent] = { ...d.edges[oldParent], targetId: null };
          set({ draft: { ...d, edges }, selection: { kind: 'edge', id: edge.id } });
          return check;
        },

        moveEdge: (edgeId, sourceId) => {
          const d = get().draft;
          const check = canMoveEdge(d, edgeId, sourceId);
          if (!check.ok) return check;
          const edge = d.edges[edgeId];
          const siblings = Object.values(d.edges)
            .filter((e) => e.sourceId === sourceId)
            .map((e) => e.function);
          const moved: AgentEdge = { ...edge, sourceId, function: uniqueName(edge.function, siblings) };
          set({ draft: { ...d, edges: { ...d.edges, [edgeId]: moved } } });
          return check;
        },

        connectEdge: (edgeId, targetId) => {
          const d = get().draft;
          const edge = d.edges[edgeId];
          if (!edge || edge.targetId || !d.nodes[targetId]) return;
          set({ draft: { ...d, edges: { ...d.edges, [edgeId]: { ...edge, targetId } } } });
        },

        linkNodes: (sourceId, targetId) => {
          const d = get().draft;
          if (!d.nodes[sourceId] || !d.nodes[targetId]) return;
          const edge: AgentEdge = {
            id: newId(),
            sourceId,
            targetId,
            function: nextName(
              'edge',
              Object.values(d.edges)
                .filter((e) => e.sourceId === sourceId)
                .map((e) => e.function),
            ),
            description: '',
            properties: [],
          };
          set({ draft: { ...d, edges: { ...d.edges, [edge.id]: edge } }, selection: { kind: 'edge', id: edge.id } });
        },

        deleteNode: (id) => {
          const d = get().draft;
          if (id === d.initialNodeId || !d.nodes[id]) return;
          set({ draft: { ...d, ...removeNodes(d, nodesRemovedBy(d, { kind: 'node', id })) }, selection: null });
        },

        deleteEdge: (id) => {
          const d = get().draft;
          if (!d.edges[id]) return;
          // Nodes only this edge connected to the start node go with it.
          const removed = removeNodes(d, nodesRemovedBy(d, { kind: 'edge', id }));
          const edges = { ...removed.edges };
          delete edges[id];
          set({ draft: { ...d, nodes: removed.nodes, edges }, selection: null });
        },

        loadDraft: (draft) => set({ draft, selection: null }),

        applyCopilotDraft: (draft, turnId) => {
          const key = `copilot:${turnId}`;
          const merge = lastKey === key; // the copilot's last change this turn is still the latest
          lastKey = key;
          lastAt = Date.now();
          rawSet((s) => {
            if (draft === s.draft) return {};
            const sel = s.selection;
            const selectionGone = (sel?.kind === 'node' && !draft.nodes[sel.id]) || (sel?.kind === 'edge' && !draft.edges[sel.id]);
            return {
              draft,
              selection: selectionGone ? null : sel,
              past: merge && s.past.length > 0 ? s.past : [...s.past, s.draft].slice(-HISTORY_LIMIT),
              future: [],
            };
          });
        },

        reset: () => set({ draft: initialDraft(), selection: null }),
      };
    },
    {
      name: 'agent-composer:draft',
      version: 1,
      partialize: (s) => ({ draft: s.draft }),
    },
  ),
);
