import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { BACKEND_URL } from '../src/backend';
import { setChatStream, useCopilot } from '../src/copilot/copilot';
import { describeAgent } from '../src/model/describe';
import { importAgentData } from '../src/model/import';
import { useEditor } from '../src/model/store';
import { CASES, CLINIC, COMMON_CHECKS, type EvalCase } from './cases';
import { CRITERIA, judge, type Criterion, type Verdict } from './judge';

// Scores the copilot on realistic requests (cases.ts), end to end: the editor's own
// copilot loop and tools, the backend's prompt and endpoint, and the real model.
// Each case starts from a fixed agent. Real OpenAI calls, so it's opt-in:
//
//     make copilot-eval          (starts a backend on a spare port, runs this, stops it)
//
// The report (every case, check and verdict) is written to test-results/copilot-eval/.

interface CaseResult {
  id: string;
  request: string;
  seconds: number;
  steps: number;
  edits: string[];
  toolCalls: { name: string; arguments: string }[];
  reply: string;
  error: string | null;
  checks: Record<string, true | string>;
  verdict: Verdict | null;
}

const results: CaseResult[] = [];

function startFrom(start: EvalCase['start']) {
  useEditor.getState().reset();
  if (start === 'clinic') {
    const r = importAgentData(CLINIC);
    if (!r.ok) throw new Error(r.errors.join());
    useEditor.getState().loadDraft(r.draft);
  }
  useCopilot.getState().clear();
}

beforeAll(async () => {
  setChatStream(null); // the real backend
  const up = await fetch(`${BACKEND_URL}/api/copilot/chat`, { method: 'POST', body: '{}' }).catch(() => null);
  if (!up) throw new Error(`No backend at ${BACKEND_URL}. Run this with "make copilot-eval".`);
});

describe('copilot eval', () => {
  for (const c of CASES) {
    it(c.id, { timeout: 240_000 }, async () => {
      startFrom(c.start);
      const before = describeAgent(useEditor.getState().draft);
      const started = Date.now();
      await useCopilot.getState().send(c.request);
      const { messages, error } = useCopilot.getState();
      const after = describeAgent(useEditor.getState().draft);
      const last = messages.at(-1);
      const reply = last?.role === 'assistant' ? last.content : '';
      const edits = messages.flatMap((m) => (m.role === 'tool' ? [`${m.ok ? '✓' : '✗'} ${m.summary}`] : []));
      // What the model actually sent, for working out why a case failed.
      const toolCalls = messages.flatMap((m) => (m.role === 'assistant' ? (m.toolCalls ?? []) : []));
      const outcome = { before, after, reply };

      const checks: CaseResult['checks'] = {};
      for (const [name, check] of Object.entries({ ...COMMON_CHECKS, ...c.checks })) checks[name] = check(outcome);
      const verdict = error ? null : await judge({ request: c.request, before, after, edits, reply });

      results.push({
        id: c.id,
        request: c.request,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        steps: messages.filter((m) => m.role === 'assistant').length,
        edits,
        toolCalls: toolCalls.map(({ name, arguments: args }) => ({ name, arguments: args })),
        reply,
        error,
        checks,
        verdict,
      });
    });
  }
});

afterAll(() => {
  if (!results.length) return;
  const pct = (n: number, of: number) => `${n}/${of} (${Math.round((100 * n) / of)}%)`;
  const lines: string[] = ['', '=== Copilot eval ==='];

  for (const r of results) {
    const failedChecks = Object.entries(r.checks).filter(([, v]) => v !== true);
    const failedCriteria = r.verdict ? Object.entries(r.verdict).filter(([, v]) => !v.pass) : [];
    const ok = !r.error && !failedChecks.length && !failedCriteria.length;
    lines.push(`\n${ok ? '✓' : '✗'} ${r.id}  (${r.seconds}s, ${r.steps} model steps, ${r.edits.length} edits)`);
    if (r.error) lines.push(`    error: ${r.error}`);
    for (const [name, why] of failedChecks) lines.push(`    check "${name}": ${why}`);
    for (const [name, v] of failedCriteria) lines.push(`    judge "${name}": ${v.reason}`);
  }

  const allChecks = results.flatMap((r) => Object.values(r.checks));
  lines.push('\n--- summary ---');
  lines.push(`checks passed      ${pct(allChecks.filter((v) => v === true).length, allChecks.length)}`);
  for (const c of Object.keys(CRITERIA) as Criterion[]) {
    const judged = results.filter((r) => r.verdict);
    lines.push(`${c.padEnd(22)} ${pct(judged.filter((r) => r.verdict![c].pass).length, judged.length)}`);
  }
  const clean = results.filter((r) => !r.error && Object.values(r.checks).every((v) => v === true) && r.verdict && Object.values(r.verdict).every((v) => v.pass));
  lines.push(`cases fully passed ${pct(clean.length, results.length)}`);
  console.log(lines.join('\n'));

  const dir = resolve(process.cwd(), 'test-results/copilot-eval'); // run from frontend/
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2));
  console.log(`\nFull report: ${file}`);
});
