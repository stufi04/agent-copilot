import { PipecatClient, type Participant } from '@pipecat-ai/client-js';
import { SmallWebRTCTransport } from '@pipecat-ai/small-webrtc-transport';
import { BACKEND_URL } from '../backend';
import type { CallConnection, ConnectionFactory } from './call';

// The real call: Pipecat's browser client over SmallWebRTC, talking to the backend's
// dev runner. POST /start registers a session carrying the agent JSON; the transport
// then sends its WebRTC offer to /sessions/<id>/api/offer and the bot runs that agent.

export const pipecatConnection: ConnectionFactory = (events): CallConnection => {
  let audio: HTMLAudioElement | null = null;

  const client = new PipecatClient({
    transport: new SmallWebRTCTransport(),
    enableMic: true,
    enableCam: false,
    callbacks: {
      onUserTranscript: (data) => events.userSpeech(data.text, data.final),
      onBotOutput: (data) => {
        // Each sentence arrives once as "new" (then word-by-word progress, which we skip).
        if (data.spoken_status && data.spoken_status !== 'new') return;
        if (data.output_type === 'word') return;
        events.botSpeech(data.text);
      },
      onServerMessage: (data: { type?: string; node?: string }) => {
        if (data?.type === 'node' && data.node) events.node(data.node);
      },
      onTrackStarted: (track: MediaStreamTrack, participant?: Participant) => {
        // Play the agent's voice; the caller's own microphone track isn't played back.
        if (track.kind !== 'audio' || participant?.local) return;
        audio ??= new Audio();
        audio.autoplay = true;
        audio.srcObject = new MediaStream([track]);
        void audio.play().catch(() => {});
      },
      onDisconnected: () => {
        if (audio) audio.srcObject = null;
        events.disconnected();
      },
    },
  });

  return {
    connect: async (agent) => {
      await client.startBotAndConnect({
        endpoint: `${BACKEND_URL}/start`,
        requestData: { transport: 'webrtc', body: { agent } } as never,
      });
    },
    disconnect: () => client.disconnect(),
  };
};
