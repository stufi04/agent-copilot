import { describe, expect, it } from 'vitest';
import tools from '../../../backend/copilot/tools.json';
import branching from '../../../backend/branching_flow.json';
import { applyTool, TOOL_NAMES } from './copilotOps';
import { describeAgent } from './describe';
import { exportAgent } from './export';
import { importAgentData } from './import';
import type { AgentDraft } from './types';
import { validate } from './validate';

// The clinic front desk: greeting branches three ways, rescheduling shares offer_times.
function clinic(): AgentDraft {
  const r = importAgentData(branching);
  if (!r.ok) throw new Error(r.errors.join());
  return r.draft;
}

type Exported = ReturnType<typeof exportAgent>;
const node = (json: Exported, name: string) => json.nodes.find((n) => n.name === name);
const edgesOf = (json: Exported, name: string) => (node(json, name)?.edges ?? []).map((e) => `${e.function}→${e.target}`);

/** Apply a tool that should work; return the new draft and its summary. */
function ok(d: AgentDraft, tool: string, args: object) {
  const { draft, result } = applyTool(d, tool, args);
  if (!result.ok) throw new Error(`${tool} failed: ${result.error}`);
  return { draft, summary: result.summary };
}

/** Apply a tool that should fail; check nothing changed and return the reason. */
function failure(d: AgentDraft, tool: string, args: unknown) {
  const { draft, result } = applyTool(d, tool, args);
  expect(draft).toBe(d);
  if (result.ok) throw new Error(`${tool} should have failed`);
  return result.error;
}

describe('copilot tools', () => {
  it('implements every tool the backend offers the model', () => {
    expect(TOOL_NAMES.sort()).toEqual(tools.map((t) => t.function.name).sort());
  });

  it('adds a branch: a node, then an edge to it, leaving the agent valid', () => {
    let d = clinic();
    ({ draft: d } = ok(d, 'add_node', { name: 'opening_hours', task_message: 'Give the opening hours, then say goodbye.', end: true }));
    expect(validate(d).map((i) => i.message)).toContain('Not connected to the start node.');

    const { draft, summary } = ok(d, 'add_edge', {
      from: 'greeting',
      function: 'ask_opening_hours',
      description: 'The caller asks when the clinic is open.',
      to: 'opening_hours',
    });
    expect(summary).toBe('Added edge "ask_opening_hours" from "greeting" to "opening_hours".');
    expect(validate(draft)).toEqual([]);
    const json = exportAgent(draft);
    expect(edgesOf(json, 'greeting')).toContain('ask_opening_hours→opening_hours');
    expect(node(json, 'opening_hours')).toMatchObject({ end: true, task_messages: [{ content: 'Give the opening hours, then say goodbye.' }] });
  });

  it('maps edge fields onto the properties the LLM collects', () => {
    const { draft } = ok(clinic(), 'add_edge', {
      from: 'appointment_kept',
      function: 'rate_call',
      description: 'The caller rates the call.',
      to: 'appointment_kept',
      fields: [
        { name: 'score', type: 'integer', description: 'From 1 to 5.' },
        { name: 'mood', type: 'string', enum: ['happy', 'sad'], required: false },
      ],
    });
    const edge = node(describeAgent(draft) as unknown as Exported, 'appointment_kept')!.edges![0];
    expect(edge).toMatchObject({
      properties: { score: { type: 'integer', description: 'From 1 to 5.' }, mood: { type: 'string', enum: ['happy', 'sad'] } },
      required: ['score'],
    });
  });

  it('renaming a node keeps the edges that lead to it', () => {
    const { draft, summary } = ok(clinic(), 'update_node', { name: 'offer_times', new_name: 'offer_slots' });
    expect(summary).toBe('Renamed node "offer_times" to "offer_slots".');
    const json = exportAgent(draft);
    expect(edgesOf(json, 'collect_details')).toEqual(['record_details→offer_slots']);
    expect(edgesOf(json, 'find_appointment_to_move')).toEqual(['record_appointment_to_move→offer_slots']);
  });

  it('updates only the node fields it is given', () => {
    const before = clinic();
    const { draft } = ok(before, 'update_node', { name: 'appointment_kept', task_message: 'Say it stays.', end: true });
    expect(node(exportAgent(draft), 'appointment_kept')).toEqual({
      name: 'appointment_kept',
      task_messages: [{ role: 'developer', content: 'Say it stays.' }],
      end: true,
    });
    expect(exportAgent(draft).nodes.length).toBe(exportAgent(before).nodes.length);
  });

  it('deleting a node takes what only it led to, and keeps shared nodes', () => {
    const cancel = ok(clinic(), 'delete_node', { name: 'find_appointment_to_cancel' });
    expect(cancel.summary).toBe(
      'Deleted node "find_appointment_to_cancel". It also removed "confirm_cancellation", "appointment_cancelled", "appointment_kept", which nothing else led to.',
    );
    // greeting's cancel edge now leads nowhere; the editor flags it.
    expect(describeAgent(cancel.draft).issues).toContain(
      'Error in edge "cancel_appointment" from "greeting": No target node yet. Hover the edge and click [+] to add one.',
    );

    // offer_times is also reached through collect_details, so it survives.
    const move = ok(clinic(), 'delete_node', { name: 'find_appointment_to_move' });
    expect(move.summary).toBe('Deleted node "find_appointment_to_move".');
    expect(node(describeAgent(move.draft) as unknown as Exported, 'offer_times')).toBeDefined();
  });

  it('updates, retargets and deletes edges', () => {
    let d = clinic();
    ({ draft: d } = ok(d, 'update_edge', {
      from: 'offer_times',
      function: 'no_time_works',
      new_function: 'neither_slot_works',
      description: 'Neither slot suits the caller.',
      to: 'appointment_kept',
    }));
    expect(edgesOf(describeAgent(d) as unknown as Exported, 'offer_times')).toEqual([
      'select_time→appointment_confirmed',
      'neither_slot_works→appointment_kept',
    ]);

    const deleted = ok(clinic(), 'delete_edge', { from: 'offer_times', function: 'no_time_works' });
    expect(deleted.summary).toBe('Deleted edge "no_time_works" from "offer_times". It also removed "arrange_callback", which nothing else led to.');
    expect(validate(deleted.draft)).toEqual([]);
  });

  it('moves the start node and edits the agent settings', () => {
    let d = clinic();
    ({ draft: d } = ok(d, 'set_start_node', { name: 'collect_details' }));
    expect(describeAgent(d).initial_node).toBe('collect_details');
    ({ draft: d } = ok(d, 'update_agent', { name: 'Front Desk', persona: 'Be brief.' }));
    expect(describeAgent(d)).toMatchObject({ name: 'Front Desk', persona: 'Be brief.' });
  });

  it('replaces the whole agent, keeping the voice and model unless it sets them', () => {
    const before = clinic();
    const { draft, summary } = ok(before, 'replace_agent', {
      agent: {
        name: 'Refills',
        initial_node: 'start',
        issues: [], // as shown to the model; ignored
        nodes: [
          { name: 'start', task_messages: [{ role: 'developer', content: 'Ask what they need.' }], edges: [{ function: 'done', description: 'Finished.', target: 'bye' }] },
          { name: 'bye', task_messages: [{ role: 'developer', content: 'Say bye.' }], end: true },
        ],
      },
    });
    expect(summary).toBe('Replaced the agent with "Refills" (2 nodes).');
    expect(draft).toMatchObject({ name: 'Refills', voiceId: before.voiceId, model: before.model });
    expect(validate(draft)).toEqual([]);

    expect(failure(before, 'replace_agent', { agent: { name: 'Broken', initial_node: 'nowhere', nodes: [{ name: 'a' }] } })).toBe(
      'The agent wasn\'t replaced: Agent: initial_node "nowhere" is not one of the nodes.',
    );
  });

  it.each([
    ['add_node', { name: 'greeting', task_message: 'x' }, 'A node named "greeting" already exists.'],
    ['add_node', { name: '  ', task_message: 'x' }, '"name" can\'t be empty.'],
    ['add_node', { name: 'x' }, '"task_message" is required.'],
    ['add_node', { name: 'x', task_message: 'y', end: 'yes' }, '"end" must be true or false.'],
    ['update_node', { name: 'nope' }, expect.stringMatching(/^There's no node named "nope". Nodes: greeting, collect_details, /)],
    ['update_node', { name: 'offer_times', new_name: 'greeting' }, 'A node named "greeting" already exists.'],
    ['delete_node', { name: 'greeting' }, '"greeting" is the start node and can\'t be deleted. Use set_start_node first.'],
    ['add_edge', { from: 'greeting', function: 'book_appointment', description: 'x', to: 'offer_times' }, 'Node "greeting" already has an edge called "book_appointment".'],
    ['add_edge', { from: 'greeting', function: 'f', description: 'x', to: 'nope' }, expect.stringMatching(/^There's no node named "nope"/)],
    ['add_edge', { from: 'greeting', function: 'f', description: 'x', to: 'offer_times', fields: [{ name: 'n', type: 'date' }] }, 'Field "n": "type" must be one of string, number, integer, boolean.'],
    ['update_edge', { from: 'greeting', function: 'nope' }, 'Node "greeting" has no edge called "nope". Its edges: book_appointment, reschedule_appointment, cancel_appointment.'],
    ['delete_edge', { from: 'appointment_kept', function: 'x' }, 'Node "appointment_kept" has no edge called "x". It has no edges.'],
    ['update_agent', {}, 'Give "name" and/or "persona".'],
    ['replace_agent', { agent: [] }, '"agent" must be a JSON object.'],
    ['fly', {}, 'There\'s no tool called "fly".'],
    ['add_node', 'not an object', 'The arguments must be a JSON object.'],
  ])('%s %j fails without changing anything', (tool, args, error) => {
    expect(failure(clinic(), tool, args)).toEqual(error);
  });
});

describe('describeAgent', () => {
  it('matches the export for a valid agent, plus an empty issues list', () => {
    const d = clinic();
    const { issues, ...rest } = describeAgent(d);
    expect(issues).toEqual([]);
    expect(rest).toEqual(exportAgent(d));
  });

  it('describes an agent mid-edit, which exportAgent can\'t', () => {
    let d = clinic();
    ({ draft: d } = ok(d, 'add_node', { name: 'loose_end', task_message: '' }));
    ({ draft: d } = ok(d, 'delete_node', { name: 'appointment_kept' })); // keep_appointment now leads nowhere

    const described = describeAgent(d);
    expect(described.nodes.at(-1)).toEqual({ name: 'loose_end', task_messages: [{ role: 'developer', content: '' }] });
    expect(node(described as unknown as Exported, 'confirm_cancellation')!.edges![1]).toMatchObject({ function: 'keep_appointment', target: null });
    expect(described.issues).toEqual([
      'Error in node "loose_end": Task message is required.',
      'Error in node "loose_end": Every branch must end the call: tick "Ends the call", or add an edge to carry on.',
      'Error in node "loose_end": Not connected to the start node.',
      'Error in edge "keep_appointment" from "confirm_cancellation": No target node yet. Hover the edge and click [+] to add one.',
    ]);
  });
});
