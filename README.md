# Prosper Challenge — Agent Composer

Voice AI for healthcare scheduling. An agent is a **graph of nodes** (Pipecat Flows), defined declaratively as JSON and compiled into a runnable voice pipeline.

- **Phase 1** — a UI to edit the node graph and place a test call.
- **Phase 2** — an AI Composer that generates and iterates on agents from natural language.

```
browser mic  ->  ElevenLabs STT  ->  OpenAI LLM  ->  ElevenLabs TTS  ->  browser
```

Pipecat's dev runner ships a **prebuilt browser client**, so the test-call UI comes for free — no frontend code to write yet.

## Quickstart

Requires **Python 3.11+** and [**uv**](https://docs.astral.sh/uv/getting-started/installation/) (uv will fetch a matching Python for you if needed). Run from the repo root:

```bash
make install   # uv sync — creates backend/.venv and installs from uv.lock
make run       # uv run python bot.py
```

While working on the backend, use `make dev` instead: it restarts the bot whenever a `.py` file under `backend/` changes (a restart drops any call in progress). Agent changes made in the editor never need a restart, since each call sends the agent on screen.

Open the URL it prints (default `http://localhost:7860/client`), click **Connect**, allow mic access, and talk to the agent. `Ctrl+C` to stop. (`make help` lists all targets.)

Prefer raw `uv`? The same commands without `make`:

```bash
uv sync --directory backend            # install dependencies
uv run --directory backend python bot.py   # run the agent
```\
\
Remember to update the `.env` file accordingly.

## Agent editor (frontend)

A React + TypeScript graph editor for building agents visually. Requires **Node 22+** (`frontend/.nvmrc`).

```bash
make ui-install   # npm install in frontend/
make ui           # Vite dev server at http://localhost:5173
make ui-test      # Vitest: model, layout and UI tests
make ui-e2e       # Playwright: clicks through the real app in Chromium
                  # (first time: npx --prefix frontend playwright install chromium)
make ui-e2e-open  # the same tests in Playwright's interactive UI
```

- The page opens with a single **Greeting** node. Click any node or edge to edit it in the side panel.
- Hover a node and click **[+]** to add an edge. Hover a dangling edge and click **[+]** to add its target node.
- **Drag a node onto an empty edge** to attach it there, or **onto another node** to hang it under that node through a new edge; either way it brings everything below it, and the edge it came from stays where it was, left empty. **Drag an edge onto a node** to make it come out of that node, with everything below it. The start node stays put, and nothing can be dropped below itself. While dragging, only the line being broken disappears.
- **Press and drag from a [+]** to an existing node to link to it: from a node's [+] this adds an edge to it, from an empty edge's [+] it points the edge there. This is how you make loops (e.g. "go back and collect the details again") and paths that join up. Links that point back up or sideways are dashed and run down the right-hand side.
- **Undo / Redo** (top bar, or ⌘Z / ⇧⌘Z; Ctrl+Z / Ctrl+Y elsewhere) step back through every change: moves, adds, deletes, field edits, imports and resets. Typing in one field counts as a single step until you switch fields or pause for a second. History is kept for the current session (last 100 steps).
- **Import JSON** (next to Export) loads an agent file in the backend format, e.g. `backend/example_flow.json`, and replaces the graph with it. Files the editor can't represent are rejected with the reasons; anything dropped on the way in (e.g. `pre_actions`) is listed as a warning. Loops and shared nodes import fine; every node must be reachable from the start node.
- The view zooms out to fit as the graph grows. Use the bottom-left controls to zoom manually.
- Work is saved in the browser (localStorage). **Export JSON** downloads the agent in the `example_flow.json` format and is enabled once validation passes. Among other checks, every branch must end the call: a node with no outgoing edges must be marked "Ends the call", and no loop may go round forever without a way out to the end.
- **Speak to agent** (top-left of the canvas, under the title; enabled once the agent is valid) calls the agent on screen with your microphone. Start the voice backend first with `make run` (or `make dev`); the editor talks to it at `http://localhost:7860` (set `VITE_BACKEND_URL` to change that). During the call a panel under the button shows the live transcript, and the node the conversation is in lights up on the graph. Edits made during a call apply to the next one.
- **Copilot** (the panel along the bottom) is a chat with an LLM about designing your agent. It's served by the same backend (`make dev`), which holds the OpenAI key and streams replies from `POST /api/copilot/chat`; set `COPILOT_MODEL` in `backend/.env` to use a model other than `gpt-4o`. The conversation is kept in the browser. For now it only chats: it can't see or change the graph yet. Drag the panel's top edge to resize it, or click **Copilot** to collapse it.
- To run an exported agent without the editor, point `AGENT_FLOW` in `bot.py` at the file.

## Tests & CI

```bash
make test         # backend: pytest (AgentBuilder, schema, the editor's exported JSON)
make ui-test      # frontend: Vitest unit + component tests
make ui-e2e       # frontend: Playwright end-to-end tests
```

`backend/tests/test_llm_routing.py` checks that the LLM takes the right edge for what the caller says (book vs reschedule vs cancel, and so on) in `branching_flow.json`. It calls OpenAI, so it's skipped unless you opt in: `RUN_LLM_TESTS=1 uv run --directory backend pytest tests/test_llm_routing.py -v`.

GitHub Actions (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`. A first job checks which parts changed, and each suite runs only when it's relevant:

| Job | Runs when these change |
| --- | --- |
| Backend tests | `backend/**`, `frontend/e2e/fixtures/**` |
| Frontend lint, type-check & unit tests | `frontend/**`, `backend/example_flow.json` |
| Frontend end-to-end tests | `frontend/**`, `backend/example_flow.json` |

The two cross-component paths are the shared contract: the frontend compares its export against `example_flow.json`, and the backend loads the editor's exported `new_agent.json`. Editing the workflow runs everything.

A final **CI result** job always runs and fails if any suite failed. Branch protection on `main` requires only this check, so PRs that skip a suite can still merge.

## Layout

| Path | Responsibility |
| --- | --- |
| `backend/bot.py` | The voice pipeline (WebRTC + ElevenLabs STT/TTS + OpenAI LLM). Loads an agent JSON via `AgentBuilder` and runs it. No graph logic lives here. |
| `backend/copilot/` | The copilot chat endpoint (`POST /api/copilot/chat`): streams OpenAI replies to the editor as NDJSON. `bot.py` mounts it on the voice server. |
| `backend/agent_builder/` | All agent-building code. `schema.py` = the declarative `AgentConfig` / `Node` / `Edge` contract; `builder.py` = `AgentBuilder`, which loads + validates the JSON and compiles it into a Pipecat Flows graph. |
| `backend/example_flow.json` | The example agent **as data** — a clinic scheduler. The artifact the Phase 2 Composer generates/edits. |
| `backend/branching_flow.json` | A branching example: the caller's answer picks the edge (book / reschedule / cancel, a slot or "none work", confirm or keep a cancellation). Import it into the editor to try it. |
| `frontend/src/model/` | Editor state (zustand, persisted), validation, and export to the backend JSON format. |
| `frontend/src/graph/` | React Flow canvas, node/edge-pill components, and the tree layout. |
| `frontend/src/panel/` | Right-hand side panel with the node, edge and agent-settings forms. |
| `frontend/src/copilot/` | The copilot chat panel along the bottom, its store, and the client for the backend's chat endpoint. |

To run a different agent, point `AGENT_FLOW` in `bot.py` at another JSON file, or call it from the editor with **Speak to agent**: the editor sends its agent JSON with the call (`POST /start` with `{"body": {"agent": ...}}`), and the bot runs that instead of `AGENT_FLOW`. While a call runs, the bot tells the editor which node the conversation is in (an RTVI server message `{"type": "node", "node": <name>}`).