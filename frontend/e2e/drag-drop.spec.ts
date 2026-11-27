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

  // Collect Details now has no edges, so it must end the call before the agent exports.
  const collect = editor.node('Collect Details');
  await expect(page.getByRole('button', { name: '1 error, 0 warnings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
  await collect.click();
  await expect(editor.panel.getByText(/Every branch must end the call/)).toBeVisible();
  await editor.panel.getByRole('checkbox', { name: /Ends the call/ }).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: '✓ Valid' })).toBeVisible();
  const { json } = await editor.exportJson();
  expect(edgesOf(json as Exported, 'Greeting')).toEqual(['choose_intent→Collect Details', 'record_details→Offer Times']);
  expect(edgesOf(json as Exported, 'Collect Details')).toEqual([]);
  expect(edgesOf(json as Exported, 'Offer Times')).toEqual(['select_time→Confirm']);
});

test('connector lines stay drawn and attached to the moving elements throughout a drag', async ({ page }) => {
  const editor = new Editor(page);
  const lines = page.locator('.react-flow__edge-path');
  await editor.waitForCanvasToSettle();
  const total = await lines.count();
  expect(total).toBe(6);

  const offer = editor.node('Offer Times');
  const card = offer.locator('xpath=ancestor-or-self::*[contains(@class,"agent-node")][1]');

  // Watch every animation frame for the whole drag: the bug was lines vanishing for
  // frames at a time, which a check after each step can miss.
  await page.evaluate(() => {
    const w = window as unknown as { __minLines: number; __watching: boolean };
    w.__minLines = Infinity;
    w.__watching = true;
    const tick = () => {
      w.__minLines = Math.min(w.__minLines, document.querySelectorAll('.react-flow__edge-path').length);
      if (w.__watching) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const from = (await card.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 3);
  await page.mouse.down();
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + from.width / 2 + i * 20, from.y + from.height / 3 - i * 8);
    await page.evaluate(() => new Promise(requestAnimationFrame)); // let React Flow render the frame
    expect(await lines.count(), `lines drawn at drag step ${i}`).toBe(total);

    // Ends of the lines touch the dragged card: one arrives at its top edge, one leaves its bottom edge.
    const box = (await card.boundingBox())!;
    const ends = await page.locator('.react-flow__edge-path').evaluateAll((paths) =>
      paths.map((p) => {
        const path = p as SVGPathElement;
        const ctm = path.getScreenCTM()!;
        const at = (len: number) => new DOMPoint(path.getPointAtLength(len).x, path.getPointAtLength(len).y).matrixTransform(ctm);
        const a = at(0);
        const b = at(path.getTotalLength());
        return { start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } };
      }),
    );
    const centreX = box.x + box.width / 2;
    const near = (p: { x: number; y: number }, x: number, y: number) => Math.abs(p.x - x) < 6 && Math.abs(p.y - y) < 12;
    expect(ends.some((l) => near(l.end, centreX, box.y)), `a line arrives at the card's top at step ${i}`).toBe(true);
    expect(ends.some((l) => near(l.start, centreX, box.y + box.height)), `a line leaves the card's bottom at step ${i}`).toBe(true);
  }
  await page.mouse.up();
  await editor.waitForCanvasToSettle();
  const fewest = await page.evaluate(() => {
    const w = window as unknown as { __minLines: number; __watching: boolean };
    w.__watching = false;
    return w.__minLines;
  });
  expect(fewest, 'fewest lines on screen in any frame of the drag').toBe(total);
  expect(await lines.count()).toBe(total);
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

test('edges cannot be dragged: they stay with the node they come out of', async ({ page }) => {
  const editor = new Editor(page);
  const pill = editor.pill('choose_intent');
  const greeting = editor.node('Greeting');
  // Pressing on an edge and moving pans the canvas, so compare against its source node.
  const offset = async () => {
    const [p, g] = [await editor.centre(pill), await editor.centre(greeting)];
    return { x: p.x - g.x, y: p.y - g.y };
  };
  await editor.waitForCanvasToSettle();
  const before = await offset();

  await editor.drag(pill, editor.node('Offer Times'), async () => {
    await expect(page.locator('.react-flow__node.is-dragging')).toHaveCount(0);
    await expect(editor.node('Offer Times')).not.toHaveClass(/drop-/);
  });

  const after = await offset();
  expect(after.x).toBeCloseTo(before.x, 0);
  expect(after.y).toBeCloseTo(before.y, 0);
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
