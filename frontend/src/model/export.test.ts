import { describe, expect, it } from 'vitest';
import example from '../../../backend/example_flow.json';
import { actions, addEdge, addField, addNode, buildExampleFlow, draft } from '../test/helpers';
import { exportAgent } from './export';

describe('exportAgent', () => {
  it('reproduces backend/example_flow.json exactly when the example is built in the editor', () => {
    buildExampleFlow();
    expect(exportAgent(draft())).toEqual(example);
  });

  it('lists nodes breadth-first from the initial node', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 't' });
    const a = addEdge(g, { function: 'a', description: 'd' });
    const b = addEdge(g, { function: 'b', description: 'd' });
    const A = addNode(a, { name: 'A', taskMessage: 't' });
    addNode(b, { name: 'B', taskMessage: 't', end: true });
    addNode(addEdge(A, { function: 'deeper', description: 'd' }), { name: 'A1', taskMessage: 't', end: true });

    expect(exportAgent(draft()).nodes.map((n) => n.name)).toEqual(['Greeting', 'A', 'B', 'A1']);
  });

  it('uses node names for initial_node and edge targets', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { name: 'start', taskMessage: 't' });
    const n = addNode(addEdge(g, { function: 'go', description: 'd' }), { name: 'next', taskMessage: 't' });
    actions().updateNode(n, { name: 'renamed' });

    const out = exportAgent(draft());
    expect(out.initial_node).toBe('start');
    expect(out.nodes[0].edges![0].target).toBe('renamed');
  });

  it('omits optional keys when unused and trims text', () => {
    const g = draft().initialNodeId;
    actions().updateAgent({ name: '  Bot  ' });
    actions().updateNode(g, { name: ' Hi ', taskMessage: '  say hi  ', roleMessage: '   ', end: true });

    const out = exportAgent(draft());
    expect(out.name).toBe('Bot');
    expect(out.nodes[0]).toEqual({
      name: 'Hi',
      task_messages: [{ role: 'developer', content: 'say hi' }],
      end: true,
    });
  });

  it('includes role_message only when overridden', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 't', roleMessage: 'Be terse.' });
    expect(exportAgent(draft()).nodes[0]).toMatchObject({ role_message: 'Be terse.' });
  });

  it('converts edge fields to JSON-schema properties', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 't' });
    const e = addEdge(g, { function: 'go', description: 'd' });
    addNode(e, { taskMessage: 't', end: true });
    addField(e, { key: 'choice', description: '', enumText: ' a, ,b , ' });
    addField(e, { key: 'note', description: 'free text', required: false });
    addField(e, { key: 'count', description: 'how many' });
    const count = draft().edges[e].properties[2];
    // enumText is ignored for non-string types
    actions().updateProperty(e, count.id, { type: 'integer', enumText: 'x,y' });

    expect(exportAgent(draft()).nodes[0].edges![0]).toEqual({
      function: 'go',
      description: 'd',
      target: 'node_1',
      properties: {
        choice: { type: 'string', enum: ['a', 'b'] },
        note: { type: 'string', description: 'free text' },
        count: { type: 'integer', description: 'how many' },
      },
      required: ['choice', 'count'],
    });
  });
});
