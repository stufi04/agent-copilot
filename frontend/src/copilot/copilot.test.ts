import { describe, expect, it, vi } from 'vitest';
import { streamChat, type ChatMessage } from './chatApi';
import { setChatStream, useCopilot } from './copilot';

/** A chat stream the test drives: `say` sends text, `finish` / `fail` end the reply. */
function fakeStream() {
  const fake = {
    calls: [] as ChatMessage[][],
    agents: [] as unknown[],
    say: (_t: string) => {},
    finish: () => {},
    fail: (_e: Error) => {},
    signal: null as AbortSignal | null,
  };
  setChatStream(
    ({ messages, agent }, onDelta, signal) =>
      new Promise<void>((resolve, reject) => {
        fake.calls.push(messages);
        fake.agents.push(agent);
        fake.say = onDelta;
        fake.finish = resolve;
        fake.fail = reject;
        fake.signal = signal;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  return fake;
}

const state = () => useCopilot.getState();

describe('copilot store', () => {
  it('sends the conversation and streams the reply into it', async () => {
    const fake = fakeStream();
    const sending = state().send('  Hi there  ');

    expect(fake.calls).toEqual([[{ role: 'user', content: 'Hi there' }]]);
    expect(state().status).toBe('streaming');
    fake.say('Hel');
    fake.say('lo!');
    expect(state().messages.at(-1)).toEqual({ role: 'assistant', content: 'Hello!' });
    fake.finish();
    await sending;

    expect(state()).toMatchObject({
      status: 'idle',
      error: null,
      messages: [
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'Hello!' },
      ],
    });
  });

  it('sends the earlier turns with each new message', async () => {
    const fake = fakeStream();
    const first = state().send('One');
    fake.say('Reply one');
    fake.finish();
    await first;
    const second = state().send('Two');
    fake.finish();
    await second;

    expect(fake.calls[1]).toEqual([
      { role: 'user', content: 'One' },
      { role: 'assistant', content: 'Reply one' },
      { role: 'user', content: 'Two' },
    ]);
  });

  it('ignores blank messages and messages sent while a reply is being written', async () => {
    const fake = fakeStream();
    await state().send('   ');
    expect(fake.calls).toHaveLength(0);

    void state().send('First');
    void state().send('Second');
    expect(fake.calls).toHaveLength(1);
  });

  it('stop keeps what has arrived so far', async () => {
    const fake = fakeStream();
    const sending = state().send('Tell me a story');
    fake.say('Once upon');
    state().stop();
    await sending;

    expect(fake.signal?.aborted).toBe(true);
    expect(state().status).toBe('idle');
    expect(state().messages.at(-1)).toEqual({ role: 'assistant', content: 'Once upon' });
  });

  it('stopping before any text arrives drops the empty reply', async () => {
    fakeStream();
    const sending = state().send('Hi');
    state().stop();
    await sending;
    expect(state().messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('shows an error and keeps the question so it can be asked again', async () => {
    const fake = fakeStream();
    const sending = state().send('Hi');
    fake.fail(new Error('The copilot couldn\'t reply: quota exceeded'));
    await sending;

    expect(state()).toMatchObject({
      status: 'error',
      error: "The copilot couldn't reply: quota exceeded",
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const retry = state().send('Hi again');
    expect(state().error).toBeNull();
    fake.finish();
    await retry;
  });

  it('new chat empties the conversation and abandons a reply in progress', async () => {
    const fake = fakeStream();
    const sending = state().send('Hi');
    fake.say('Hel');
    state().clear();
    await sending;

    expect(fake.signal?.aborted).toBe(true);
    expect(state()).toMatchObject({ messages: [], status: 'idle', error: null });
  });

  it('keeps the conversation and panel layout across reloads', async () => {
    const fake = fakeStream();
    state().setHeight(400);
    state().setOpen(false);
    const sending = state().send('Remember me');
    fake.say('Will do');
    fake.finish();
    await sending;

    const saved = JSON.parse(localStorage.getItem('agent-composer:copilot')!).state;
    expect(saved).toEqual({
      messages: [
        { role: 'user', content: 'Remember me' },
        { role: 'assistant', content: 'Will do' },
      ],
      open: true, // sending a message opens the panel
      height: 400,
    });
  });
});

describe('streamChat (the HTTP side)', () => {
  /** A fetch Response whose body arrives in the given chunks. */
  const ndjson = (chunks: string[], init: ResponseInit = {}) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
          c.close();
        },
      }),
      init,
    );

  const run = async (response: Response | Error) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    if (response instanceof Error) fetchMock.mockRejectedValue(response);
    else fetchMock.mockResolvedValue(response);
    const deltas: string[] = [];
    const result = await streamChat(
      { messages: [{ role: 'user', content: 'Hi' }], agent: { name: 'A' } },
      (t) => deltas.push(t),
      new AbortController().signal,
    )
      .then(() => null)
      .catch((e: Error) => e.message);
    return { deltas, error: result, fetchMock };
  };

  it('posts the messages to the backend and reads deltas split across chunks', async () => {
    const { deltas, error, fetchMock } = await run(
      ndjson(['{"type":"delta","text":"Hel"}\n{"type":"de', 'lta","text":"lo"}\n', '{"type":"done"}\n']),
    );

    expect(error).toBeNull();
    expect(deltas).toEqual(['Hel', 'lo']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:7860/api/copilot/chat');
    expect(JSON.parse(init!.body as string)).toEqual({ messages: [{ role: 'user', content: 'Hi' }], agent: { name: 'A' } });
  });

  it('turns an error event into an error, after the text that came before it', async () => {
    const { deltas, error } = await run(
      ndjson(['{"type":"delta","text":"Par"}\n{"type":"error","message":"The copilot couldn\'t reply: boom"}\n']),
    );
    expect(deltas).toEqual(['Par']);
    expect(error).toBe("The copilot couldn't reply: boom");
  });

  it('says the reply was cut off when the stream ends without "done"', async () => {
    const { error } = await run(ndjson(['{"type":"delta","text":"Par"}\n']));
    expect(error).toBe('The reply was cut off. Try again.');
  });

  it("explains a backend that isn't running", async () => {
    const { error } = await run(new TypeError('Failed to fetch'));
    expect(error).toBe('Couldn\'t reach the backend at http://localhost:7860. Start it with "make dev" and try again.');
  });

  it("shows the backend's reason for an HTTP error", async () => {
    const { error } = await run(
      new Response(JSON.stringify({ detail: "OPENAI_API_KEY isn't set in backend/.env." }), { status: 503 }),
    );
    expect(error).toBe("OPENAI_API_KEY isn't set in backend/.env.");
  });
});
