# Prosper Challenge — run everything from the repo root.
# Dependencies are managed with uv (https://docs.astral.sh/uv/).

PROJECT := backend
UI := frontend

.PHONY: help install run test clean ui-install ui ui-test ui-e2e ui-e2e-open

help: ## Show available targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'

install: ## Create the venv and install dependencies (from uv.lock)
	uv sync --directory $(PROJECT)

run: ## Run the voice agent (then open http://localhost:7860/client)
	uv run --directory $(PROJECT) python bot.py

test: ## Run the backend tests (pytest)
	uv run --directory $(PROJECT) pytest

ui-install: ## Install the agent editor's npm dependencies (Node 22+)
	npm --prefix $(UI) install

ui: ## Run the agent editor (then open http://localhost:5173)
	npm --prefix $(UI) run dev

ui-test: ## Run the agent editor's tests (Vitest)
	npm --prefix $(UI) test

ui-e2e: ## Run the agent editor's end-to-end tests (Playwright, real Chromium)
	npm --prefix $(UI) run e2e

ui-e2e-open: ## Open the end-to-end tests in Playwright's interactive UI
	npm --prefix $(UI) run e2e:ui

clean: ## Remove the venv and Python caches
	rm -rf $(PROJECT)/.venv
	find $(PROJECT) -type d -name __pycache__ -prune -exec rm -rf {} +
