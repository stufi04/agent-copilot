#
# Voice pipeline — Prosper Product Engineer Challenge
#
# The runnable voice agent: WebRTC transport + ElevenLabs STT/TTS + OpenAI LLM,
# driven by a Pipecat Flows node graph. This file is generic — it loads an agent
# definition (JSON) via AgentBuilder and runs it. Swapping the agent is a data
# change (edit/replace the JSON), not a code change.
#
#   example_flow.json  ->  AgentBuilder  ->  Pipecat Flows graph  ->  FlowManager
#
# Run:  python bot.py   then open http://localhost:7860/client
#
# The agent editor (frontend/) can also start calls: it POSTs /start with
# {"body": {"agent": <agent JSON>}} and connects over WebRTC, so the call runs
# exactly the agent on screen. Without an agent in the request, AGENT_FLOW runs.
# While a call runs, the bot sends the editor {"type": "node", "node": <name>}
# (an RTVI server message) each time the conversation enters a node.
#
# The same server also hosts the editor's copilot chat (copilot/, POST /api/copilot/chat).
#

import os
from pathlib import Path

from dotenv import load_dotenv
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner
from pipecat_flows import FlowManager

from agent_builder import AgentBuilder

# Load .env next to this file, so the bot runs the same from the repo root or backend/.
load_dotenv(Path(__file__).parent / ".env", override=True)


# The agent this bot runs. Point this at any agent JSON (the Phase 2 Composer
# would generate one and drop it here).
AGENT_FLOW = Path(__file__).parent / "example_flow.json"


transport_params = {
    "webrtc": lambda: TransportParams(audio_in_enabled=True, audio_out_enabled=True),
}


async def run_bot(
    transport: BaseTransport, runner_args: RunnerArguments, builder: AgentBuilder
) -> None:
    config = builder.config
    logger.info(f"Starting '{config.name}' with {len(config.nodes)} nodes")

    stt = ElevenLabsRealtimeSTTService(api_key=os.environ["ELEVENLABS_API_KEY"])
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(voice=config.voice_id),
    )
    llm = OpenAILLMService(api_key=os.environ["OPENAI_API_KEY"], model=config.model)

    context = LLMContext()
    context_aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            context_aggregator.user(),
            llm,
            tts,
            transport.output(),
            context_aggregator.assistant(),
        ]
    )

    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
    )

    flow_manager = FlowManager(
        llm=llm,
        context_aggregator=context_aggregator,
        worker=worker,
        transport=transport,
    )

    async def announce_node(name: str) -> None:
        await worker.rtvi.send_server_message({"type": "node", "node": name})

    builder.on_transition = announce_node

    @transport.event_handler("on_client_connected")
    async def on_client_connected(transport, client):
        logger.info("Client connected — starting flow at initial node")
        await flow_manager.initialize(builder.build_initial_node())
        await announce_node(config.initial_node)

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(transport, client):
        logger.info("Client disconnected")
        await worker.cancel()

    runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
    await runner.add_workers(worker)
    await runner.run()


async def bot(runner_args: RunnerArguments):
    """Entry point invoked by the Pipecat dev runner (and Pipecat Cloud)."""
    try:
        builder = builder_for(runner_args.body)
    except Exception:
        # The editor validates before calling, so this is a bug or a hand-made request.
        # Hang up rather than leave the browser waiting for a bot that never starts.
        logger.exception("Can't run the agent sent with this call")
        connection = getattr(runner_args, "webrtc_connection", None)
        if connection:
            await connection.disconnect()
        return
    transport = await create_transport(runner_args, transport_params)
    await run_bot(transport, runner_args, builder)


def builder_for(body: object) -> AgentBuilder:
    """The agent sent with the call ({"agent": {...}}), or AGENT_FLOW when there is none."""
    agent = body.get("agent") if isinstance(body, dict) else None
    if agent:
        logger.info(f"Running the agent sent by the client: '{agent.get('name')}'")
        return AgentBuilder.from_dict(agent)
    return AgentBuilder.from_json(AGENT_FLOW)


if __name__ == "__main__":
    from pipecat.runner.run import app, main

    import copilot

    # The editor's copilot chat (POST /api/copilot/chat), served alongside the calls.
    app.include_router(copilot.router)
    main()
