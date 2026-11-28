import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Agent } from './cases';

// An LLM grading the copilot's work against a fixed design checklist: the parts of a
// good agent that code can't check. It runs here in Node (never in the browser), so it
// calls OpenAI directly with the key from backend/.env.

export const CRITERIA = {
  fulfils_request: 'The changes do what the user asked. For a question, it answered without changing the agent.',
  no_unrequested_changes: "Nothing was changed that the request didn't call for (small wording updates that keep the agent consistent are fine).",
  distinct_edges: 'Edges leaving the same node have clearly different descriptions, so the agent can always tell which one to take.',
  answers_covered: 'Wherever the agent asks the caller a question, there is an edge for each answer the request implies (e.g. both yes and no).',
  consistent_tasks: "Each task message fits its node: a node with edges asks for what its edges need, an end node wraps up, and the greeting only offers options that exist.",
  accurate_reply: "The copilot's final message accurately says what it changed (or answers the question).",
} as const;

export type Criterion = keyof typeof CRITERIA;
export type Verdict = Record<Criterion, { pass: boolean; reason: string }>;

function apiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  // The eval runs from frontend/ (see run.sh); import.meta.url isn't a file URL under jsdom.
  const env = readFileSync(resolve(process.cwd(), '../backend/.env'), 'utf8');
  const key = env.match(/^\s*OPENAI_API_KEY\s*=\s*["']?([^"'\s]+)/m)?.[1];
  if (!key) throw new Error('OPENAI_API_KEY is not set (in the environment or backend/.env).');
  return key;
}

const strip = ({ issues: _issues, ...agent }: Agent) => agent;

export async function judge(input: { request: string; before: Agent; after: Agent; edits: string[]; reply: string }): Promise<Verdict> {
  const prompt = [
    'You review changes an AI copilot made to a voice agent. The agent is a graph: nodes are steps (task_messages say',
    'what the agent does there; end: true hangs up), edges are the transitions the agent takes depending on what the',
    'caller says (description says when). Grade the result against each criterion. Be strict but fair: fail a criterion',
    'only for a concrete problem you can point to, and say what it is in one sentence.',
    '',
    `The user asked: ${input.request}`,
    '',
    `Agent before:\n${JSON.stringify(strip(input.before))}`,
    '',
    `Agent after:\n${JSON.stringify(strip(input.after))}`,
    '',
    `Edits the copilot made:\n${input.edits.join('\n') || '(none)'}`,
    '',
    `The copilot's final message:\n${input.reply || '(none)'}`,
    '',
    'Criteria:',
    ...Object.entries(CRITERIA).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'Reply with JSON only: {"<criterion>": {"pass": true|false, "reason": "..."}, ...} with every criterion.',
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: process.env.EVAL_JUDGE_MODEL ?? 'gpt-4o',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!response.ok) throw new Error(`Judge request failed: HTTP ${response.status} ${await response.text()}`);
  const data = (await response.json()) as { choices: { message: { content: string } }[] };
  const verdict = JSON.parse(data.choices[0].message.content) as Partial<Verdict>;
  for (const c of Object.keys(CRITERIA) as Criterion[])
    verdict[c] ??= { pass: false, reason: 'The judge gave no verdict.' };
  return verdict as Verdict;
}
