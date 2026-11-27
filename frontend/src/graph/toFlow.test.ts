import { describe, expect, it } from 'vitest';
import { actions, addEdge, addNode, draft } from '../test/helpers';
import { NODE_H, NODE_W, PILL_W, toFlow, type FlowNode } from './toFlow';

const flow = (errored = new Set<string>()) => toFlow(draft(), null, errored);
const byId = (nodes: FlowNode[], id: string) => nodes.find((n) => n.id === id)!;
const centreX = (n: FlowNode) => n.position.x + n.width! / 2;

describe('toFlow: elements', () => {
  it('renders the lone Greeting node as the start node', () => {
    const { nodes, edges } = flow();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: 'agentNode',
      width: NODE_W,
      height: NODE_H,
      data: { name: 'Greeting', isStart: true, isEnd: false, selected: false, hasError: false },
    });
    expect(edges).toEqual([]);
  });

  it('draws each agent edge as a pill node with connectors around it', () => {
    const g = draft().initialNodeId;
    const dangling = addEdge(g, { function: 'pending' });
    const linked = addEdge(g, { function: 'go' });
    const target = addNode(linked);
    const { nodes, edges } = flow();

    expect(byId(nodes, dangling)).toMatchObject({ type: 'edgePill', data: { label: 'pending', dangling: true } });
    expect(byId(nodes, linked)).toMatchObject({ type: 'edgePill', data: { label: 'go', dangling: false } });
    expect(edges.map((e) => [e.source, e.target])).toEqual([
      [g, dangling],
      [g, linked],
      [linked, target],
    ]);
    // Only the pill -> target connector has an arrowhead.
    expect(edges.map((e) => Boolean(e.markerEnd))).toEqual([false, false, true]);
  });

  it('falls back to placeholder labels for blank names', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { name: '  ' });
    const e = addEdge(g, { function: '' });
    const { nodes } = flow();
    expect(byId(nodes, g).data).toMatchObject({ name: 'Untitled node' });
    expect(byId(nodes, e).data).toMatchObject({ label: 'unnamed_edge' });
  });

  it('marks the selected and errored elements', () => {
    const g = draft().initialNodeId;
    const e = addEdge(g);
    const { nodes } = toFlow(draft(), { kind: 'edge', id: e }, new Set([g]));
    expect(byId(nodes, e).data).toMatchObject({ selected: true, hasError: false });
    expect(byId(nodes, g).data).toMatchObject({ selected: false, hasError: true });
  });

  it('flags ending nodes', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { end: true });
    expect(flow().nodes[0].data).toMatchObject({ isEnd: true });
  });
});

describe('toFlow: layout', () => {
  it('spreads sibling edges evenly under their node, left to right in creation order', () => {
    const g = draft().initialNodeId;
    const ids = [addEdge(g), addEdge(g), addEdge(g)];
    const { nodes } = flow();
    const pills = ids.map((id) => byId(nodes, id));

    const xs = pills.map((p) => p.position.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);
    expect(xs[1] - xs[0]).toBeGreaterThan(PILL_W); // no overlap
    expect(new Set(pills.map((p) => p.position.y)).size).toBe(1);

    // Parent centred over its children.
    const parent = byId(nodes, g);
    expect(centreX(parent)).toBeCloseTo((centreX(pills[0]) + centreX(pills[2])) / 2);
    expect(pills[0].position.y).toBeGreaterThan(parent.position.y + NODE_H);
  });

  it('stacks node -> pill -> node top to bottom, aligned on a single chain', () => {
    const g = draft().initialNodeId;
    const e = addEdge(g);
    const n = addNode(e);
    const { nodes } = flow();
    const [top, mid, bottom] = [byId(nodes, g), byId(nodes, e), byId(nodes, n)];
    expect(top.position.y).toBeLessThan(mid.position.y);
    expect(mid.position.y).toBeLessThan(bottom.position.y);
    expect(centreX(top)).toBeCloseTo(centreX(mid));
    expect(centreX(mid)).toBeCloseTo(centreX(bottom));
  });

  it('gives wide subtrees enough room that nothing overlaps', () => {
    const g = draft().initialNodeId;
    const left = addNode(addEdge(g));
    addNode(addEdge(g));
    for (let i = 0; i < 3; i++) addEdge(left); // left subtree is three pills wide
    const { nodes } = flow();

    const rows = new Map<number, FlowNode[]>();
    for (const n of nodes) rows.set(n.position.y, [...(rows.get(n.position.y) ?? []), n]);
    for (const row of rows.values()) {
      const sorted = [...row].sort((a, b) => a.position.x - b.position.x);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].position.x).toBeGreaterThanOrEqual(sorted[i - 1].position.x + sorted[i - 1].width!);
      }
    }
  });
});
