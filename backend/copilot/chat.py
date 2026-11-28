#
# Copilot chat — the LLM assistant in the agent editor's bottom panel.
#
#   editor  --POST /api/copilot/chat {messages}-->  OpenAI (streaming)
#           <--  NDJSON lines: {"type": "delta", "text": ...} ... {"type": "done"}
#
# Stateless: the editor keeps the conversation and sends all of it with each message.
# The OpenAI key stays here in the backend; the browser never sees it. bot.py mounts
# this router on the Pipecat dev runner's app, so it is served on the same port as calls.
#
# For now it is an open chat: it can't see or change the graph yet.
#

import json
import os
from typing import AsyncIterator, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/copilot")

DEFAULT_MODEL = "gpt-4o"

SYSTEM_PROMPT = """\
You are the copilot inside AgentEditor, a visual editor for building voice AI agents.

An agent is a graph. Nodes are the steps the agent takes: each has a task message telling \
the LLM what to do at that step, and an end node hangs up. Edges are the transitions out of \
a node, and the LLM picks one depending on what the caller says: each edge is a function \
with a name, a description of when to take it, a target node, and optional fields to collect \
from the caller. A node with several edges branches on the caller's answer.

Help the user design, review and improve their agent. You can't see or change their graph \
yet, so if you need it, ask them to describe it.

Be concise. Your replies appear in a small chat panel as plain text: no markdown headings, \
tables or bold; short paragraphs, and simple "-" lists when they help.\
"""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=200)


_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """The OpenAI client, made on first use. Tests replace this dependency."""
    global _client
    if _client is None:
        key = os.environ.get("OPENAI_API_KEY")
        if not key:
            raise HTTPException(503, "OPENAI_API_KEY isn't set in backend/.env.")
        _client = AsyncOpenAI(api_key=key)
    return _client


def _line(event: dict) -> str:
    return json.dumps(event) + "\n"


@router.post("/chat")
async def chat(request: ChatRequest, client: AsyncOpenAI = Depends(get_client)) -> StreamingResponse:
    if request.messages[-1].role != "user":
        raise HTTPException(422, "The last message must be from the user.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages += [m.model_dump() for m in request.messages]
    model = os.environ.get("COPILOT_MODEL", DEFAULT_MODEL)

    async def events() -> AsyncIterator[str]:
        try:
            stream = await client.chat.completions.create(model=model, messages=messages, stream=True)
            # Closing the stream (also when the editor stops the reply) ends the OpenAI request.
            async with stream:
                async for chunk in stream:
                    text = chunk.choices[0].delta.content if chunk.choices else None
                    if text:
                        yield _line({"type": "delta", "text": text})
            yield _line({"type": "done"})
        except Exception as e:  # report it in the chat rather than cutting the reply off silently
            logger.exception("Copilot reply failed")
            yield _line({"type": "error", "message": f"The copilot couldn't reply: {e}"})

    return StreamingResponse(events(), media_type="application/x-ndjson")
