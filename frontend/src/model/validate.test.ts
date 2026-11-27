import { describe, expect, it } from 'vitest';
import { actions, addEdge, addField, addNode, buildExampleFlow, draft, nodeNamed } from '../test/helpers';
import { erroredIds, issuesFor, validate, type Issue } from './validate';

const messages = (issues: Issue[], severity?: Issue['severity']) =>
  issues.filter((i) => !severity || i.severity === severity).map((i) => i.message);

describe('validate', () => {
  it('a fresh agent needs a task message and an edge', () => {
    const issues = validate(draft());
    expect(messages(issues, 'error')).toEqual(['Task message is required.']);
    expect(messages(issues, 'warning')).toEqual([
      expect.stringContaining('No outgoing edges and not marked as ending the call'),
    ]);
  });

  it('the example flow is fully valid', () => {
    buildExampleFlow();
    expect(validate(draft())).toEqual([]);
  });

  it('requires agent name, model and voice', () => {
    actions().updateAgent({ name: ' ', model: '', voiceId: '' });
    const agentIssues = validate(draft()).filter((i) => i.target.kind === 'agent');
    expect(agentIssues.map((i) => i.field).sort()).toEqual(['model', 'name', 'voiceId']);
  });

  it('flags empty and duplicate node names', () => {
    buildExampleFlow();
    const collect = Object.values(draft().nodes).find((n) => n.name === 'collect_details')!;
    const offer = Object.values(draft().nodes).find((n) => n.name === 'offer_times')!;
    actions().updateNode(collect.id, { name: 'confirm' });
    actions().updateNode(offer.id, { name: '   ' });

    const issues = validate(draft());
    expect(messages(issues.filter((i) => i.field === 'name'))).toEqual([
      'Another node is also named "confirm".',
      'Name is required.',
      'Another node is also named "confirm".',
    ]);
  });

  it('flags invalid and duplicate function names, but only within the same source node', () => {
    const g = draft().initialNodeId;
    const ok = addEdge(g, { function: 'go', description: 'd' });
    const dup = addEdge(g, { function: 'go', description: 'd' });
    const bad = addEdge(g, { function: '1st-step', description: 'd' });
    const child = addNode(ok, { taskMessage: 't', end: true });
    addNode(dup, { taskMessage: 't', end: true });
    addNode(bad, { taskMessage: 't', end: true });
    const elsewhere = addEdge(child, { function: 'go', description: 'd' }); // same name, other node: fine

    const fnIssues = (id: string) => validate(draft()).filter((i) => i.target.kind === 'edge' && i.target.id === id);
    expect(messages(fnIssues(ok))).toEqual(['Another edge from this node is also called "go".']);
    expect(messages(fnIssues(bad))).toEqual([expect.stringContaining('letters, digits and underscores')]);
    expect(messages(fnIssues(elsewhere).filter((i) => i.field === 'function'))).toEqual([]);
  });

  it('requires an edge description and a target', () => {
    const e = addEdge(draft().initialNodeId);
    const issues = validate(draft()).filter((i) => i.target.kind === 'edge');
    expect(issues.map((i) => [i.field, i.severity])).toEqual([
      ['description', 'error'],
      ['target', 'error'],
    ]);
    addNode(e);
    expect(validate(draft()).some((i) => i.field === 'target')).toBe(false);
  });

  it('checks edge field names', () => {
    const e = addEdge(draft().initialNodeId, { function: 'go', description: 'd' });
    addNode(e, { taskMessage: 't', end: true });
    addField(e, { key: '', description: '' });
    addField(e, { key: 'bad key', description: '' });
    addField(e, { key: 'dup', description: '' });
    addField(e, { key: 'dup', description: '' });

    const props = draft().edges[e].properties;
    const issues = validate(draft());
    expect(messages(issuesFor(issues, `property:${props[0].id}`))).toEqual(['Field 1: name is required.']);
    expect(messages(issuesFor(issues, `property:${props[1].id}`))).toEqual([
      'Field "bad key": use letters, digits and underscores only.',
    ]);
    expect(messages(issuesFor(issues, `property:${props[2].id}`))).toEqual(['Field "dup" is defined more than once.']);
  });

  it('warns when an ending node still has edges', () => {
    const g = draft().initialNodeId;
    actions().updateNode(g, { taskMessage: 't', end: true });
    addNode(addEdge(g, { function: 'go', description: 'd' }), { taskMessage: 't', end: true });
    const issues = validate(draft());
    expect(messages(issues, 'error')).toEqual([]);
    expect(messages(issues, 'warning')).toEqual([expect.stringContaining('Ends the call, but has outgoing edges')]);
  });
});

describe('validate: disconnected parts', () => {
  it('flags nodes cut off from the start until they are reconnected', () => {
    buildExampleFlow();
    const choose = Object.values(draft().edges).find((e) => e.function === 'choose_intent')!;
    const offer = nodeNamed('offer_times');
    actions().repointEdge(choose.id, offer.id); // greeting now skips collect_details

    const cut = validate(draft()).filter((i) => i.field === 'reachable');
    expect(cut.map((i) => i.target)).toEqual([{ kind: 'node', id: nodeNamed('collect_details').id }]);
    expect(cut[0]).toMatchObject({ severity: 'error', message: expect.stringContaining('Not connected to the start node') });

    // Moving it back under greeting reconnects it.
    actions().moveNode(nodeNamed('collect_details').id, nodeNamed('greeting').id);
    expect(validate(draft()).filter((i) => i.field === 'reachable')).toEqual([]);
  });

  it('a loop back to an earlier node is valid', () => {
    buildExampleFlow();
    const confirm = nodeNamed('confirm');
    actions().updateNode(confirm.id, { end: false });
    const again = addEdge(confirm.id, { function: 'start_over', description: 'Caller wants another appointment.' });
    actions().repointEdge(again, nodeNamed('greeting').id);
    expect(validate(draft())).toEqual([]);
  });
});

describe('erroredIds', () => {
  it('collects nodes and edges with errors, ignoring warnings and agent issues', () => {
    actions().updateAgent({ name: '' });
    const g = draft().initialNodeId;
    const e = addEdge(g);
    const ids = erroredIds(validate(draft()));
    expect(ids).toEqual(new Set([g, e]));

    actions().updateNode(g, { taskMessage: 't', end: true }); // now only a warning remains on g
    actions().deleteEdge(e);
    expect(erroredIds(validate(draft()))).toEqual(new Set());
  });
});
