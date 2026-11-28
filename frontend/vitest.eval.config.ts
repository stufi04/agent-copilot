/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// The copilot eval (evals/): real OpenAI calls, so never part of `npm test`.
// Run it with `make copilot-eval`, which starts a backend for it.
export default defineConfig({
  test: {
    environment: 'jsdom', // the editor's stores keep state in localStorage
    include: ['evals/**/*.eval.ts'],
    fileParallelism: false,
    disableConsoleIntercept: true, // print the summary as is
  },
});
