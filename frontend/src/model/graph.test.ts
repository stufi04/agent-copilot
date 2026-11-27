import { describe, expect, it } from 'vitest';
import { actions, addEdge, buildTree, draft } from '../test/helpers';
import { canAttachNode, canMoveEdge, depths, edgeSubtree, nodesRemovedBy, reachableFrom, spanningTree, treeSubtree } from './graph';

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

describe('depths and edgeSubtree', () => {
  it('depth counts nodes down the tree from the start', () => {
    const { g, A, B, C } = tree();
    expect(depths(draft())).toEqual(new Map([[g, 0], [A, 1], [C, 1], [B, 2]]));
  });

  it("a tree edge carries its target's subtree; a link carries nothing", () => {
    const { g, a, A, b, B } = tree();
    expect(edgeSubtree(draft(), a)).toEqual({ nodes: new Set([A, B]), edges: new Set([a, b]) });
    actions().linkNodes(B, g);
    const loop = Object.values(draft().edges).find((e) => e.targetId === g)!.id;
    expect(edgeSubtree(draft(), loop)).toEqual({ nodes: new Set(), edges: new Set([loop]) });
  });
});

describe('canAttachNode / canMoveEdge', () => {
  it('a node can go onto an empty edge elsewhere', () => {
    const { A, C } = tree();
    const empty = addEdge(C);
    expect(canAttachNode(draft(), A, empty)).toEqual({ ok: true });
  });

  it('an edge can move to any node not below its own target', () => {
    const { a, b, B, C, g } = tree();
    expect(canMoveEdge(draft(), a, C)).toEqual({ ok: true });
    expect(canMoveEdge(draft(), b, g)).toEqual({ ok: true });
    expect(canMoveEdge(draft(), a, B)).toMatchObject({ ok: false });
  });
});

describe('loops and shared nodes', () => {
  it('a loop back to the start', () => {
    const { g, A, B, C } = tree();
    actions().linkNodes(B, g);
    const loop = Object.values(draft().edges).find((e) => e.targetId === g)!.id;
    expect(reachableFrom(draft(), B)).toEqual(new Set([g, A, B, C]));
    expect([...spanningTree(draft()).parentEdge.values()]).not.toContain(loop);
    expect(treeSubtree(draft(), A).nodes).toEqual(new Set([A, B]));
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A, B])); // never the start
  });

  it('a node reached by two edges is laid out once, under the first, and survives losing one', () => {
    const { a, A, B, C } = tree();
    actions().linkNodes(C, B); // C also leads to B
    expect(spanningTree(draft()).parentEdge.get(A)).toBe(a);
    expect(nodesRemovedBy(draft(), { kind: 'node', id: A })).toEqual(new Set([A]));
  });
});
