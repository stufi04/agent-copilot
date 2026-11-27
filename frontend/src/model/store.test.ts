import { describe, expect, it } from 'vitest';
import { actions, addEdge, addNode, buildTree, draft, edgesFrom, nodeNamed } from '../test/helpers';
import { useEditor } from './store';

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

describe('moveNode', () => {
  const tree = buildTree;

  it('moves the edge the node hangs from, so its subtree follows', () => {
    const { a, A, b, B, C } = tree();
    expect(actions().moveNode(A, C)).toEqual({ ok: true });
    expect(draft().edges[a]).toMatchObject({ sourceId: C, targetId: A });
    expect(draft().edges[b]).toMatchObject({ sourceId: A, targetId: B }); // untouched
    expect(Object.keys(draft().nodes)).toHaveLength(4);
  });

  it('renames the edge if the new parent already has one with that name', () => {
    const { a, A, C } = tree();
    addEdge(C, { function: 'a' });
    actions().moveNode(A, C);
    expect(draft().edges[a].function).toBe('a_2');
  });

  it('refuses invalid moves and leaves the graph unchanged', () => {
    const { g, A, B } = tree();
    const before = draft();
    expect(actions().moveNode(A, B)).toMatchObject({ ok: false });
    expect(actions().moveNode(g, A)).toMatchObject({ ok: false });
    expect(draft()).toBe(before);
  });

  it('is a no-op when dropped on its current parent', () => {
    const { g, A } = tree();
    const before = draft();
    expect(actions().moveNode(A, g)).toEqual({ ok: true });
    expect(draft()).toBe(before);
  });

  it('connects a disconnected node with a new, selected edge', () => {
    const { a, A, C } = tree();
    actions().repointEdge(a, C); // A is now cut off and has no incoming edge
    actions().moveNode(A, C);
    const [created] = edgesFrom(C).filter((e) => e.targetId === A);
    expect(created).toMatchObject({ function: 'edge_1', description: '' });
    expect(useEditor.getState().selection).toEqual({ kind: 'edge', id: created.id });
  });
});

describe('repointEdge', () => {
  const tree = buildTree;

  it('points the edge at another node and cuts off the old target', () => {
    const { a, A, C } = tree();
    actions().repointEdge(a, C);
    expect(draft().edges[a].targetId).toBe(C);
    expect(draft().nodes[A]).toBeDefined(); // nothing is deleted, it's just disconnected
  });

  it('can loop back to the start node or to its own source', () => {
    const { g, b, A } = tree();
    actions().repointEdge(b, g);
    expect(draft().edges[b].targetId).toBe(g);
    actions().repointEdge(b, A);
    expect(draft().edges[b].targetId).toBe(A);
  });

  it('fills a dangling edge', () => {
    const { g, C } = tree();
    const e = addEdge(g);
    actions().repointEdge(e, C);
    expect(draft().edges[e].targetId).toBe(C);
  });

  it('ignores unknown nodes and no-op repoints', () => {
    const { a, A } = tree();
    const before = draft();
    actions().repointEdge(a, 'nope');
    actions().repointEdge(a, A);
    expect(draft()).toBe(before);
  });
});

describe('deleting', () => {
  const tree = buildTree;

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

  it('deleting a node with a loop back to the start keeps the start', () => {
    const { g, A, B, C } = tree();
    actions().repointEdge(addEdge(B, { function: 'loop' }), g);
    actions().deleteNode(A);
    expect(Object.keys(draft().nodes).sort()).toEqual([g, C].sort());
    expect(draft().nodes[B]).toBeUndefined();
  });

  it('a node shared with another branch survives its parent being deleted', () => {
    const { A, B, C } = tree();
    const shared = addEdge(C, { function: 'shared' });
    actions().repointEdge(shared, B);
    actions().deleteNode(A);
    expect(draft().nodes[B]).toBeDefined();
    expect(draft().edges[shared].targetId).toBe(B);
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
