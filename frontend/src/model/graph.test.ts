import { describe, expect, it } from 'vitest';
import { actions, addEdge, buildTree, draft } from '../test/helpers';
import { canMoveNode, nodesRemovedBy, reachableFrom, reachableNodes, spanningTree, treeSubtree } from './graph';

const tree = buildTree;

describe('reachability', () => {
  it('follows edges from a node, optionally avoiding one', () => {
    const { g, A, B, C } = tree();
    expect(reachableFrom(draft(), A)).toEqual(new Set([A, B]));
    expect(reachableNodes(draft())).toEqual(new Set([g, A, B, C]));
    expect(reachableFrom(draft(), g, A)).toEqual(new Set([g, C]));
  });

  it('handles loops without walking forever', () => {
    const { g, A, B, C } = tree();
    actions().repointEdge(addEdge(B, { function: 'again' }), g); // B loops back to the start
    expect(reachableFrom(draft(), B)).toEqual(new Set([g, A, B, C]));
  });

  it('nodes cut off from the start are unreachable', () => {
    const { a, A, B, C } = tree();
    actions().repointEdge(a, C); // a now goes to C; A and B are cut off
    expect(reachableNodes(draft()).has(A)).toBe(false);
    expect(reachableNodes(draft()).has(B)).toBe(false);
  });
});

describe('spanningTree', () => {
  it('for a plain tree, every edge is the parent of its target', () => {
    const { g, a, A, b, B, c, C } = tree();
    const t = spanningTree(draft());
    expect(t.roots).toEqual([g]);
    expect(t.parentEdge).toEqual(new Map([[A, a], [C, c], [B, b]]));
  });

  it('a second edge into a node, or a loop, is not a tree edge', () => {
    const { g, A, B, C } = tree();
    const loop = addEdge(B, { function: 'loop' });
    actions().repointEdge(loop, g);
    const shared = addEdge(C, { function: 'shared' });
    actions().repointEdge(shared, A);
    const t = spanningTree(draft());
    expect([...t.parentEdge.values()]).not.toContain(loop);
    expect([...t.parentEdge.values()]).not.toContain(shared);
    expect(t.parentEdge.has(g)).toBe(false);
    expect(t.parentEdge.get(A)).toBe(Object.values(draft().edges).find((e) => e.function === 'a')!.id);
  });

  it('disconnected parts become extra roots, top node first', () => {
    const { g, a, A, b, B, C } = tree();
    actions().repointEdge(a, C);
    const t = spanningTree(draft());
    expect(t.roots).toEqual([g, A]);
    expect(t.parentEdge.get(B)).toBe(b);
  });
});

describe('treeSubtree', () => {
  it('is the node, its edges and what hangs under them', () => {
    const { a, A, b, B, c, C, g } = tree();
    expect(treeSubtree(draft(), A)).toEqual({ nodes: new Set([A, B]), edges: new Set([b]) });
    expect(treeSubtree(draft(), g)).toEqual({ nodes: new Set([g, A, B, C]), edges: new Set([a, b, c]) });
  });

  it('includes a loop edge but not the node it loops to', () => {
    const { g, A, b, B } = tree();
    const loop = addEdge(B, { function: 'loop' });
    actions().repointEdge(loop, g);
    expect(treeSubtree(draft(), A)).toEqual({ nodes: new Set([A, B]), edges: new Set([b, loop]) });
  });
});

describe('nodesRemovedBy', () => {
  it('deleting a node takes what only it leads to', () => {
    const { A, B } = tree();
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A, B]));
  });

  it('a loop back to the start never takes the start with it', () => {
    const { g, A, B } = tree();
    actions().repointEdge(addEdge(B, { function: 'loop' }), g);
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A, B]));
  });

  it('a node still reachable another way survives', () => {
    const { A, B, C } = tree();
    actions().repointEdge(addEdge(C, { function: 'shared' }), B); // C also leads to B
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A]));
  });

  it('deleting an edge takes only what it alone connected', () => {
    const { a, A, B, C } = tree();
    expect(nodesRemovedBy(draft(), { kind: 'edge', id: a })).toEqual(new Set([A, B]));
    const link = addEdge(C, { function: 'link' });
    actions().repointEdge(link, A);
    expect(nodesRemovedBy(draft(), { kind: 'edge', id: a })).toEqual(new Set());
    expect(nodesRemovedBy(draft(), { kind: 'edge', id: link })).toEqual(new Set());
  });

  it('deleting a dangling edge removes no nodes', () => {
    const e = addEdge(draft().initialNodeId);
    expect(nodesRemovedBy(draft(), { kind: 'edge', id: e })).toEqual(new Set());
  });
});

describe('canMoveNode', () => {
  it('allows moving a node under another branch', () => {
    const { A, C } = tree();
    expect(canMoveNode(draft(), A, C)).toEqual({ ok: true });
  });

  it('refuses the start node, itself, and its own subtree', () => {
    const { g, A, B, C } = tree();
    expect(canMoveNode(draft(), g, C)).toMatchObject({ ok: false, reason: expect.stringContaining('start node') });
    expect(canMoveNode(draft(), A, A)).toMatchObject({ ok: false, reason: expect.stringContaining('itself') });
    expect(canMoveNode(draft(), A, B)).toMatchObject({ ok: false, reason: expect.stringContaining('own subtree') });
  });

  it('a loop back up does not block moving under an ancestor', () => {
    const { g, B, C } = tree();
    actions().repointEdge(addEdge(B, { function: 'loop' }), g);
    expect(canMoveNode(draft(), B, C)).toEqual({ ok: true });
    expect(canMoveNode(draft(), B, g)).toEqual({ ok: true });
  });
});
