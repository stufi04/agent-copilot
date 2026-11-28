import { describe, expect, it } from 'vitest';
import { exportAgent } from '../model/export';
import { useEditor } from '../model/store';
import { toWire, type ChatRequest, type ToolCall } from './chatApi';
import { checkMessage, MAX_STEPS, setChatStream, useCopilot } from './copilot';

// The copilot editing the graph: the model's tool calls are applied to the editor,
// the results go back to it, and everything one reply changed undoes in one step.

type Step = { text?: string; calls?: ToolCall[] } | 'hang';

/** A backend that plays the given steps in order, recording each request. */
function scripted(steps: Step[]) {
  const requests: ChatRequest[] = [];
  setChatStream(async (request, onDelta, signal) => {
    requests.push(structuredClone(request));
    const step = steps[requests.length - 1] ?? { text: 'Done.' };
    if (step === 'hang')
      return new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    if (step.text) onDelta(step.text);
    return step.calls;
  });
  return requests;
}

let n = 0;
const call = (name: string, args: object): ToolCall => ({ id: `call_${++n}`, name, arguments: JSON.stringify(args) });

const addBye = call('add_node', { name: 'bye', task_message: 'Say goodbye.', end: true });
const linkBye = call('add_edge', { from: 'Greeting', function: 'done', description: 'The caller is done.', to: 'bye' });

const editor = () => useEditor.getState();
const copilot = () => useCopilot.getState();
const nodeNames = () => Object.values(editor().draft.nodes).map((n) => n.name);

describe('copilot editing the graph', () => {
  it('applies the tool calls, reports back, and asks again until the model just replies', async () => {
    const requests = scripted([{ text: 'Adding a goodbye.', calls: [addBye] }, { calls: [linkBye] }, { text: 'Added a goodbye branch.' }]);
    await copilot().send('Add a goodbye');

    expect(nodeNames()).toEqual(['Greeting', 'bye']);
    expect(Object.values(editor().draft.edges)).toMatchObject([{ function: 'done', description: 'The caller is done.' }]);
    expect(requests).toHaveLength(3);

    // Each request shows the model the graph as it is by then.
    expect(requests[0].agent).toMatchObject({ nodes: [{ name: 'Greeting' }] });
    expect(requests[1].agent).toMatchObject({ nodes: [{ name: 'Greeting' }, { name: 'bye' }] });

    // ...and carries the earlier steps: the model's calls and what came of them.
    expect(requests[1].messages).toEqual([
      { role: 'user', content: 'Add a goodbye' },
      { role: 'assistant', content: 'Adding a goodbye.', toolCalls: [addBye] },
      {
        role: 'tool',
        toolCallId: addBye.id,
        ok: true,
        summary: 'Added node "bye".',
        content: JSON.stringify({
          ok: true,
          result: 'Added node "bye".',
          issues: [
            'Error in node "Greeting": Task message is required.',
            'Error in node "Greeting": Every branch must end the call: tick "Ends the call", or add an edge to carry on.',
            'Error in node "bye": Not connected to the start node.',
          ],
        }),
      },
    ]);
    expect(copilot()).toMatchObject({ status: 'idle', error: null });
    expect(copilot().messages.at(-1)).toEqual({ role: 'assistant', content: 'Added a goodbye branch.' });
  });

  it('a whole reply is one undo step, however many edits it made', async () => {
    const before = editor().draft;
    scripted([{ calls: [addBye] }, { calls: [linkBye] }, { text: 'Done.' }]);
    await copilot().send('Add a goodbye');

    expect(copilot().lastChange).toBe(editor().draft);
    editor().undo();
    expect(editor().draft).toBe(before);
    editor().redo();
    expect(nodeNames()).toEqual(['Greeting', 'bye']);
  });

  it('your own edit in the middle of a reply is a separate undo step', async () => {
    const before = editor().draft;
    let release = () => {};
    const requests: ChatRequest[] = [];
    setChatStream(async (request) => {
      requests.push(request);
      if (requests.length === 1) return [addBye];
      if (requests.length === 2) {
        await new Promise<void>((r) => (release = r)); // the model is "thinking"
        return [linkBye];
      }
    });
    const sending = copilot().send('Add a goodbye');
    await new Promise((r) => setTimeout(r));
    editor().updateAgent({ name: 'Mine' }); // the user edits while the copilot works
    release();
    await sending;

    editor().undo(); // the copilot's later edit
    expect(Object.keys(editor().draft.edges)).toHaveLength(0);
    expect(editor().draft.name).toBe('Mine');
    editor().undo(); // the user's edit
    editor().undo(); // the copilot's first edit
    expect(editor().draft).toBe(before);
  });

  it('a tool that fails changes nothing and the model is told why', async () => {
    const before = editor().draft;
    const bad = call('delete_node', { name: 'Greeting' });
    const broken: ToolCall = { id: 'call_x', name: 'add_node', arguments: '{"name": ' };
    const requests = scripted([{ calls: [bad, broken] }, { text: 'Sorry, I can\'t.' }]);
    await copilot().send('Delete everything');

    expect(editor().draft).toBe(before);
    expect(requests[1].messages.slice(2)).toEqual([
      expect.objectContaining({ ok: false, summary: 'delete_node: "Greeting" is the start node and can\'t be deleted. Use set_start_node first.' }),
      expect.objectContaining({ ok: false, content: JSON.stringify({ ok: false, error: 'The arguments were not valid JSON.' }) }),
    ]);
    expect(copilot().lastChange).toBeNull(); // nothing to undo
  });

  it(`gives up after ${MAX_STEPS} steps, keeping the edits made`, async () => {
    const steps: Step[] = Array.from({ length: MAX_STEPS + 2 }, (_, i) => ({
      calls: [call('update_agent', { name: `Name ${i}` })],
    }));
    const requests = scripted(steps);
    await copilot().send('Keep renaming');

    expect(requests).toHaveLength(MAX_STEPS);
    expect(editor().draft.name).toBe(`Name ${MAX_STEPS - 1}`);
    expect(copilot()).toMatchObject({ status: 'error', error: expect.stringContaining(`stopped after ${MAX_STEPS} steps`) });
    expect(copilot().lastChange).toBe(editor().draft);
  });

  it('Stop during a later step keeps the edits already made, undoable in one step', async () => {
    const before = editor().draft;
    scripted([{ calls: [addBye] }, 'hang']);
    const sending = copilot().send('Add a goodbye');
    await new Promise((r) => setTimeout(r));
    copilot().stop();
    await sending;

    expect(nodeNames()).toEqual(['Greeting', 'bye']);
    expect(copilot().status).toBe('idle');
    editor().undo();
    expect(editor().draft).toBe(before);
  });

  it('New chat mid-reply stops it, and nothing more is written', async () => {
    scripted([{ calls: [addBye] }, 'hang']);
    const sending = copilot().send('Add a goodbye');
    await new Promise((r) => setTimeout(r));
    copilot().clear();
    await sending;
    expect(copilot()).toMatchObject({ messages: [], status: 'idle', lastChange: null });
  });

  it('replace_agent builds a new agent from scratch', async () => {
    scripted([
      {
        calls: [
          call('replace_agent', {
            agent: {
              name: 'Refills',
              initial_node: 'ask',
              nodes: [
                { name: 'ask', task_messages: [{ role: 'developer', content: 'Ask which prescription.' }], edges: [{ function: 'got_it', description: 'Named it.', target: 'bye' }] },
                { name: 'bye', task_messages: [{ role: 'developer', content: 'Confirm and say bye.' }], end: true },
              ],
            },
          }),
        ],
      },
    ]);
    await copilot().send('Build me a refill agent');
    expect(exportAgent(editor().draft)).toMatchObject({ name: 'Refills', initial_node: 'ask', nodes: [{ name: 'ask' }, { name: 'bye' }] });
  });
});

describe('checking the agent when the copilot is done', () => {
  const unconnected = 'Error in node "bye": Not connected to the start node.';

  it('asks the copilot once to fix errors its changes left, and it does', async () => {
    const requests = scripted([{ calls: [addBye] }, { text: 'Added a goodbye.' }, { calls: [linkBye] }, { text: 'Connected it.' }]);
    await copilot().send('Add a goodbye');

    expect(requests).toHaveLength(4);
    expect(requests[2].messages.at(-1)).toEqual({ role: 'check', content: checkMessage([unconnected]), problems: [unconnected] });
    expect(checkMessage([unconnected])).toBe(
      "[Automatic check by the editor] Your changes left the agent with these errors, which weren't there before:\n" +
        `- ${unconnected}\n` +
        'Fix them with your tools, then reply briefly. If one needs a decision from the user, ask them instead.',
    );
    expect(Object.keys(editor().draft.edges)).toHaveLength(1);
    expect(copilot()).toMatchObject({ status: 'idle', leftProblems: [] });
    expect(copilot().messages.at(-1)).toEqual({ role: 'assistant', content: 'Connected it.' });
  });

  it('says what is still broken if the fix attempt fails, without asking again', async () => {
    const requests = scripted([{ calls: [addBye] }, { text: 'Added a goodbye.' }, { text: 'I left it for you.' }, { text: 'never asked' }]);
    await copilot().send('Add a goodbye');

    expect(requests).toHaveLength(3); // one nudge only
    expect(copilot()).toMatchObject({ status: 'idle', leftProblems: [unconnected] });
    expect(copilot().messages.at(-1)).toEqual({ role: 'assistant', content: 'I left it for you.' });
  });

  it("doesn't hold the copilot to errors that were there before it started", async () => {
    // A fresh agent: Greeting has no task message and no way to end the call.
    const requests = scripted([{ calls: [call('update_agent', { persona: 'Be brief.' })] }, { text: 'Done.' }]);
    await copilot().send('Make the persona brief');
    expect(requests).toHaveLength(2);
    expect(copilot().leftProblems).toEqual([]);
  });

  it('only checks when the copilot changed something', async () => {
    const requests = scripted([{ text: 'Nodes are steps.' }]);
    await copilot().send('What is a node?');
    expect(requests).toHaveLength(1);
  });

  it('the check reaches the model as a user message', () => {
    expect(toWire([{ role: 'check', content: 'Fix it.', problems: ['x'] }])).toEqual([{ role: 'user', content: 'Fix it.' }]);
  });
});
