import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Editor, type AgentJson } from './editor';

// The clinic scheduler, as exported from the editor by hand (same graph as
// backend/example_flow.json, with Title Case node names).
const newAgent: AgentJson = JSON.parse(
  readFileSync(new URL('./fixtures/new_agent.json', import.meta.url), 'utf8'),
);

test('builds new_agent.json by clicking through the UI and exports identical JSON', async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();

  // A fresh agent can't be exported yet.
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled();

  await editor.buildAgent(newAgent);

  // Every node and edge is on the canvas, labelled.
  for (const node of newAgent.nodes) {
    await expect(editor.node(node.name)).toBeVisible();
    for (const edge of node.edges ?? []) await expect(editor.pill(edge.function)).toBeVisible();
  }
  await expect(page.locator('.agent-node')).toHaveCount(newAgent.nodes.length);
  await expect(page.locator('.has-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '✓ Valid' })).toBeVisible();

  const { filename, json } = await editor.exportJson();
  expect(filename).toBe('new_agent.json');
  expect(json).toEqual(newAgent);
});

test('the view zooms out so the whole graph stays on screen as it grows', async ({ page }) => {
  // A laptop-sized window: the ~620px-tall graph no longer fits at 100%.
  await page.setViewportSize({ width: 1280, height: 600 });
  const editor = new Editor(page);
  await editor.open();
  await editor.buildAgent(newAgent);

  // Once the fit animation settles, every element must be inside the canvas.
  await editor.waitForCanvasToSettle();
  const canvas = (await page.locator('.react-flow').boundingBox())!;
  for (const el of await page.locator('.react-flow__node').all()) {
    const box = (await el.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }

  // So it must have zoomed out to fit.
  const scale = await page
    .locator('.react-flow__viewport')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
  expect(scale).toBeLessThan(1);

  // Manual zoom still works.
  await page.getByRole('button', { name: /zoom in/i }).click();
  await expect
    .poll(() =>
      page.locator('.react-flow__viewport').evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a),
    )
    .toBeGreaterThan(scale);
});

test('sibling edges fan out evenly under their node', async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  const greeting = editor.node('Greeting');
  for (let i = 0; i < 3; i++) await editor.addEdgeUnder(greeting);

  await editor.waitForCanvasToSettle();
  const boxes = await Promise.all(['edge_1', 'edge_2', 'edge_3'].map(async (fn) => (await editor.pill(fn).boundingBox())!));
  const centres = boxes.map((b) => b.x + b.width / 2);
  expect(centres[0]).toBeLessThan(centres[1]);
  expect(centres[1] - centres[0]).toBeCloseTo(centres[2] - centres[1], 0);
  expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);

  const parent = (await greeting.boundingBox())!;
  expect(parent.x + parent.width / 2).toBeCloseTo(centres[1], 0);
});

test('the graph survives a page reload', async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  await editor.buildAgent(newAgent);

  await page.reload();
  for (const node of newAgent.nodes) await expect(editor.node(node.name)).toBeVisible();
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});
