import { describe, expect, it } from 'vitest';
import example from '../../../backend/example_flow.json';
import newAgent from '../../e2e/fixtures/new_agent.json';
import { exportAgent } from './export';
import { importAgent, importAgentData, type ImportResult } from './import';
import { validate } from './validate';

type Agent = Record<string, unknown> & { nodes: Record<string, unknown>[] };

/** A small valid agent: start --go--> done. Tweak a deep copy per test. */
function agent(): Agent {
  return {
    name: 'Test agent',
    voice_id: 'voice',
    model: 'gpt-4o',
    persona: 'Be nice.',
    initial_node: 'start',
    nodes: [
      {
        name: 'start',
        task_messages: [{ role: 'developer', content: 'Say hi.' }],
        edges: [
          {
            function: 'go',
            description: 'Move on.',
            target: 'done',
            properties: { who: { type: 'string', description: 'Name.', enum: ['a', 'b'] } },
            required: ['who'],
          },
        ],
      },
      { name: 'done', task_messages: [{ role: 'developer', content: 'Bye.' }], end: true },
    ],
  };
}

const ok = (r: ImportResult) => {
  if (!r.ok) throw new Error(`Expected success, got: ${r.errors.join(' | ')}`);
  return r;
};
const errorsOf = (data: unknown) => {
  const r = importAgentData(data);
  if (r.ok) throw new Error('Expected the import to fail');
  return r.errors;
};
const edgeOf = (a: Agent, node = 0) => (a.nodes[node].edges as Record<string, unknown>[])[0];

describe('round trip', () => {
  it.each([
    ['frontend/e2e/fixtures/new_agent.json', newAgent],
    ['backend/example_flow.json', example],
  ])('importing then exporting %s gives back the same JSON', (_, file) => {
    const { draft, warnings } = ok(importAgent(JSON.stringify(file)));
    expect(warnings).toEqual([]);
    expect(validate(draft)).toEqual([]);
    expect(exportAgent(draft)).toEqual(file);
  });

  it('maps fields onto the editor model', () => {
    const { draft } = ok(importAgentData(agent()));
    const nodes = Object.values(draft.nodes);
    const [edge] = Object.values(draft.edges);

    expect(draft).toMatchObject({ name: 'Test agent', voiceId: 'voice', model: 'gpt-4o', persona: 'Be nice.' });
    expect(draft.nodes[draft.initialNodeId].name).toBe('start');
    expect(nodes.map((n) => [n.name, n.taskMessage, n.end])).toEqual([
      ['start', 'Say hi.', false],
      ['done', 'Bye.', true],
    ]);
    expect(edge).toMatchObject({ function: 'go', description: 'Move on.', sourceId: draft.initialNodeId });
    expect(draft.nodes[edge.targetId!].name).toBe('done');
    expect(edge.properties).toEqual([
      { id: expect.any(String), key: 'who', type: 'string', description: 'Name.', required: true, enumText: 'a, b' },
    ]);
  });

  it('gives every import fresh ids', () => {
    const a = ok(importAgentData(agent())).draft;
    const b = ok(importAgentData(agent())).draft;
    expect(Object.keys(a.nodes)).not.toEqual(Object.keys(b.nodes));
  });

  it('applies the backend defaults for optional agent fields', () => {
    const data = agent();
    delete data.voice_id;
    delete data.model;
    delete data.persona;
    expect(ok(importAgentData(data)).draft).toMatchObject({ voiceId: '21m00Tcm4TlvDq8ikWAM', model: 'gpt-4o', persona: '' });
  });

  it('a node without task_messages or edges is fine', () => {
    const data = agent();
    data.nodes[1] = { name: 'done' };
    const done = Object.values(ok(importAgentData(data)).draft.nodes)[1];
    expect(done).toMatchObject({ taskMessage: '', end: false, roleMessage: '' });
  });
});

describe('errors (the file is rejected)', () => {
  it('rejects text that is not JSON, or not an object', () => {
    expect(importAgent('{ nope')).toMatchObject({ ok: false, errors: [expect.stringContaining('Not valid JSON')] });
    expect(errorsOf([1, 2])).toEqual(['The file must contain a JSON object describing one agent.']);
  });

  it('requires name, initial_node and a non-empty node list', () => {
    expect(errorsOf({ nodes: [] })).toEqual([
      'Agent: "name" is required and must be a string.',
      'Agent: "initial_node" is required and must be a string.',
      'Agent: "nodes" must be a non-empty list.',
    ]);
  });

  it('rejects duplicate node names and an unknown initial node', () => {
    const dup = agent();
    dup.nodes[1].name = 'start';
    expect(errorsOf(dup)).toEqual(['Node "start" is defined more than once.']);

    const missing = agent();
    missing.initial_node = 'nowhere';
    expect(errorsOf(missing)).toEqual(['Agent: initial_node "nowhere" is not one of the nodes.']);
  });

  it('rejects malformed nodes', () => {
    const data = agent();
    data.nodes.push({ name: '' });
    expect(errorsOf(data)).toEqual(['Node 3: must be an object with a non-empty "name".']);

    const bad = agent();
    bad.nodes[1].end = 'yes';
    bad.nodes[1].task_messages = 'hello';
    expect(errorsOf(bad)).toEqual([
      'Node "done": "task_messages" must be a list of { "role", "content" } objects.',
      'Node "done": "end" must be true or false.',
    ]);
  });

  it('rejects edges with missing fields or unknown targets', () => {
    const data = agent();
    delete edgeOf(data).description;
    expect(errorsOf(data)).toEqual(['Node "start", edge "go": "description" is required and must be a string.']);

    const lost = agent();
    edgeOf(lost).target = 'nowhere';
    expect(errorsOf(lost)).toEqual(['Node "start", edge "go": targets unknown node "nowhere".']);
  });

  it('rejects unsupported field types and malformed field lists', () => {
    const data = agent();
    edgeOf(data).properties = { tags: { type: 'array' } };
    edgeOf(data).required = [];
    expect(errorsOf(data)).toEqual([
      'Node "start", edge "go": field "tags" must have "type" "string", "number", "integer", "boolean".',
    ]);

    const req = agent();
    edgeOf(req).required = 'who';
    expect(errorsOf(req)).toEqual(['Node "start", edge "go": "required" must be a list of strings.']);
  });

  it('reports problems from every node, not just the first', () => {
    const data = agent();
    delete edgeOf(data).target;
    data.nodes[1].end = 'yes';
    expect(errorsOf(data)).toEqual([
      'Node "start", edge "go": "target" is required and must be a string.',
      'Node "done": "end" must be true or false.',
    ]);
  });
});

describe('errors: only tree-shaped agents', () => {
  const tail = 'The editor currently supports tree-shaped agents only: every node except the start is reached by exactly one edge.';

  it('rejects a loop back to the start node', () => {
    const data = agent();
    data.nodes[1].edges = [{ function: 'again', description: 'Again.', target: 'start' }];
    expect(errorsOf(data)).toEqual([
      'The start node "start" has incoming edges ("again" from "done"). Loops back to the start aren\'t supported yet.',
      tail,
    ]);
  });

  it('rejects a node reached by two edges', () => {
    const data = agent();
    (data.nodes[0].edges as unknown[]).push({ function: 'skip', description: 'Skip.', target: 'done' });
    expect(errorsOf(data)).toEqual([
      'Node "done" is the target of 2 edges ("go" from "start", "skip" from "start"). Shared nodes and loops aren\'t supported yet.',
      tail,
    ]);
  });

  it('rejects nodes not connected to the start, including detached cycles', () => {
    const data = agent();
    data.nodes.push({ name: 'island' });
    expect(errorsOf(data)).toEqual(['Not connected to the start node: "island".', tail]);

    const cycle = agent();
    cycle.nodes.push(
      { name: 'x', edges: [{ function: 'to_y', description: 'd', target: 'y' }] },
      { name: 'y', edges: [{ function: 'to_x', description: 'd', target: 'x' }] },
    );
    expect(errorsOf(cycle)).toEqual(['Not connected to the start node: "x", "y".', tail]);
  });
});

describe('warnings (imported, but something changed)', () => {
  const warningsOf = (data: unknown) => ok(importAgentData(data)).warnings;

  it('ignores unknown keys at every level, so typos are visible', () => {
    const data = agent();
    data.voice = 'x';
    data.nodes[1].edge = [];
    edgeOf(data).targte = 'done';
    expect(warningsOf(data)).toEqual([
      'Agent: ignored unknown key "voice".',
      'Node "start", edge "go": ignored unknown key "targte".',
      'Node "done": ignored unknown key "edge".',
    ]);
  });

  it('joins several task messages and normalises their role', () => {
    const data = agent();
    data.nodes[1].task_messages = [
      { role: 'system', content: 'One.' },
      { role: 'developer', content: 'Two.' },
    ];
    const r = ok(importAgentData(data));
    expect(Object.values(r.draft.nodes)[1].taskMessage).toBe('One.\n\nTwo.');
    expect(r.warnings).toEqual([
      'Node "done": its 2 task messages were joined into one.',
      'Node "done": task message roles other than "developer" will be exported as "developer".',
    ]);
  });

  it('drops pre/post actions the editor cannot represent', () => {
    const data = agent();
    data.nodes[0].pre_actions = [{ type: 'tts_say', text: 'Hi' }];
    data.nodes[1].post_actions = [{ type: 'end_conversation' }];
    expect(warningsOf(data)).toEqual([
      'Node "start": "pre_actions" isn\'t supported by the editor yet and was dropped.',
      'Node "done": "post_actions" isn\'t supported by the editor yet and was dropped.',
    ]);
  });

  it('drops enums on non-string fields, unknown field keys and stray required names', () => {
    const data = agent();
    edgeOf(data).properties = { count: { type: 'integer', enum: [1, 2], minimum: 0 } };
    edgeOf(data).required = ['count', 'ghost'];
    const r = ok(importAgentData(data));
    expect(r.warnings).toEqual([
      'Node "start", edge "go": required field "ghost" not in "properties" and ignored.',
      'Node "start", edge "go": field "count": allowed values are only supported for strings and were dropped.',
      'Node "start", edge "go": field "count": ignored "minimum".',
    ]);
    expect(Object.values(r.draft.edges)[0].properties[0]).toMatchObject({ key: 'count', type: 'integer', enumText: '', required: true });
  });
});
