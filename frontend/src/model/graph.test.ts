import { describe, expect, it } from 'vitest';
import { addEdge, buildTree, draft, forceTarget } from '../test/helpers';
import { canMoveNode, nodesRemovedBy, reachableFrom, spanningTree, treeSubtree } from './graph';

const tree = buildTree;

describe('reachableFrom', () => {
  it('follows edges from a node, optionally avoiding one', () => {
    const { g, A, B, C } = tree();
    expect(reachableFrom(draft(), A)).toEqual(new Set([A, B]));
    expect(reachableFrom(draft(), g)).toEqual(new Set([g, A, B, C]));
    expect(reachableFrom(draft(), g, A)).toEqual(new Set([g, C]));
  });
});

describe('spanningTree', () => {
  it('for a tree, every edge is the parent of its target', () => {
    const { g, a, A, b, B, c, C } = tree();
    const t = spanningTree(draft());
    expect(t.roots).toEqual([g]);
    expect(t.parentEdge).toEqual(new Map([[A, a], [C, c], [B, b]]));
  });
});

describe('treeSubtree', () => {
  it('is the node, its edges and what hangs under them', () => {
    const { a, A, b, B, c, C, g } = tree();
    expect(treeSubtree(draft(), A)).toEqual({ nodes: new Set([A, B]), edges: new Set([b]) });
    expect(treeSubtree(draft(), g)).toEqual({ nodes: new Set([g, A, B, C]), edges: new Set([a, b, c]) });
  });
});

describe('nodesRemovedBy', () => {
  it('deleting a node takes its subtree', () => {
    const { A, B } = tree();
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A, B]));
  });

  it('deleting an edge takes the subtree it leads to', () => {
    const { a, A, B } = tree();
    expect(nodesRemovedBy(draft(), { kind: 'edge', id: a })).toEqual(new Set([A, B]));
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
});

describe('malformed drafts (loops, shared nodes) do not hang', () => {
  it('a loop back to the start', () => {
    const { g, A, B, C } = tree();
    const loop = addEdge(B, { function: 'loop' });
    forceTarget(loop, g);
    expect(reachableFrom(draft(), B)).toEqual(new Set([g, A, B, C]));
    expect([...spanningTree(draft()).parentEdge.values()]).not.toContain(loop);
    expect(treeSubtree(draft(), A).nodes).toEqual(new Set([A, B]));
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A, B])); // never the start
  });

  it('a node reached by two edges is laid out once, under the first', () => {
    const { a, A, C } = tree();
    const shared = addEdge(C, { function: 'shared' });
    forceTarget(shared, A);
    expect(spanningTree(draft()).parentEdge.get(A)).toBe(a);
  });
});
