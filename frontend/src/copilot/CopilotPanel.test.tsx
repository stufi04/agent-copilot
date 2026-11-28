import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../App';
import { useEditor } from '../model/store';
import { setChatStream, useCopilot } from './copilot';

/** A chat stream the test drives, returning the messages each call was sent. */
function fakeStream() {
  const fake = { calls: [] as unknown[], say: (_t: string) => {}, finish: () => {} };
  setChatStream(
    ({ messages }, onDelta, signal) =>
      new Promise<void>((resolve, reject) => {
        fake.calls.push(messages);
        fake.say = (t) => act(() => onDelta(t));
        fake.finish = () => act(() => resolve());
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
  );
  return fake;
}

const panel = () => screen.getByRole('region', { name: 'Copilot' });
const box = () => screen.getByRole('textbox', { name: 'Message the copilot' });

describe('CopilotPanel', () => {
  it('chats: Enter sends, the reply streams in, then the box is ready again', async () => {
    const user = userEvent.setup();
    const fake = fakeStream();
    render(<App />);

    expect(panel()).toHaveTextContent('or ask it to change it');
    await user.type(box(), 'How should I structure a booking agent?{Enter}');

    expect(fake.calls).toEqual([[{ role: 'user', content: 'How should I structure a booking agent?' }]]);
    expect(box()).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    expect(panel()).toHaveTextContent('Writing…');

    fake.say('Start with a greeting node');
    fake.say(' that branches on intent.');
    await fake.finish();

    expect(panel()).toHaveTextContent('Start with a greeting node that branches on intent.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled(); // nothing typed yet
    expect(panel()).not.toHaveTextContent('Writing…');
  });

  it('Shift+Enter adds a new line instead of sending', async () => {
    const user = userEvent.setup();
    const fake = fakeStream();
    render(<App />);

    await user.type(box(), 'Line one{Shift>}{Enter}{/Shift}Line two');
    expect(fake.calls).toHaveLength(0);
    expect(box()).toHaveValue('Line one\nLine two');

    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(fake.calls).toEqual([[{ role: 'user', content: 'Line one\nLine two' }]]);
  });

  it('Stop ends the reply and keeps what arrived', async () => {
    const user = userEvent.setup();
    const fake = fakeStream();
    render(<App />);

    await user.type(box(), 'Hi{Enter}');
    fake.say('Partial answer');
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(panel()).toHaveTextContent('Partial answer');
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('shows errors from the backend in the chat', async () => {
    const user = userEvent.setup();
    setChatStream(() => Promise.reject(new Error("Couldn't reach the backend at http://localhost:7860.")));
    render(<App />);

    await user.type(box(), 'Hi{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach the backend");
  });

  it('New chat clears the conversation', async () => {
    const user = userEvent.setup();
    const fake = fakeStream();
    render(<App />);

    await user.type(box(), 'Hi{Enter}');
    fake.say('Hello!');
    await fake.finish();
    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(panel()).not.toHaveTextContent('Hello!');
    expect(useCopilot.getState().messages).toEqual([]);
    expect(screen.getByRole('button', { name: 'New chat' })).toBeDisabled();
  });

  it('collapses to its header bar and opens again', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'Copilot' });

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Message the copilot' })).not.toBeInTheDocument();
    await user.click(toggle);
    expect(box()).toBeInTheDocument();
  });

  it('⌘Z in the message box is left to the text, not the graph', async () => {
    const user = userEvent.setup();
    render(<App />);
    act(() => useEditor.getState().updateAgent({ name: 'Renamed' }));
    expect(useEditor.getState().past.length).toBeGreaterThan(0); // there is something to undo
    const before = useEditor.getState().draft;

    await user.click(box());
    await user.keyboard('{Meta>}z{/Meta}{Control>}z{/Control}');
    expect(useEditor.getState().draft).toBe(before);
  });

  it('lists the edits under the reply, and "Undo these changes" takes them all back', async () => {
    const user = userEvent.setup();
    const before = useEditor.getState().draft;
    let step = 0;
    setChatStream(async (_request, onDelta) => {
      step++;
      if (step === 1)
        return [
          { id: 'a', name: 'add_node', arguments: '{"name": "bye", "task_message": "Say bye.", "end": true}' },
          { id: 'b', name: 'add_edge', arguments: '{"from": "Greeting", "function": "done", "description": "Done.", "to": "nowhere"}' },
        ];
      onDelta('Added a goodbye node.');
    });
    render(<App />);

    await user.type(box(), 'Add a goodbye{Enter}');
    expect(await screen.findByText('Added a goodbye node.')).toBeInTheDocument();
    expect(panel()).toHaveTextContent('✓ Added node "bye".');
    expect(panel()).toHaveTextContent(/✗ add_edge: There's no node named "nowhere"/);
    expect(screen.getAllByText('bye').length).toBeGreaterThan(0); // on the canvas

    await user.click(screen.getByRole('button', { name: 'Undo these changes' }));
    expect(useEditor.getState().draft).toBe(before);
    expect(screen.queryByRole('button', { name: 'Undo these changes' })).not.toBeInTheDocument();
  });

  it('offers no undo once the agent has changed since', async () => {
    setChatStream(async (_request, onDelta) => {
      if (useCopilot.getState().messages.length < 3)
        return [{ id: 'a', name: 'update_agent', arguments: '{"name": "Copilot named"}' }];
      onDelta('Renamed it.');
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(box(), 'Rename the agent{Enter}');
    expect(await screen.findByRole('button', { name: 'Undo these changes' })).toBeInTheDocument();

    act(() => useEditor.getState().updateAgent({ name: 'Mine' }));
    expect(screen.queryByRole('button', { name: 'Undo these changes' })).not.toBeInTheDocument();
  });

  it("renders the copilot's Markdown, but not raw HTML, and leaves your own messages as typed", async () => {
    const user = userEvent.setup();
    setChatStream(async (_request, onDelta) => {
      onDelta('The agent **Clinic Front Desk** starts at `greeting`:\n\n- **book_appointment** leads to `collect_details`\n  - then `offer_times`\n\n');
      onDelta('<img src=x onerror="alert(1)"> See [the docs](https://example.com).');
    });
    render(<App />);
    await user.type(box(), 'Use **stars** please{Enter}');

    const reply = (await screen.findByText('Clinic Front Desk')).closest('.copilot-msg') as HTMLElement;
    expect(screen.getByText('Clinic Front Desk').tagName).toBe('STRONG');
    expect(reply.querySelector('code')).toHaveTextContent('greeting');
    expect(reply.querySelectorAll('li')).toHaveLength(2); // a nested list
    expect(reply.querySelector('img')).toBeNull(); // raw HTML isn't rendered
    expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute('target', '_blank');
    expect(reply).not.toHaveTextContent('**');

    // What you type is shown as you typed it.
    expect(screen.getByText('Use **stars** please')).toBeInTheDocument();
  });
});
