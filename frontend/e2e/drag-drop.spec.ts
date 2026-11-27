import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Editor, type AgentJson } from './editor';

// Drag & drop with a real mouse, starting from the clinic scheduler (new_agent.json):
//
//   Greeting ─choose_intent→ Collect Details ─record_details→ Offer Times ─select_time→ Confirm

const newAgent: AgentJson = JSON.parse(
  readFileSync(new URL('./fixtures/new_agent.json', import.meta.url), 'utf8'),
);

type Exported = AgentJson & { nodes: { name: string; edges?: { function: string; target: string }[] }[] };
const edgesOf = (json: Exported, node: string) =>
  (json.nodes.find((n) => n.name === node)?.edges ?? []).map((e) => `${e.function}→${e.target}`);

test.beforeEach(async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  await editor.buildAgent(newAgent);
});

test('dragging a node onto another node moves it there with its whole subtree', async ({ page }) => {
  const editor = new Editor(page);
  const offer = editor.node('Offer Times');
  const confirm = editor.node('Confirm');
  const greeting = editor.node('Greeting');

  await editor.waitForCanvasToSettle();
  const offerBefore = await editor.centre(offer);
  const confirmBefore = await editor.centre(confirm);

  await editor.drag(offer, greeting, async () => {
    // Mid-drag: the subtree travels with the node, and Greeting lights up as a valid target.
    const offerNow = await editor.centre(offer);
    const confirmNow = await editor.centre(confirm);
    expect(confirmNow.x - confirmBefore.x).toBeCloseTo(offerNow.x - offerBefore.x, 0);
    expect(confirmNow.y - confirmBefore.y).toBeCloseTo(offerNow.y - offerBefore.y, 0);
    await expect(greeting).toHaveClass(/drop-valid/);
  });

  // After the drop: Offer Times hangs off Greeting, next to Collect Details, with Confirm still under it.
  const g = (await greeting.boundingBox())!;
  const o = (await offer.boundingBox())!;
  const c = (await confirm.boundingBox())!;
  const cd = (await editor.node('Collect Details').boundingBox())!;
  expect(o.y).toBeCloseTo(cd.y, 0); // same row as its new sibling
  expect(o.y).toBeGreaterThan(g.y);
  expect(c.y).toBeGreaterThan(o.y);
  await expect(greeting).not.toHaveClass(/drop-/);

  // Collect Details now has no edges: a warning, not an error, so it still exports.
  await expect(page.getByRole('button', { name: '0 errors, 1 warning' })).toBeVisible();
  const { json } = await editor.exportJson();
  expect(edgesOf(json as Exported, 'Greeting')).toEqual(['choose_intent→Collect Details', 'record_details→Offer Times']);
  expect(edgesOf(json as Exported, 'Collect Details')).toEqual([]);
  expect(edgesOf(json as Exported, 'Offer Times')).toEqual(['select_time→Confirm']);
});

test('dropping on empty canvas snaps back and changes nothing', async ({ page }) => {
  const editor = new Editor(page);
  const collect = editor.node('Collect Details');
  await editor.waitForCanvasToSettle();
  const before = await editor.centre(collect);

  // Drag to empty space at the left edge. Its subtree moves with it, so it can never land on it.
  const pane = (await page.locator('.react-flow__pane').boundingBox())!;
  await editor.drag(collect, { x: pane.x + 60, y: pane.y + pane.height / 2 }, async () => {
    // Collect Details plus everything under it: 3 nodes and 2 edge pills.
    await expect(page.locator('.react-flow__node.is-dragging')).toHaveCount(5);
  });

  const after = await editor.centre(collect);
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});

test('an invalid drop target is highlighted and the drop is ignored', async ({ page }) => {
  const editor = new Editor(page);
  const collect = editor.node('Collect Details');

  // choose_intent already points at Collect Details.
  await editor.drag(editor.pill('choose_intent'), collect, async () => {
    await expect(collect).toHaveClass(/drop-invalid/);
  });
  await expect(collect).not.toHaveClass(/drop-/);
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});

test('the start node cannot be dragged', async ({ page }) => {
  const editor = new Editor(page);
  const greeting = editor.node('Greeting');
  // Pressing on a fixed node and moving pans the canvas instead of dragging it.
  await editor.drag(greeting, editor.node('Confirm'), async () => {
    await expect(page.locator('.react-flow__node.is-dragging')).toHaveCount(0);
    await expect(editor.node('Confirm')).not.toHaveClass(/drop-/);
  });
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});

test('repointing an edge disconnects the old target until it is reconnected', async ({ page }) => {
  const editor = new Editor(page);
  const exportBtn = page.getByRole('button', { name: 'Export JSON' });
  const collect = editor.node('Collect Details');

  // choose_intent: Greeting → Offer Times, skipping Collect Details.
  await editor.drag(editor.pill('choose_intent'), editor.node('Offer Times'), async () => {
    await expect(editor.node('Offer Times')).toHaveClass(/drop-valid/);
  });

  await expect(collect).toHaveClass(/is-unreachable/);
  await expect(collect.getByText('disconnected')).toBeVisible();
  await expect(collect).toHaveClass(/has-error/);
  await expect(exportBtn).toBeDisabled();
  await expect(page.getByRole('button', { name: /^1 error/ })).toBeVisible();

  // The disconnected part sits to the right of the main graph.
  const greeting = (await editor.node('Greeting').boundingBox())!;
  expect((await collect.boundingBox())!.x).toBeGreaterThan(greeting.x + greeting.width);

  // Its panel says why.
  await collect.click();
  await expect(editor.panel.getByText(/Not connected to the start node/)).toBeVisible();
  await page.keyboard.press('Escape');

  // Drag the edge back: everything is connected again and the export matches the original.
  await editor.drag(editor.pill('choose_intent'), collect);
  await expect(collect).not.toHaveClass(/is-unreachable/);
  await expect(exportBtn).toBeEnabled();
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});

test('dragging a disconnected node under another node reconnects it with a new edge', async ({ page }) => {
  const editor = new Editor(page);
  const collect = editor.node('Collect Details');

  await editor.drag(editor.pill('choose_intent'), editor.node('Offer Times'));
  await expect(collect).toHaveClass(/is-unreachable/);

  // Collect Details has no incoming edge left, so dropping it on Greeting creates one.
  await editor.drag(collect, editor.node('Greeting'));
  await expect(collect).not.toHaveClass(/is-unreachable/);
  await editor.expectPanel('Edge'); // the new edge is selected for naming
  await expect(editor.panel.getByLabel(/^Function name/)).toHaveValue('edge_1');
  await editor.panel.getByLabel(/^Function name/).fill('ask_details');
  await editor.panel.getByLabel(/^Description/).fill('The caller wants to give their details first.');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: '✓ Valid' })).toBeVisible();
  const { json } = await editor.exportJson();
  expect(edgesOf(json as Exported, 'Greeting')).toEqual(['choose_intent→Offer Times', 'ask_details→Collect Details']);
  // Offer Times is now reached two ways; the record_details link from Collect Details is kept.
  expect(edgesOf(json as Exported, 'Collect Details')).toEqual(['record_details→Offer Times']);
});
