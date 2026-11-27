import { useEditor } from '../model/store';
import type { AgentEdge, AgentNode, Id } from '../model/types';

export const actions = () => useEditor.getState();
export const draft = () => useEditor.getState().draft;

export function nodeNamed(name: string): AgentNode {
  const n = Object.values(draft().nodes).find((x) => x.name === name);
  if (!n) throw new Error(`No node named ${name}`);
  return n;
}

export function edgesFrom(nodeId: Id): AgentEdge[] {
  return Object.values(draft().edges).filter((e) => e.sourceId === nodeId);
}

/** The id of the edge most recently added (addEdge selects it). */
function selectedId(): Id {
  const sel = useEditor.getState().selection;
  if (!sel || sel.kind === 'agent') throw new Error('Nothing selected');
  return sel.id;
}

/** Hover-[+] on a node, as the UI does: returns the new dangling edge's id. */
export function addEdge(sourceId: Id, patch: Partial<Pick<AgentEdge, 'function' | 'description'>> = {}): Id {
  actions().addEdge(sourceId);
  const id = selectedId();
  if (Object.keys(patch).length) actions().updateEdge(id, patch);
  return id;
}

/** Hover-[+] on an edge: returns the new target node's id. */
export function addNode(edgeId: Id, patch: Partial<Omit<AgentNode, 'id'>> = {}): Id {
  actions().addNodeFromEdge(edgeId);
  const id = selectedId();
  if (Object.keys(patch).length) actions().updateNode(id, patch);
  return id;
}

export function addField(
  edgeId: Id,
  field: { key: string; description: string; enumText?: string; required?: boolean },
) {
  actions().addProperty(edgeId);
  const props = draft().edges[edgeId].properties;
  actions().updateProperty(edgeId, props[props.length - 1].id, { enumText: '', required: true, ...field });
}

/**
 * A small fixture graph, built through store actions:
 *
 *   Greeting ─a→ A ─b→ B
 *            └c→ C
 */
export function buildTree() {
  const g = draft().initialNodeId;
  const a = addEdge(g, { function: 'a' });
  const A = addNode(a, { name: 'A' });
  const b = addEdge(A, { function: 'b' });
  const B = addNode(b, { name: 'B' });
  const c = addEdge(g, { function: 'c' });
  const C = addNode(c, { name: 'C' });
  return { g, a, A, b, B, c, C };
}

/** Recreates backend/example_flow.json entirely through store actions, as a user would in the UI. */
export function buildExampleFlow() {
  actions().updateAgent({ name: 'Prosper Scheduler' });
  const greeting = draft().initialNodeId;
  actions().updateNode(greeting, {
    name: 'greeting',
    taskMessage:
      "Greet the caller, say you're the clinic's scheduling assistant, and ask whether they'd like to book, reschedule, or cancel an appointment.",
  });

  const e1 = addEdge(greeting, {
    function: 'choose_intent',
    description: 'Record what the caller wants to do once they say it.',
  });
  addField(e1, { key: 'intent', description: 'What the caller wants to do.', enumText: 'book, reschedule, cancel' });
  const collect = addNode(e1, {
    name: 'collect_details',
    taskMessage:
      "Collect the caller's full name and the reason for the visit. Ask for whatever is still missing, one question at a time.",
  });

  const e2 = addEdge(collect, {
    function: 'record_details',
    description: "Record the caller's name and reason once both are known.",
  });
  addField(e2, { key: 'full_name', description: "Caller's full name." });
  addField(e2, { key: 'reason', description: 'Reason for the visit.' });
  const offer = addNode(e2, {
    name: 'offer_times',
    taskMessage: 'Offer exactly two options: Tuesday at 10 AM, or Thursday at 2 PM. Ask which one works for them.',
  });

  const e3 = addEdge(offer, { function: 'select_time', description: 'Record the slot the caller picks.' });
  addField(e3, { key: 'slot', description: 'The chosen appointment slot.', enumText: 'Tuesday 10 AM, Thursday 2 PM' });
  addNode(e3, {
    name: 'confirm',
    taskMessage:
      'Confirm the appointment back to the caller, including their name and the chosen time, thank them, and say goodbye.',
    end: true,
  });
}
