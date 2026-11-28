"""Tests for the declarative agent schema and its compilation into Pipecat Flows."""

import asyncio
import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from agent_builder import AgentBuilder, AgentConfig
from agent_builder.schema import DEFAULT_MODEL, DEFAULT_VOICE_ID

BACKEND = Path(__file__).resolve().parents[1]
EXAMPLE_FLOW = BACKEND / "example_flow.json"
# Exported by the frontend editor; the frontend e2e test rebuilds it through the UI.
FRONTEND_EXPORT = BACKEND.parent / "frontend" / "e2e" / "fixtures" / "new_agent.json"


def minimal_agent(**overrides) -> dict:
    """A valid two-node agent: start --go--> done."""
    agent = {
        "name": "Test agent",
        "persona": "Global persona.",
        "initial_node": "start",
        "nodes": [
            {
                "name": "start",
                "task_messages": [{"role": "developer", "content": "Say hi."}],
                "edges": [
                    {
                        "function": "go",
                        "description": "Move on.",
                        "target": "done",
                        "properties": {"name": {"type": "string"}},
                        "required": ["name"],
                    }
                ],
            },
            {"name": "done", "task_messages": [{"role": "developer", "content": "Bye."}], "end": True},
        ],
    }
    agent.update(overrides)
    return agent


# ---- schema -----------------------------------------------------------------


def test_schema_applies_defaults_for_optional_fields():
    data = minimal_agent()
    del data["persona"]
    data["nodes"][1] = {"name": "done"}  # everything but the name is optional
    del data["nodes"][0]["edges"][0]["properties"]
    del data["nodes"][0]["edges"][0]["required"]

    config = AgentConfig.from_dict(data)

    assert config.persona == ""
    assert config.voice_id == DEFAULT_VOICE_ID
    assert config.model == DEFAULT_MODEL
    done = config.nodes[1]
    assert (done.task_messages, done.role_message, done.edges, done.end) == ([], None, [], False)
    edge = config.nodes[0].edges[0]
    assert (edge.properties, edge.required) == ({}, [])


def test_schema_requires_core_fields():
    data = minimal_agent()
    del data["initial_node"]
    with pytest.raises(KeyError):
        AgentConfig.from_dict(data)


# ---- loading real agent files ------------------------------------------------


def test_example_flow_loads():
    builder = AgentBuilder.from_json(EXAMPLE_FLOW)
    assert builder.config.name == "Prosper Scheduler"
    assert [n.name for n in builder.config.nodes] == ["greeting", "collect_details", "offer_times", "confirm"]


def test_frontend_export_loads():
    """Contract test: JSON exported by the frontend editor must load in the backend."""
    builder = AgentBuilder.from_json(FRONTEND_EXPORT)
    assert builder.config.initial_node == "Greeting"
    assert len(builder.config.nodes) == 4


def test_frontend_export_matches_example_flow_apart_from_names():
    """The editor recreated example_flow.json; only the agent and node names differ."""
    example = json.loads(EXAMPLE_FLOW.read_text())
    exported = json.loads(FRONTEND_EXPORT.read_text())
    renames = {a["name"]: b["name"] for a, b in zip(example["nodes"], exported["nodes"])}

    renamed = copy.deepcopy(example)
    renamed["name"] = exported["name"]
    renamed["initial_node"] = renames[renamed["initial_node"]]
    for node in renamed["nodes"]:
        node["name"] = renames[node["name"]]
        for edge in node.get("edges", []):
            edge["target"] = renames[edge["target"]]

    assert renamed == exported


# ---- validation ---------------------------------------------------------------


def test_rejects_agent_without_nodes():
    with pytest.raises(ValueError, match="no nodes"):
        AgentBuilder.from_dict(minimal_agent(nodes=[]))


def test_rejects_unknown_initial_node():
    with pytest.raises(ValueError, match="initial_node 'nope'"):
        AgentBuilder.from_dict(minimal_agent(initial_node="nope"))


def test_rejects_edge_to_unknown_node():
    data = minimal_agent()
    data["nodes"][0]["edges"][0]["target"] = "missing"
    with pytest.raises(ValueError, match="Edge 'go' in node 'start' targets unknown node 'missing'"):
        AgentBuilder.from_dict(data)


# ---- compilation ----------------------------------------------------------------


def test_initial_node_compiles_to_pipecat_node_config():
    node = AgentBuilder.from_dict(minimal_agent()).build_initial_node()

    assert node["name"] == "start"
    assert node["role_message"] == "Global persona."
    assert node["task_messages"] == [{"role": "developer", "content": "Say hi."}]
    assert "pre_actions" not in node and "post_actions" not in node

    [fn] = node["functions"]
    assert (fn.name, fn.description) == ("go", "Move on.")
    assert fn.properties == {"name": {"type": "string"}}
    assert fn.required == ["name"]


def test_node_role_message_overrides_persona():
    data = minimal_agent()
    data["nodes"][0]["role_message"] = "Node persona."
    assert AgentBuilder.from_dict(data).build_initial_node()["role_message"] == "Node persona."


def test_actions_are_passed_through():
    data = minimal_agent()
    data["nodes"][0]["pre_actions"] = [{"type": "tts_say", "text": "One moment."}]
    data["nodes"][0]["post_actions"] = [{"type": "custom"}]
    node = AgentBuilder.from_dict(data).build_initial_node()
    assert node["pre_actions"] == [{"type": "tts_say", "text": "One moment."}]
    assert node["post_actions"] == [{"type": "custom"}]


def run_edge(builder: AgentBuilder, args: dict):
    """Call the initial node's first edge handler as Pipecat Flows would."""
    fn = builder.build_initial_node()["functions"][0]
    flow_manager = SimpleNamespace(state={"existing": 1})
    result, next_node = asyncio.run(fn.handler(args, flow_manager))
    return flow_manager.state, result, next_node


def test_edge_handler_stores_args_and_transitions_to_target():
    state, result, next_node = run_edge(AgentBuilder.from_dict(minimal_agent()), {"name": "Ada"})

    assert state == {"existing": 1, "name": "Ada"}
    assert result == {"status": "success", "name": "Ada"}
    assert next_node["name"] == "done"
    assert next_node["functions"] == []


def test_end_node_ends_the_conversation():
    _, _, done = run_edge(AgentBuilder.from_dict(minimal_agent()), {"name": "Ada"})
    assert done["post_actions"] == [{"type": "end_conversation"}]


def test_explicit_post_actions_replace_end_conversation():
    """Current behaviour: explicit post_actions win, so `end` no longer hangs up.
    Pinned here so a change to it is deliberate."""
    data = minimal_agent()
    data["nodes"][1]["post_actions"] = [{"type": "custom"}]
    _, _, done = run_edge(AgentBuilder.from_dict(data), {"name": "Ada"})
    assert done["post_actions"] == [{"type": "custom"}]


def test_whole_example_flow_can_be_walked_to_the_end():
    builder = AgentBuilder.from_json(EXAMPLE_FLOW)
    node = builder.build_initial_node()
    visited = [node["name"]]
    flow_manager = SimpleNamespace(state={})
    while node["functions"]:
        fn = node["functions"][0]
        args = {key: (spec.get("enum") or ["x"])[0] for key, spec in fn.properties.items()}
        _, node = asyncio.run(fn.handler(args, flow_manager))
        visited.append(node["name"])

    assert visited == ["greeting", "collect_details", "offer_times", "confirm"]
    assert node["post_actions"] == [{"type": "end_conversation"}]
    assert flow_manager.state == {"intent": "book", "full_name": "x", "reason": "x", "slot": "Tuesday 10 AM"}


def test_on_transition_is_told_the_target_node():
    builder = AgentBuilder.from_dict(minimal_agent())
    entered = []

    async def on_transition(name):
        entered.append(name)

    builder.on_transition = on_transition
    run_edge(builder, {"name": "Ada"})
    assert entered == ["done"]


def test_bot_runs_the_agent_sent_with_the_call_or_the_default_flow():
    from bot import builder_for

    assert builder_for({"agent": minimal_agent(name="Sent")}).config.name == "Sent"
    default = json.loads((BACKEND / "example_flow.json").read_text())["name"]
    assert builder_for({}).config.name == default
    assert builder_for(None).config.name == default
    with pytest.raises(ValueError):
        builder_for({"agent": minimal_agent(initial_node="nowhere")})


# ---- branching ------------------------------------------------------------------

BRANCHING_FLOW = BACKEND / "branching_flow.json"


def walk_every_path(builder: AgentBuilder) -> list:
    """Every route from the start node to an end node, taking each edge a node offers.

    Each route is a list of (node, edge taken) steps ending with (end node, None), and is
    walked through the real edge handlers, so it follows the targets the builder wires up.
    """
    paths = []

    def walk(node: dict, path: list):
        if not node["functions"]:
            paths.append(path + [(node["name"], None)])
            return
        for fn in node["functions"]:
            args = {key: (spec.get("enum") or ["x"])[0] for key, spec in fn.properties.items()}
            _, next_node = asyncio.run(fn.handler(args, SimpleNamespace(state={})))
            walk(next_node, path + [(node["name"], fn.name)])

    walk(builder.build_initial_node(), [])
    return paths


def test_a_node_with_several_edges_offers_the_llm_one_function_per_edge():
    greeting = AgentBuilder.from_json(BRANCHING_FLOW).build_initial_node()
    assert [fn.name for fn in greeting["functions"]] == [
        "book_appointment",
        "reschedule_appointment",
        "cancel_appointment",
    ]


def test_each_edge_leads_to_its_own_target():
    builder = AgentBuilder.from_json(BRANCHING_FLOW)
    targets = {}
    for fn in builder.build_initial_node()["functions"]:
        _, next_node = asyncio.run(fn.handler({}, SimpleNamespace(state={})))
        targets[fn.name] = next_node["name"]
    assert targets == {
        "book_appointment": "collect_details",
        "reschedule_appointment": "find_appointment_to_move",
        "cancel_appointment": "find_appointment_to_cancel",
    }


def test_branching_flow_routes_every_path_to_an_end_node():
    builder = AgentBuilder.from_json(BRANCHING_FLOW)
    routes = [[edge for _, edge in path if edge] + [path[-1][0]] for path in walk_every_path(builder)]

    assert routes == [
        ["book_appointment", "record_details", "select_time", "appointment_confirmed"],
        ["book_appointment", "record_details", "no_time_works", "arrange_callback"],
        # Rescheduling shares the booking's time-slot node and its two ways out.
        ["reschedule_appointment", "record_appointment_to_move", "select_time", "appointment_confirmed"],
        ["reschedule_appointment", "record_appointment_to_move", "no_time_works", "arrange_callback"],
        ["cancel_appointment", "record_appointment_to_cancel", "cancellation_confirmed", "appointment_cancelled"],
        ["cancel_appointment", "record_appointment_to_cancel", "keep_appointment", "appointment_kept"],
    ]
    # Every route finishes by hanging up.
    end_nodes = {n.name for n in builder.config.nodes if n.end}
    assert {route[-1] for route in routes} == end_nodes
