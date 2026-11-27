import { describe, expect, it } from 'vitest';
import { actions, addEdge, addNode, buildTree, draft } from '../test/helpers';
import type { AgentDraft } from '../model/types';
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

describe('toFlow: graphs that are not trees', () => {
  // A saved or imported agent may have loops and shared nodes that were never drawn
  // through the editor. Laying it out must not hang or crash the page.
  it('lays out a loop back to the start without recursing forever', () => {
    const d = draft();
    const g = d.initialNodeId;
    const looped: AgentDraft = {
      ...d,
      nodes: { ...d.nodes, c: { id: 'c', name: 'Confirm', taskMessage: '', roleMessage: '', end: false } },
      edges: {
        e1: { id: 'e1', sourceId: g, targetId: 'c', function: 'go', description: '', properties: [] },
        e2: { id: 'e2', sourceId: 'c', targetId: g, function: 'again', description: '', properties: [] },
        e3: { id: 'e3', sourceId: g, targetId: 'c', function: 'skip', description: '', properties: [] },
      },
    };
    const { nodes, edges } = toFlow(looped, null, new Set());
    const pos = (id: string) => nodes.find((n) => n.id === id)!.position;
    expect(nodes).toHaveLength(5);
    expect(pos('c').y).toBeGreaterThan(pos(g).y); // placed once, below the start, under its first edge
    expect(pos('e2').y).toBeGreaterThan(pos('c').y);
    expect(edges.map((e) => e.id)).toEqual(expect.arrayContaining(['e2->' + g, 'e3->c']));
  });
});

describe('toFlow: drag & drop and non-tree graphs', () => {
  it('the start node is not draggable; other nodes and pills are', () => {
    const { g, a, A } = buildTree();
    const { nodes } = flow();
    expect(byId(nodes, g).draggable).toBe(false);
    expect(byId(nodes, A).draggable).toBe(true);
    expect(byId(nodes, a).draggable).toBeUndefined(); // React Flow default: draggable
  });

  it('a loop is drawn as a dashed link and does not move its target', () => {
    const { g, B } = buildTree();
    const before = flow().nodes;
    const loop = addEdge(B, { function: 'loop' });
    actions().repointEdge(loop, g);
    const { nodes, edges } = flow();

    const link = edges.find((e) => e.id === `${loop}->${g}`)!;
    expect(link).toMatchObject({ className: 'link-edge', sourceHandle: 'link', targetHandle: 'link' });
    expect(link.style).toMatchObject({ strokeDasharray: '6 4' });
    expect(byId(nodes, g).position.y).toBe(byId(before, g).position.y); // start node still on top
    expect(byId(nodes, loop).position.y).toBeGreaterThan(byId(nodes, B).position.y); // pill under its source
  });

  it('tree edges are drawn solid', () => {
    const { a, A } = buildTree();
    expect(flow().edges.find((e) => e.id === `${a}->${A}`)!.className).toBeUndefined();
  });

  it('a disconnected part is flagged and laid out to the right of the main tree', () => {
    const { a, A, B, C, g } = buildTree();
    actions().repointEdge(a, C);
    const { nodes } = flow();

    expect(byId(nodes, A).data).toMatchObject({ unreachable: true });
    expect(byId(nodes, B).data).toMatchObject({ unreachable: true });
    expect(byId(nodes, C).data).toMatchObject({ unreachable: false });
    const mainRight = Math.max(
      ...[g, C, a].map((id) => byId(nodes, id).position.x + byId(nodes, id).width!),
    );
    expect(byId(nodes, A).position.x).toBeGreaterThan(mainRight);
    expect(byId(nodes, B).position.y).toBeGreaterThan(byId(nodes, A).position.y); // its own subtree kept
  });

  it('marks the node under a drag as a valid or invalid drop target', () => {
    const { A, C } = buildTree();
    const valid = toFlow(draft(), null, new Set(), { nodeId: C, state: 'valid' });
    expect(byId(valid.nodes, C).data).toMatchObject({ drop: 'valid' });
    expect(byId(valid.nodes, A).data).toMatchObject({ drop: null });
    const invalid = toFlow(draft(), null, new Set(), { nodeId: C, state: 'invalid' });
    expect(byId(invalid.nodes, C).data).toMatchObject({ drop: 'invalid' });
  });
});

