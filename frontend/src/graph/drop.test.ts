import { describe, expect, it } from 'vitest';
import { buildTree, draft } from '../test/helpers';
import { resolveDrop } from './drop';

describe('resolveDrop', () => {
  it('node onto another node is a move', () => {
    const { A, C } = buildTree();
    expect(resolveDrop(draft(), { kind: 'node', id: A }, C)).toEqual({ ok: true, action: 'move' });
  });

  it('node onto its own subtree, or the start node being dragged, is refused', () => {
    const { g, A, B } = buildTree();
    expect(resolveDrop(draft(), { kind: 'node', id: A }, B)).toMatchObject({ ok: false });
    expect(resolveDrop(draft(), { kind: 'node', id: g }, A)).toMatchObject({ ok: false });
  });

  it('edge onto any other node is a repoint, including loops back up', () => {
    const { g, a, b, A, C } = buildTree();
    expect(resolveDrop(draft(), { kind: 'edge', id: a }, C)).toEqual({ ok: true, action: 'repoint' });
    expect(resolveDrop(draft(), { kind: 'edge', id: b }, g)).toEqual({ ok: true, action: 'repoint' });
    expect(resolveDrop(draft(), { kind: 'edge', id: b }, A)).toEqual({ ok: true, action: 'repoint' }); // self-loop
  });

  it('edge onto the node it already points to does nothing', () => {
    const { a, A } = buildTree();
    expect(resolveDrop(draft(), { kind: 'edge', id: a }, A)).toEqual({
      ok: false,
      reason: 'The edge already points here.',
    });
  });

  it('unknown targets are refused', () => {
    const { a } = buildTree();
    expect(resolveDrop(draft(), { kind: 'edge', id: a }, 'nope')).toMatchObject({ ok: false });
  });
});
