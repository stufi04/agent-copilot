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
    (messages, onDelta, signal) =>
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

    expect(panel()).toHaveTextContent("it can't see or change the graph yet");
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
});
