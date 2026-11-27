import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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

/** The node plus everything reachable below it through outgoing edges. */
export function subtreeNodeIds(draft: AgentDraft, rootId: Id): Set<Id> {
  const seen = new Set<Id>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of Object.values(draft.edges)) {
      if (e.sourceId === id && e.targetId) stack.push(e.targetId);
    }
  }
  return seen;
}

/** Remove the given nodes, their outgoing edges, and detach edges pointing at them. */
function removeNodes(draft: AgentDraft, ids: Set<Id>): Pick<AgentDraft, 'nodes' | 'edges'> {
  const nodes = Object.fromEntries(Object.entries(draft.nodes).filter(([id]) => !ids.has(id)));
  const edges: Record<Id, AgentEdge> = {};
  for (const [id, e] of Object.entries(draft.edges)) {
    if (ids.has(e.sourceId)) continue;
    edges[id] = e.targetId && ids.has(e.targetId) ? { ...e, targetId: null } : e;
  }
  return { nodes, edges };
}

interface EditorState {
  draft: AgentDraft;
  selection: Selection;

  select: (selection: Selection) => void;
  updateAgent: (patch: Partial<Pick<AgentDraft, 'name' | 'persona' | 'voiceId' | 'model'>>) => void;
  updateNode: (id: Id, patch: Partial<Omit<AgentNode, 'id'>>) => void;
  updateEdge: (id: Id, patch: Partial<Omit<AgentEdge, 'id' | 'sourceId' | 'targetId'>>) => void;
  addEdge: (sourceNodeId: Id) => void;
  addNodeFromEdge: (edgeId: Id) => void;
  addProperty: (edgeId: Id) => void;
  updateProperty: (edgeId: Id, propId: Id, patch: Partial<Omit<EdgeProperty, 'id'>>) => void;
  removeProperty: (edgeId: Id, propId: Id) => void;
  deleteNode: (id: Id) => void;
  deleteEdge: (id: Id) => void;
  reset: () => void;
}

export const useEditor = create<EditorState>()(
  persist(
    (set, get) => {
      const setDraft = (fn: (d: AgentDraft) => Partial<AgentDraft>) =>
        set((s) => ({ draft: { ...s.draft, ...fn(s.draft) } }));

      const patchEdge = (id: Id, fn: (e: AgentEdge) => AgentEdge) =>
        setDraft((d) => (d.edges[id] ? { edges: { ...d.edges, [id]: fn(d.edges[id]) } } : {}));

      return {
        draft: initialDraft(),
        selection: null,

        select: (selection) => set({ selection }),

        updateAgent: (patch) => setDraft(() => patch),

        updateNode: (id, patch) =>
          setDraft((d) => (d.nodes[id] ? { nodes: { ...d.nodes, [id]: { ...d.nodes[id], ...patch } } } : {})),

        updateEdge: (id, patch) => patchEdge(id, (e) => ({ ...e, ...patch })),

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
          patchEdge(edgeId, (e) => ({
            ...e,
            properties: e.properties.map((p) => (p.id === propId ? { ...p, ...patch } : p)),
          })),

        removeProperty: (edgeId, propId) =>
          patchEdge(edgeId, (e) => ({ ...e, properties: e.properties.filter((p) => p.id !== propId) })),

        deleteNode: (id) => {
          const d = get().draft;
          if (id === d.initialNodeId || !d.nodes[id]) return;
          set({ draft: { ...d, ...removeNodes(d, subtreeNodeIds(d, id)) }, selection: null });
        },

        deleteEdge: (id) => {
          const d = get().draft;
          const edge = d.edges[id];
          if (!edge) return;
          // The edge's target subtree would be unreachable without it, so it goes too.
          const removed = edge.targetId ? removeNodes(d, subtreeNodeIds(d, edge.targetId)) : d;
          const edges = { ...removed.edges };
          delete edges[id];
          set({ draft: { ...d, nodes: removed.nodes, edges }, selection: null });
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
