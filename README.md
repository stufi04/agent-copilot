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
- **Drag a node onto another node** to move it there, with everything below it (the edge leading into it moves too). The start node stays put, and a node can't be dropped into its own subtree. Edges can't be dragged on their own, so the agent is always a tree: no loops and no node reached by two edges.
- **Import JSON** (next to Export) loads an agent file in the backend format, e.g. `backend/example_flow.json`, and replaces the graph with it. Files the editor can't represent are rejected with the reasons; anything dropped on the way in (e.g. `pre_actions`) is listed as a warning. Only tree-shaped agents import: no loops or nodes reached by more than one edge.
- The view zooms out to fit as the graph grows. Use the bottom-left controls to zoom manually.
- Work is saved in the browser (localStorage). **Export JSON** downloads the agent in the `example_flow.json` format and is enabled once validation passes.
- Run an exported agent by pointing `AGENT_FLOW` in `bot.py` at the file.

## Tests & CI

```bash
make test         # backend: pytest (AgentBuilder, schema, the editor's exported JSON)
make ui-test      # frontend: Vitest unit + component tests
make ui-e2e       # frontend: Playwright end-to-end tests
```

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
| `backend/agent_builder/` | All agent-building code. `schema.py` = the declarative `AgentConfig` / `Node` / `Edge` contract; `builder.py` = `AgentBuilder`, which loads + validates the JSON and compiles it into a Pipecat Flows graph. |
| `backend/example_flow.json` | The example agent **as data** — a clinic scheduler. The artifact the Phase 2 Composer generates/edits. |
| `frontend/src/model/` | Editor state (zustand, persisted), validation, and export to the backend JSON format. |
| `frontend/src/graph/` | React Flow canvas, node/edge-pill components, and the tree layout. |
| `frontend/src/panel/` | Right-hand side panel with the node, edge and agent-settings forms. |

To run a different agent, point `AGENT_FLOW` in `bot.py` at another JSON file.