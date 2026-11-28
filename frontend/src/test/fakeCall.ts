import { setConnectionFactory, type CallEvents } from '../call/call';

/**
 * Replaces the Pipecat connection with a controllable fake for the next call.
 * `ready()` / `fail()` settle the connect; `events` plays the backend's side.
 */
export function fakeConnection() {
  const fake = {
    events: null as unknown as CallEvents,
    connectedWith: [] as unknown[],
    disconnects: 0,
    ready: () => {},
    fail: (_e: unknown) => {},
  };
  setConnectionFactory((events) => {
    fake.events = events;
    return {
      connect: (agent) =>
        new Promise<void>((resolve, reject) => {
          fake.connectedWith.push(agent);
          fake.ready = resolve;
          fake.fail = reject;
        }),
      disconnect: async () => {
        fake.disconnects++;
      },
    };
  });
  return fake;
}
