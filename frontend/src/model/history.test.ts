import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actions, addEdge, addField, addNode, buildTree, draft, nodeNamed } from '../test/helpers';
import { HISTORY_LIMIT, MERGE_MS, useEditor } from './store';

const state = () => useEditor.getState();
const steps = () => state().past.length;

// Typing merges on time, so the clock is controlled.
let now = 1_000_000;
const advance = (ms: number) => (now += ms);
beforeEach(() => {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => {
  now += 10 * MERGE_MS; // never merge across tests
});

describe('undo / redo', () => {
  it('starts with nothing to undo or redo, and undo/redo are then no-ops', () => {
    const before = draft();
    actions().undo();
    actions().redo();
    expect(draft()).toBe(before);
    expect(state()).toMatchObject({ past: [], future: [] });
  });

  it('adding an edge and a node are one step each', () => {
    const g = draft().initialNodeId;
    const start = draft();
    actions().addEdge(g);
    const withEdge = draft();
    const e = state().selection!;
    actions().addNodeFromEdge((e as { id: string }).id);
    expect(steps()).toBe(2);

    actions().undo();
    expect(draft()).toBe(withEdge);
    actions().undo();
    expect(draft()).toBe(start);
    expect(steps()).toBe(0);
  });

  it('redo replays undone steps in order, and goes back to the exact same versions', () => {
    const { A } = buildTree();
    const end = draft();
    const n = steps();
    for (let i = 0; i < n; i++) actions().undo();
    expect(Object.keys(draft().nodes)).toHaveLength(1);
    for (let i = 0; i < n; i++) actions().redo();
    expect(draft()).toBe(end);
    expect(draft().nodes[A].name).toBe('A');
  });

  it('a new change after undoing clears the redo list', () => {
    const g = draft().initialNodeId;
    actions().addEdge(g);
    actions().undo();
    expect(state().future).toHaveLength(1);
    actions().updateNode(g, { end: true });
    expect(state().future).toEqual([]);
    actions().redo();
    expect(Object.keys(draft().edges)).toHaveLength(0);
  });

  it('selecting things is not a step', () => {
    const g = draft().initialNodeId;
    actions().select({ kind: 'node', id: g });
    actions().select({ kind: 'agent' });
    expect(steps()).toBe(0);
  });

  it('a change that changes nothing is not a step', () => {
    const { g } = buildTree();
    const n = steps();
    actions().moveNode(nodeNamed('A').id, g); // already there
    actions().deleteNode(g); // the start node can't be deleted
    expect(steps()).toBe(n);
  });

  it(`keeps at most ${HISTORY_LIMIT} steps, dropping the oldest`, () => {
    const g = draft().initialNodeId;
    for (let i = 0; i <= HISTORY_LIMIT + 4; i++) actions().updateNode(g, { end: i % 2 === 0 });
    expect(steps()).toBe(HISTORY_LIMIT);
  });

  it('is not saved to localStorage; only the agent is', () => {
    buildTree();
    const saved = JSON.parse(localStorage.getItem('agent-composer:draft')!).state;
    expect(Object.keys(saved)).toEqual(['draft']);
  });
});

describe('what can be undone', () => {
  it('moving a node with its subtree', () => {
    const { A, B, C, a, g } = buildTree();
    const before = draft();
    actions().moveNode(A, C);
    expect(draft().edges[a].sourceId).toBe(C);
    actions().undo();
    expect(draft()).toBe(before);
    expect(draft().edges[a].sourceId).toBe(g);
    expect(draft().nodes[B]).toBeDefined();
  });

  it('deleting a node brings back its whole subtree, and selects it', () => {
    const { A, B, b } = buildTree();
    actions().deleteNode(A);
    expect(draft().nodes[B]).toBeUndefined();
    actions().undo();
    expect(draft().nodes[A]).toBeDefined();
    expect(draft().nodes[B]).toBeDefined();
    expect(draft().edges[b].targetId).toBe(B);
    expect(state().selection).toEqual({ kind: 'node', id: A });
  });

  it('deleting an edge, and editing, adding and removing fields', () => {
    const { a, c } = buildTree();
    actions().deleteEdge(c);
    actions().undo();
    expect(draft().edges[c]).toBeDefined();

    addField(a, { key: 'when', description: 'Time.' }); // add + edit: two steps
    const prop = draft().edges[a].properties[0];
    actions().updateProperty(a, prop.id, { required: false });
    actions().removeProperty(a, prop.id);
    actions().undo();
    expect(draft().edges[a].properties[0]).toMatchObject({ key: 'when', required: false });
    actions().undo();
    expect(draft().edges[a].properties[0].required).toBe(true);
  });

  it('importing an agent and resetting', () => {
    const { A } = buildTree();
    actions().reset();
    expect(draft().nodes[A]).toBeUndefined();
    actions().undo();
    expect(draft().nodes[A].name).toBe('A');

    actions().loadDraft({ ...draft(), name: 'Imported' });
    actions().undo();
    expect(draft().name).toBe('New agent');
  });
});

describe('typing', () => {
  it('consecutive edits to the same text field are one step', () => {
    const g = draft().initialNodeId;
    for (const text of ['H', 'He', 'Hel', 'Hell', 'Hello']) {
      actions().updateNode(g, { taskMessage: text });
      advance(200);
    }
    expect(steps()).toBe(1);
    actions().undo();
    expect(draft().nodes[g].taskMessage).toBe('');
  });

  it('a pause starts a new step', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 'Hello' });
    advance(MERGE_MS + 1);
    actions().updateNode(g, { taskMessage: 'Hello there' });
    expect(steps()).toBe(2);
    actions().undo();
    expect(draft().nodes[g].taskMessage).toBe('Hello');
  });

  it('switching field, or switching element, starts a new step', () => {
    const { a, A } = buildTree();
    advance(MERGE_MS + 1);
    const n = steps();
    actions().updateNode(A, { name: 'Ab' });
    actions().updateNode(A, { taskMessage: 'x' });
    actions().updateEdge(a, { function: 'ab' });
    actions().updateAgent({ name: 'X' });
    expect(steps()).toBe(n + 4);
  });

  it('toggles are never merged, even when quick', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { end: true });
    actions().updateNode(g, { end: false });
    expect(steps()).toBe(2);
  });

  it('undo ends the current typing step, so typing again after it is a new step', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 'one' });
    advance(MERGE_MS + 1);
    actions().updateNode(g, { taskMessage: 'one two' });
    actions().undo();
    actions().updateNode(g, { taskMessage: 'one three' });
    expect(steps()).toBe(2);
    actions().undo();
    expect(draft().nodes[g].taskMessage).toBe('one');
  });
});

describe('selection after undo / redo', () => {
  it('closes the panel when the selected element is undone away', () => {
    const g = draft().initialNodeId;
    actions().addEdge(g); // selects the new edge
    actions().undo();
    expect(state().selection).toBeNull();
  });

  it('keeps the selection when it still exists', () => {
    const { A } = buildTree();
    actions().select({ kind: 'node', id: A });
    actions().updateNode(A, { end: true });
    actions().undo();
    expect(state().selection).toEqual({ kind: 'node', id: A });
  });

  it('selects what redo brings back', () => {
    const g = draft().initialNodeId;
    const e = addEdge(g);
    addNode(e);
    actions().undo();
    actions().undo();
    actions().redo();
    expect(state().selection).toEqual({ kind: 'edge', id: e });
  });
});
