import branching from '../../backend/branching_flow.json';
import type { describeAgent } from '../src/model/describe';

// Realistic requests to the copilot, each with checks that must hold afterwards.
// The checks are the certain part of the score (structure, names, what changed); the
// judge (judge.ts) grades the rest against a fixed design checklist.

export type Agent = ReturnType<typeof describeAgent>;
export type AgentNode = Agent['nodes'][number];

export interface Outcome {
  before: Agent;
  after: Agent;
  /** The copilot's final message. */
  reply: string;
}

/** A check: true if it holds, otherwise why not. */
export type Check = (o: Outcome) => true | string;

export interface EvalCase {
  id: string;
  /** The agent the editor shows when the request is made. */
  start: 'clinic' | 'fresh';
  request: string;
  checks: Record<string, Check>;
}

export const CLINIC = branching;

// ---- helpers ----

export const node = (a: Agent, name: string): AgentNode | undefined => a.nodes.find((n) => n.name === name);
const edges = (a: Agent, name: string) => node(a, name)?.edges ?? [];
const task = (n: AgentNode | undefined) => n?.task_messages.map((m) => m.content).join(' ') ?? '';
const without = (a: Agent, ...names: string[]) => a.nodes.filter((n) => !names.includes(n.name));
const errors = (a: Agent) => a.issues.filter((i) => i.startsWith('Error'));

const holds = (ok: boolean, why: string): true | string => (ok ? true : why);

/** Nodes reachable from `from` (inclusive). */
function reachable(a: Agent, from: string): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const e of edges(a, name)) if (e.target) queue.push(e.target);
  }
  return seen;
}

/** The nodes other than `changed` are exactly as they were. */
const othersUntouched =
  (...changed: string[]): Check =>
  ({ before, after }) => {
    const moved = without(before, ...changed).filter(
      (n) => JSON.stringify(n) !== JSON.stringify(node(after, n.name)),
    );
    return holds(!moved.length, `also changed: ${moved.map((n) => n.name).join(', ')}`);
  };

// ---- the cases ----

export const CASES: EvalCase[] = [
  {
    id: 'add-hours-branch',
    start: 'clinic',
    request:
      "Add a branch to greeting for callers asking about opening hours: tell them we're open 9 to 5 on weekdays, then end the call.",
    checks: {
      'greeting gains one edge': ({ after }) => holds(edges(after, 'greeting').length === 4, `greeting has ${edges(after, 'greeting').length} edges`),
      'the new branch ends the call': ({ before, after }) => {
        const added = edges(after, 'greeting').find((e) => !edges(before, 'greeting').some((b) => b.function === e.function));
        const target = added?.target ? node(after, added.target) : undefined;
        if (!target) return 'no new edge with a target';
        return holds(target.end === true || [...reachable(after, target.name)].some((n) => node(after, n)?.end), `${target.name} doesn't lead to an end`);
      },
      'the hours are in a task message': ({ after }) =>
        holds(after.nodes.some((n) => /9/.test(task(n)) && /5/.test(task(n))), 'no task message gives 9 to 5'),
      'other nodes untouched': othersUntouched('greeting'),
    },
  },
  {
    id: 'rename-node',
    start: 'clinic',
    request: 'Rename collect_details to collect_patient_details.',
    checks: {
      'renamed': ({ after }) =>
        holds(!!node(after, 'collect_patient_details') && !node(after, 'collect_details'), 'collect_details is still there, or the new name is missing'),
      'book_appointment still leads to it': ({ after }) =>
        holds(edges(after, 'greeting').find((e) => e.function === 'book_appointment')?.target === 'collect_patient_details', 'book_appointment points elsewhere'),
      'nothing else changed': ({ before, after }) => {
        const back = JSON.parse(JSON.stringify(after).replaceAll('"collect_patient_details"', '"collect_details"'));
        return holds(JSON.stringify(back.nodes) === JSON.stringify(before.nodes), 'more than the name changed');
      },
    },
  },
  {
    id: 'anything-else-loop',
    start: 'clinic',
    request:
      'After an appointment is confirmed, ask whether they need anything else. If they do, go back to the greeting; if not, say goodbye and end the call.',
    checks: {
      'a way back to greeting after confirming': ({ after }) => {
        const fromConfirmed = reachable(after, 'appointment_confirmed');
        const loops = [...fromConfirmed].some((n) => edges(after, n).some((e) => e.target === 'greeting'));
        return holds(loops, 'nothing after appointment_confirmed leads back to greeting');
      },
      'a way to end after confirming': ({ after }) => {
        const ends = [...reachable(after, 'appointment_confirmed')].filter((n) => n !== 'appointment_confirmed' && node(after, n)?.end);
        return holds(ends.length > 0 || node(after, 'appointment_confirmed')?.end === true, 'no end reachable after appointment_confirmed');
      },
      'the question is branched': ({ after }) => {
        const branching = [...reachable(after, 'appointment_confirmed')].some((n) => edges(after, n).length >= 2 && n !== 'greeting');
        return holds(branching, 'no node after confirming has two edges (yes / no)');
      },
    },
  },
  {
    id: 'collect-insurance',
    start: 'clinic',
    request: "When booking, also collect the caller's insurance provider before offering times.",
    checks: {
      'insurance is collected on the booking path': ({ after }) => {
        const path = reachable(after, 'collect_details');
        const collected = [...path].some((n) => edges(after, n).some((e) => Object.keys(e.properties).some((k) => /insur/i.test(k))));
        return holds(collected, 'no edge on the booking path has an insurance field');
      },
      'booking still reaches offer_times': ({ after }) => holds(reachable(after, 'collect_details').has('offer_times'), 'offer_times is cut off'),
      'cancelling untouched': othersUntouched('collect_details', 'offer_times', 'greeting', 'find_appointment_to_move'),
    },
  },
  {
    id: 'question-only',
    start: 'clinic',
    request: 'What happens if a caller says they want to cancel?',
    checks: {
      'agent unchanged': ({ before, after }) => holds(JSON.stringify(before) === JSON.stringify(after), 'the agent was changed'),
      'mentions the confirmation step': ({ reply }) => holds(/confirm/i.test(reply), "the reply doesn't mention confirming the cancellation"),
    },
  },
  {
    id: 'remove-reschedule',
    start: 'clinic',
    request: 'We no longer support rescheduling over the phone. Remove that option entirely.',
    checks: {
      'no reschedule edge': ({ after }) =>
        holds(!edges(after, 'greeting').some((e) => /reschedul|move/i.test(e.function)), 'greeting still has a reschedule edge'),
      'its node is gone': ({ after }) => holds(!node(after, 'find_appointment_to_move'), 'find_appointment_to_move is still there'),
      'booking keeps offer_times': ({ after }) => holds(reachable(after, 'greeting').has('offer_times'), 'offer_times went too'),
      "greeting doesn't offer it": ({ after }) => holds(!/reschedul/i.test(task(node(after, 'greeting'))), "greeting's task still mentions rescheduling"),
    },
  },
  {
    id: 'pharmacy-from-scratch',
    start: 'fresh',
    request:
      "Build an agent for a pharmacy that takes prescription refill requests: verify the caller's name and date of birth, ask which prescription to refill, confirm which branch they'll pick it up from, then end the call. If at any point they'd rather speak to a pharmacist, tell them one will call back and end the call.",
    checks: {
      'renamed from "New agent"': ({ after }) => holds(after.name !== 'New agent', 'still called "New agent"'),
      'collects date of birth': ({ after }) =>
        holds(after.nodes.some((n) => (n.edges ?? []).some((e) => Object.keys(e.properties).some((k) => /birth|dob/i.test(k)))), 'no date-of-birth field'),
      'at least four steps': ({ after }) => holds(after.nodes.length >= 4, `only ${after.nodes.length} nodes`),
      'a pharmacist branch': ({ after }) =>
        holds(after.nodes.some((n) => /pharmacist/i.test(n.name) || (n.edges ?? []).some((e) => /pharmacist/i.test(e.function))), 'no pharmacist branch'),
    },
  },
  {
    id: 'overlapping-intent',
    start: 'clinic',
    request: 'Add an edge from greeting for callers who want to change their appointment.',
    checks: {
      // reschedule_appointment already covers this; a second edge would make routing ambiguous.
      'no duplicate of reschedule_appointment': ({ before, after }) =>
        holds(edges(after, 'greeting').length === edges(before, 'greeting').length, `greeting went from ${edges(before, 'greeting').length} to ${edges(after, 'greeting').length} edges`),
    },
  },
];

/** Checks every case gets, whatever the request. */
export const COMMON_CHECKS: Record<string, Check> = {
  'no errors left': ({ before, after }) => {
    const fresh = errors(after).filter((e) => !errors(before).includes(e));
    return holds(!fresh.length, fresh.join(' | '));
  },
};
