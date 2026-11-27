import { describe, expect, it } from 'vitest';
import { actions, addEdge, addNode, draft, edgesFrom, nodeNamed } from '../test/helpers';
import { subtreeNodeIds, useEditor } from './store';

describe('initial state', () => {
  it('starts with a single Greeting node as the initial node', () => {
    const nodes = Object.values(draft().nodes);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe('Greeting');
    expect(draft().initialNodeId).toBe(nodes[0].id);
    expect(draft().edges).toEqual({});
    expect(useEditor.getState().selection).toBeNull();
  });

  it('uses the backend defaults for voice and model', () => {
    expect(draft().voiceId).toBe('21m00Tcm4TlvDq8ikWAM');
    expect(draft().model).toBe('gpt-4o');
  });
});

describe('addEdge', () => {
  it('creates a dangling edge under the node and selects it', () => {
    const g = draft().initialNodeId;
    const id = addEdge(g);
    expect(draft().edges[id]).toMatchObject({ sourceId: g, targetId: null, function: 'edge_1' });
    expect(useEditor.getState().selection).toEqual({ kind: 'edge', id });
  });

  it('numbers edges per source node, filling the first free slot', () => {
    const g = draft().initialNodeId;
    const a = addEdge(g);
    addEdge(g);
    expect(edgesFrom(g).map((e) => e.function)).toEqual(['edge_1', 'edge_2']);

    actions().updateEdge(a, { function: 'custom' });
    addEdge(g);
    expect(edgesFrom(g).map((e) => e.function)).toEqual(['custom', 'edge_2', 'edge_1']);

    // A different node starts its own numbering.
    const child = addNode(a);
    addEdge(child);
    expect(edgesFrom(child).map((e) => e.function)).toEqual(['edge_1']);
  });

  it('ignores unknown nodes', () => {
    actions().addEdge('nope');
    expect(draft().edges).toEqual({});
  });
});

describe('addNodeFromEdge', () => {
  it('creates a node, makes it the edge target, and selects it', () => {
    const e = addEdge(draft().initialNodeId);
    const n = addNode(e);
    expect(draft().nodes[n].name).toBe('node_1');
    expect(draft().edges[e].targetId).toBe(n);
    expect(useEditor.getState().selection).toEqual({ kind: 'node', id: n });
  });

  it('does nothing when the edge already has a target', () => {
    const e = addEdge(draft().initialNodeId);
    const n = addNode(e);
    actions().addNodeFromEdge(e);
    expect(Object.keys(draft().nodes)).toHaveLength(2);
    expect(draft().edges[e].targetId).toBe(n);
  });

  it('picks node names that are not taken', () => {
    const g = draft().initialNodeId;
    const first = addNode(addEdge(g));
    actions().updateNode(first, { name: 'node_2' });
    addNode(addEdge(g));
    expect(Object.values(draft().nodes).map((n) => n.name).sort()).toEqual(['Greeting', 'node_1', 'node_2']);
  });
});

describe('updates', () => {
  it('patches nodes, edges and agent settings', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 'Hi', end: true });
    expect(draft().nodes[g]).toMatchObject({ name: 'Greeting', taskMessage: 'Hi', end: true });

    const e = addEdge(g, { description: 'when' });
    expect(draft().edges[e].description).toBe('when');

    actions().updateAgent({ name: 'Bot', model: 'gpt-x' });
    expect(draft()).toMatchObject({ name: 'Bot', model: 'gpt-x' });
  });

  it('adds, updates and removes edge fields', () => {
    const e = addEdge(draft().initialNodeId);
    actions().addProperty(e);
    actions().addProperty(e);
    const [p1, p2] = draft().edges[e].properties;
    expect(p1).toMatchObject({ key: '', type: 'string', required: true, enumText: '' });

    actions().updateProperty(e, p2.id, { key: 'age', type: 'integer', required: false });
    expect(draft().edges[e].properties[1]).toMatchObject({ key: 'age', type: 'integer', required: false });

    actions().removeProperty(e, p1.id);
    expect(draft().edges[e].properties.map((p) => p.key)).toEqual(['age']);
  });

  it('renaming a node keeps the edges pointing at it', () => {
    const e = addEdge(draft().initialNodeId);
    const n = addNode(e);
    actions().updateNode(n, { name: 'renamed' });
    expect(draft().edges[e].targetId).toBe(n);
  });
});

describe('deleting', () => {
  // Greeting -> a -> A -> b -> B
  //          -> c -> C
  function tree() {
    const g = draft().initialNodeId;
    const a = addEdge(g, { function: 'a' });
    const A = addNode(a, { name: 'A' });
    const b = addEdge(A, { function: 'b' });
    const B = addNode(b, { name: 'B' });
    const c = addEdge(g, { function: 'c' });
    const C = addNode(c, { name: 'C' });
    return { g, a, A, b, B, c, C };
  }

  it('subtreeNodeIds returns the node and everything below it', () => {
    const { g, A, B, C } = tree();
    expect(subtreeNodeIds(draft(), A)).toEqual(new Set([A, B]));
    expect(subtreeNodeIds(draft(), g)).toEqual(new Set([g, A, B, C]));
  });

  it('deleteNode removes the subtree and detaches the edge that led to it', () => {
    const { a, A, b, B, C } = tree();
    actions().select({ kind: 'node', id: A });
    actions().deleteNode(A);
    expect(draft().nodes[A]).toBeUndefined();
    expect(draft().nodes[B]).toBeUndefined();
    expect(draft().edges[b]).toBeUndefined();
    expect(draft().edges[a].targetId).toBeNull(); // the incoming edge stays, dangling
    expect(draft().nodes[C]).toBeDefined();
    expect(useEditor.getState().selection).toBeNull();
  });

  it('deleteNode refuses to delete the initial node', () => {
    const { g } = tree();
    actions().deleteNode(g);
    expect(Object.keys(draft().nodes)).toHaveLength(4);
  });

  it('deleteEdge removes the edge and the subtree it leads to', () => {
    const { a, A, b, B, c, C } = tree();
    actions().deleteEdge(a);
    expect(draft().edges[a]).toBeUndefined();
    expect(draft().nodes[A]).toBeUndefined();
    expect(draft().nodes[B]).toBeUndefined();
    expect(draft().edges[b]).toBeUndefined();
    expect(draft().edges[c]).toBeDefined();
    expect(draft().nodes[C]).toBeDefined();
  });

  it('deleteEdge on a dangling edge only removes the edge', () => {
    const g = draft().initialNodeId;
    const e = addEdge(g);
    actions().deleteEdge(e);
    expect(draft().edges).toEqual({});
    expect(Object.keys(draft().nodes)).toEqual([g]);
  });
});

describe('loadDraft', () => {
  it('replaces the whole agent, clears the selection, and is persisted', () => {
    addEdge(draft().initialNodeId); // selects the new edge
    const replacement = { ...draft(), name: 'Imported', nodes: { only: { id: 'only', name: 'Only', taskMessage: 't', roleMessage: '', end: true } }, edges: {}, initialNodeId: 'only' };
    actions().loadDraft(replacement);
    expect(draft()).toEqual(replacement);
    expect(useEditor.getState().selection).toBeNull();
    expect(JSON.parse(localStorage.getItem('agent-composer:draft')!).state.draft.name).toBe('Imported');
  });
});

describe('reset and persistence', () => {
  it('reset returns to a fresh Greeting-only agent', () => {
    addNode(addEdge(draft().initialNodeId));
    actions().updateAgent({ name: 'Changed' });
    actions().reset();
    expect(Object.values(draft().nodes).map((n) => n.name)).toEqual(['Greeting']);
    expect(draft().name).toBe('New agent');
    expect(useEditor.getState().selection).toBeNull();
  });

  it('saves the draft (but not the selection) to localStorage', () => {
    addEdge(draft().initialNodeId);
    const saved = JSON.parse(localStorage.getItem('agent-composer:draft')!);
    expect(saved.state.draft).toEqual(draft());
    expect(saved.state.selection).toBeUndefined();
  });

  it('restores a saved draft on rehydrate', async () => {
    actions().updateAgent({ name: 'Saved agent' });
    const snapshot = localStorage.getItem('agent-composer:draft')!;
    actions().reset();
    localStorage.setItem('agent-composer:draft', snapshot);
    await useEditor.persist.rehydrate();
    expect(draft().name).toBe('Saved agent');
    expect(nodeNamed('Greeting')).toBeDefined();
  });
});
