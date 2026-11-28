#
# Copilot chat — the LLM assistant in the agent editor's bottom panel.
#
#   editor  --POST /api/copilot/chat {messages, agent}-->  OpenAI (streaming, with tools)
#           <--  NDJSON lines: {"type": "delta", "text": ...}
#                              {"type": "tool_calls", "calls": [{id, name, arguments}]}
#                              {"type": "done"} | {"type": "error", "message": ...}
#
# Stateless: the editor keeps the conversation and sends all of it, plus the agent on
# screen, with each request. The copilot edits the graph through tools (tools.json),
# but this endpoint only asks the model for them: the editor runs each tool call on its
# own graph and sends the results back in the next request, until the model just replies.
# The OpenAI key stays here; bot.py mounts this router on the Pipecat dev runner's app.
#

import json
import os
from pathlib import Path
from typing import Annotated, AsyncIterator, Literal, Optional, Union

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

router = APIRouter(prefix="/api/copilot")

DEFAULT_MODEL = "gpt-4o"

# The graph-editing tools, in OpenAI's format. The editor's tests read this file too, to
# check every tool has an implementation there (frontend/src/model/copilotOps.ts).
TOOLS = json.loads((Path(__file__).parent / "tools.json").read_text())

SYSTEM_PROMPT = """\
You are the copilot inside AgentEditor, a visual editor for building voice AI agents.

An agent is a graph. Nodes are the steps the agent takes: each has a task message telling \
the LLM what to do at that step, and an end node hangs up. Edges are the transitions out of \
a node, and the LLM picks one depending on what the caller says: each edge is a function \
with a name, a description of when to take it, a target node, and optional fields to collect \
from the caller. A node with several edges branches on the caller's answer.

You can see the agent currently in the editor (below, as JSON, with any validation issues), \
and you can change it with your tools. The user watches the graph change as you work, and \
can undo everything you changed in one reply with one step.

When changing the agent:
- Only change it when the user asks for a change; to answer a question, just reply.
- Make targeted changes with the small tools; use replace_agent only to build from scratch \
or for a rewrite of most of the agent. When building from scratch, give the agent a fitting \
name and persona too.
- Give each caller intent its own edge, with a description that says when the caller means it. \
Before adding an edge, check the node's existing edges: if one already covers that intent, \
say so instead of adding an overlapping one.
- Use unique snake_case names for nodes and edge functions.
- Every node must be reachable from the start node, and every branch must end the call (a \
node with no outgoing edges must have end: true). Tool results list the issues left after \
each change: fix the ones you caused before you finish.

Design checklist (check your changes against it before you finish):
- Answers covered: when a node asks the caller a question, it has an edge for each answer \
the request implies (e.g. yes and no, or the caller can't or won't answer).
- Information recorded: when a step collects something from the caller, record it as fields \
on the edge that leaves that step (like record_details does), not just in the task message.
- Text in step with the graph: when you add, remove or rename an option, update the task \
messages that mention it (e.g. the greeting's list of options).
- Ending after a question: an end node has no edges. To end the call when the caller says \
no, lead the "no" edge to an end node that says goodbye.
- Removing a step: delete the edge that leads to it (delete_edge). That also deletes the \
nodes only it led to, and keeps nodes another path still uses; the tool result names what \
went, so don't delete those again.
- Your final message says briefly what you changed, and matches the tool results.

Be concise. Your replies appear in a chat panel that renders Markdown: use short paragraphs, \
"-" lists (nested for structure), `backticks` for node and edge names, and **bold** sparingly. \
Avoid headings unless the answer is long, and use a table only to compare things.\
"""


class FunctionCall(BaseModel):
    name: str
    arguments: str


class ToolCall(BaseModel):
    id: str
    type: Literal["function"] = "function"
    function: FunctionCall


class UserMessage(BaseModel):
    role: Literal["user"]
    content: str = Field(min_length=1, max_length=20_000)


class AssistantMessage(BaseModel):
    role: Literal["assistant"]
    content: str = Field(default="", max_length=20_000)
    tool_calls: Optional[list[ToolCall]] = None


class ToolMessage(BaseModel):
    role: Literal["tool"]
    tool_call_id: str
    content: str = Field(max_length=50_000)


ChatMessage = Annotated[Union[UserMessage, AssistantMessage, ToolMessage], Field(discriminator="role")]


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=400)
    # The agent on screen, as the editor describes it (frontend/src/model/describe.ts).
    agent: Optional[dict] = None


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


def _to_openai(message: Union[UserMessage, AssistantMessage, ToolMessage]) -> dict:
    out = message.model_dump(exclude_none=True)
    if isinstance(message, AssistantMessage) and message.tool_calls and not message.content:
        out["content"] = None  # a turn that only calls tools has no text
    return out


@router.post("/chat")
async def chat(request: ChatRequest, client: AsyncOpenAI = Depends(get_client)) -> StreamingResponse:
    if request.messages[-1].role not in ("user", "tool"):
        raise HTTPException(422, "The last message must be from the user or a tool result.")
    for m in request.messages:
        if isinstance(m, AssistantMessage) and not m.content and not m.tool_calls:
            raise HTTPException(422, "An assistant message needs text or tool calls.")

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if request.agent is not None:
        messages.append(
            {"role": "system", "content": "The agent in the editor now:\n" + json.dumps(request.agent, indent=1)}
        )
    messages += [_to_openai(m) for m in request.messages]
    model = os.environ.get("COPILOT_MODEL", DEFAULT_MODEL)

    async def events() -> AsyncIterator[str]:
        calls: dict[int, dict] = {}  # tool calls arrive in pieces, keyed by index
        try:
            stream = await client.chat.completions.create(
                model=model, messages=messages, tools=TOOLS, stream=True
            )
            # Closing the stream (also when the editor stops the reply) ends the OpenAI request.
            async with stream:
                async for chunk in stream:
                    if not chunk.choices:
                        continue
                    delta = chunk.choices[0].delta
                    if delta.content:
                        yield _line({"type": "delta", "text": delta.content})
                    for piece in delta.tool_calls or []:
                        call = calls.setdefault(piece.index, {"id": "", "name": "", "arguments": ""})
                        call["id"] = piece.id or call["id"]
                        if piece.function:
                            call["name"] += piece.function.name or ""
                            call["arguments"] += piece.function.arguments or ""
            if calls:
                yield _line({"type": "tool_calls", "calls": [calls[i] for i in sorted(calls)]})
            yield _line({"type": "done"})
        except Exception as e:  # report it in the chat rather than cutting the reply off silently
            logger.exception("Copilot reply failed")
            yield _line({"type": "error", "message": f"The copilot couldn't reply: {e}"})

    return StreamingResponse(events(), media_type="application/x-ndjson")
