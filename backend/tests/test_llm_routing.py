"""Does the LLM take the right edge for what the caller says?

The other tests prove each edge leads to its target. These check the part only the model
decides: given a node's prompts and its edges as tools, which edge it calls for a given
caller reply. They send real requests to OpenAI (a few cents a run), so they are opt-in:

    RUN_LLM_TESTS=1 uv run pytest tests/test_llm_routing.py -v
"""

import json
import os
from pathlib import Path

import pytest
from dotenv import load_dotenv

from agent_builder import AgentBuilder

BACKEND = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND / ".env")

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_LLM_TESTS") != "1" or not os.environ.get("OPENAI_API_KEY"),
    reason="calls OpenAI: set RUN_LLM_TESTS=1 (and OPENAI_API_KEY) to run",
)

BUILDER = AgentBuilder.from_json(BACKEND / "branching_flow.json")
NODES = {n.name: n for n in BUILDER.config.nodes}


def chosen_edge(node_name: str, conversation: list) -> tuple:
    """The edge the model calls at `node_name` after `conversation`, and its arguments."""
    from openai import OpenAI

    node = BUILDER._make_node(NODES[node_name])
    messages = [{"role": "system", "content": node["role_message"]}, *node["task_messages"], *conversation]
    tools = [
        {
            "type": "function",
            "function": {
                "name": fn.name,
                "description": fn.description,
                "parameters": {"type": "object", "properties": fn.properties, "required": fn.required},
            },
        }
        for fn in node["functions"]
    ]
    response = OpenAI().chat.completions.create(
        model=BUILDER.config.model, messages=messages, tools=tools, temperature=0
    )
    calls = response.choices[0].message.tool_calls or []
    assert len(calls) == 1, f"expected one edge, got: {response.choices[0].message}"
    return calls[0].function.name, json.loads(calls[0].function.arguments or "{}")


GREETING = "Hi, this is the clinic's front desk. Would you like to book, reschedule, or cancel an appointment?"
OFFER = "I have Tuesday at 10 AM or Thursday at 2 PM. Which works for you?"
CONFIRM = "Just to confirm, you'd like to cancel your appointment on March 3rd?"


@pytest.mark.parametrize(
    "node, bot_said, caller_says, expected",
    [
        ("greeting", GREETING, "I'd like to come in for a check-up.", "book_appointment"),
        ("greeting", GREETING, "I can't make Friday anymore, can we move it to another day?", "reschedule_appointment"),
        ("greeting", GREETING, "I need to cancel my appointment please.", "cancel_appointment"),
        ("offer_times", OFFER, "Thursday afternoon is perfect.", "select_time"),
        ("offer_times", OFFER, "Hmm, I work both of those days, neither is any good.", "no_time_works"),
        ("confirm_cancellation", CONFIRM, "Yes, please cancel it.", "cancellation_confirmed"),
        ("confirm_cancellation", CONFIRM, "Actually, wait, no. I'll keep it.", "keep_appointment"),
    ],
)
def test_the_llm_takes_the_edge_that_matches_the_reply(node, bot_said, caller_says, expected):
    edge, _ = chosen_edge(node, [{"role": "assistant", "content": bot_said}, {"role": "user", "content": caller_says}])
    assert edge == expected


def test_the_chosen_slot_is_passed_along_the_edge():
    edge, args = chosen_edge(
        "offer_times",
        [{"role": "assistant", "content": OFFER}, {"role": "user", "content": "Thursday afternoon is perfect."}],
    )
    assert (edge, args) == ("select_time", {"slot": "Thursday 2 PM"})
