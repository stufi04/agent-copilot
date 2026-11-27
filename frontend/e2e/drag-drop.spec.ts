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

test('dragging an edge onto a node moves it there with its whole subtree', async ({ page }) => {
  const editor = new Editor(page);
  const pill = editor.pill('record_details');
  const offer = editor.node('Offer Times');
  const confirm = editor.node('Confirm');
  const greeting = editor.node('Greeting');

  await editor.waitForCanvasToSettle();
  const pillBefore = await editor.centre(pill);
  const confirmBefore = await editor.centre(confirm);

  await editor.drag(pill, greeting, async () => {
    // Mid-drag: what hangs below the edge travels with it, and Greeting lights up as a valid target.
    const pillNow = await editor.centre(pill);
    const confirmNow = await editor.centre(confirm);
    expect(confirmNow.x - confirmBefore.x).toBeCloseTo(pillNow.x - pillBefore.x, 0);
    expect(confirmNow.y - confirmBefore.y).toBeCloseTo(pillNow.y - pillBefore.y, 0);
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

test('dragging a node onto an empty edge attaches it there and leaves its old edge empty', async ({ page }) => {
  const editor = new Editor(page);
  await editor.addEdgeUnder(editor.node('Greeting')); // edge_1, no target yet
  await page.keyboard.press('Escape');
  const empty = editor.pill('edge_1');
  const offer = editor.node('Offer Times');

  await editor.drag(offer, empty, async () => {
    await expect(empty).toHaveClass(/drop-valid/);
  });

  // Offer Times (with Confirm) now hangs from edge_1 under Greeting; record_details is empty.
  expect((await offer.boundingBox())!.y).toBeCloseTo((await editor.node('Collect Details').boundingBox())!.y, 0);
  await expect(editor.pill('record_details')).toHaveClass(/is-dangling/);
  await expect(editor.pill('edge_1')).not.toHaveClass(/is-dangling/);
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled();
});

test('dragging a node onto another node joins them with a new edge; the old edge stays behind', async ({ page }) => {
  const editor = new Editor(page);
  const confirm = editor.node('Confirm');
  const collect = editor.node('Collect Details');

  await editor.drag(confirm, collect, async () => {
    await expect(collect).toHaveClass(/drop-valid/);
  });

  // Confirm now hangs under Collect Details, next to Offer Times, through a new edge.
  await editor.expectPanel('Edge');
  await expect(editor.panel.getByLabel(/^Function name/)).toHaveValue('edge_1');
  await editor.panel.getByLabel(/^Function name/).fill('skip_times');
  await editor.panel.getByLabel(/^Description/).fill('The caller already has a time in mind.');
  await page.keyboard.press('Escape');
  expect((await confirm.boundingBox())!.y).toBeCloseTo((await editor.node('Offer Times').boundingBox())!.y, 0);

  // select_time stayed under Offer Times, now empty.
  await expect(editor.pill('select_time')).toHaveClass(/is-dangling/);
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeDisabled(); // until it's used or deleted
});

test('a node cannot be dropped on an edge that already leads to a node', async ({ page }) => {
  const editor = new Editor(page);
  const taken = editor.pill('choose_intent');
  await editor.drag(editor.node('Confirm'), taken, async () => {
    await expect(taken).toHaveClass(/drop-invalid/);
  });
  await expect(taken).not.toHaveClass(/drop-/);
  const { json } = await editor.exportJson();
  expect(json).toEqual(newAgent);
});

test('while dragging, only the broken line is hidden; the rest stay drawn and attached', async ({ page }) => {
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
  // Get the drag going first: React Flow only starts it past its drag threshold.
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 3);
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 3);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const steps = 15;
  // The line into Offer Times is broken by the drag; every other line stays.
  const during = total - 1;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + from.width / 2 + i * 20, from.y + from.height / 3 - i * 8);
    await page.evaluate(() => new Promise(requestAnimationFrame)); // let React Flow render the frame
    expect(await lines.count(), `lines drawn at drag step ${i}`).toBe(during);

    // The line out of the dragged card moves with it; none arrives at its top any more.
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
    expect(ends.some((l) => near(l.end, centreX, box.y)), `no line arrives at the card's top at step ${i}`).toBe(false);
    expect(ends.some((l) => near(l.start, centreX, box.y + box.height)), `a line leaves the card's bottom at step ${i}`).toBe(true);
  }
  await page.mouse.up();
  await editor.waitForCanvasToSettle();
  const fewest = await page.evaluate(() => {
    const w = window as unknown as { __minLines: number; __watching: boolean };
    w.__watching = false;
    return w.__minLines;
  });
  expect(fewest, 'fewest lines on screen in any frame of the drag').toBe(during);
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

test('dragging from a node\'s [+] to an existing node adds an edge there, drawn dashed when it loops back', async ({ page }) => {
  const editor = new Editor(page);
  const greeting = editor.node('Greeting');

  await editor.plusDrag(editor.node('Confirm'), greeting, async () => {
    await expect(page.locator('.link-preview')).toHaveCount(1); // (a vertical line has no width, so not 'visible')
    await expect(greeting).toHaveClass(/drop-valid/);
  });
  await expect(page.locator('.link-preview')).toHaveCount(0);
  await expect(page.locator('.agent-node')).toHaveCount(4); // no new node

  // The new edge is selected for naming, and loops back up: dashed.
  await editor.expectPanel('Edge');
  await editor.panel.getByLabel(/^Function name/).fill('start_over');
  await editor.panel.getByLabel(/^Description/).fill('The caller wants to book another appointment.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.react-flow__edge.link-edge')).toHaveCount(1);

  const { json } = await editor.exportJson();
  expect(edgesOf(json as Exported, 'Confirm')).toEqual(['start_over→Greeting']);
});

test('dragging from an empty edge\'s [+] to an existing node points the edge there', async ({ page }) => {
  const editor = new Editor(page);
  await editor.addEdgeUnder(editor.node('Collect Details')); // edge_1, no target yet
  await page.keyboard.press('Escape');

  await editor.plusDrag(editor.pill('edge_1'), editor.node('Confirm'));
  await expect(editor.pill('edge_1')).not.toHaveClass(/is-dangling/);
  await expect(page.locator('.agent-node')).toHaveCount(4);

  // Confirm is now reached two ways. It's laid out under the shorter path (edge_1),
  // so select_time from Offer Times, on the same level, becomes the dashed link.
  await expect(page.locator('.react-flow__edge.link-edge')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge-path')).toHaveCount(8);
});

test('clicking a [+] still adds a new element', async ({ page }) => {
  const editor = new Editor(page);
  await editor.addEdgeUnder(editor.node('Confirm'));
  await editor.addNodeUnder(editor.selectedPill());
  await expect(page.locator('.agent-node')).toHaveCount(5);
});
