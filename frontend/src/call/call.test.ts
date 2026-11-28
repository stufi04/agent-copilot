import { describe, expect, it } from 'vitest';
import { fakeConnection } from '../test/fakeCall';
import { useCall } from './call';
import { addBotSpeech, addUserSpeech, type Line } from './transcript';

describe('transcript', () => {
  it('interim guesses replace each other; the final text replaces the guess', () => {
    let lines: Line[] = [];
    lines = addUserSpeech(lines, 'I want', false);
    lines = addUserSpeech(lines, 'I want to book', false);
    expect(lines).toEqual([{ role: 'user', text: '', interim: 'I want to book' }]);
    lines = addUserSpeech(lines, 'I want to book an appointment.', true);
    expect(lines).toEqual([{ role: 'user', text: 'I want to book an appointment.' }]);
  });

  it('consecutive pieces from the same speaker join into one line', () => {
    let lines: Line[] = [];
    lines = addBotSpeech(lines, 'Hello!');
    lines = addBotSpeech(lines, 'How can I help?');
    lines = addUserSpeech(lines, 'Book', true);
    lines = addUserSpeech(lines, 'a visit', false);
    expect(lines).toEqual([
      { role: 'bot', text: 'Hello! How can I help?' },
      { role: 'user', text: 'Book', interim: 'a visit' },
    ]);
    lines = addUserSpeech(lines, 'a visit please', true);
    lines = addBotSpeech(lines, 'Sure.');
    expect(lines.map((l) => l.text)).toEqual(['Hello! How can I help?', 'Book a visit please', 'Sure.']);
  });

  it('ignores empty text', () => {
    expect(addBotSpeech([], '  ')).toEqual([]);
    expect(addUserSpeech([], '', true)).toEqual([]);
  });
});

describe('useCall', () => {
  const agent = { name: 'Clinic' };

  it('connects with the agent, follows speech and nodes, and ends on hang up', async () => {
    const fake = fakeConnection();
    const call = useCall.getState().start(agent);
    expect(useCall.getState()).toMatchObject({ status: 'connecting', agentName: 'Clinic' });
    fake.ready();
    await call;
    expect(fake.connectedWith).toEqual([agent]);
    expect(useCall.getState().status).toBe('connected');

    fake.events.node('Greeting');
    fake.events.botSpeech('Hi there.');
    fake.events.userSpeech('Hello', true);
    expect(useCall.getState()).toMatchObject({
      activeNode: 'Greeting',
      lines: [
        { role: 'bot', text: 'Hi there.' },
        { role: 'user', text: 'Hello' },
      ],
    });

    await useCall.getState().hangUp();
    expect(fake.disconnects).toBe(1);
    expect(useCall.getState()).toMatchObject({ status: 'ended', activeNode: null });
    expect(useCall.getState().lines).toHaveLength(2); // the transcript stays for reading
  });

  it('the agent hanging up (an end node) ends the call', async () => {
    const fake = fakeConnection();
    const call = useCall.getState().start(agent);
    fake.ready();
    await call;
    fake.events.node('Confirm');
    fake.events.disconnected();
    expect(useCall.getState()).toMatchObject({ status: 'ended', activeNode: null });
  });

  it('explains when the backend is not running', async () => {
    const fake = fakeConnection();
    const call = useCall.getState().start(agent);
    fake.fail(new TypeError('Failed to fetch'));
    await call;
    expect(useCall.getState()).toMatchObject({ status: 'error', error: expect.stringContaining('make run') });
  });

  it('dismiss closes the panel only once the call is over', async () => {
    const fake = fakeConnection();
    const call = useCall.getState().start(agent);
    fake.ready();
    await call;
    useCall.getState().dismiss();
    expect(useCall.getState().status).toBe('connected');
    await useCall.getState().hangUp();
    useCall.getState().dismiss();
    expect(useCall.getState()).toMatchObject({ status: 'idle', lines: [] });
  });
});
