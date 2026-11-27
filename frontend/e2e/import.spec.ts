import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Editor, type AgentJson } from './editor';

const NEW_AGENT = fileURLToPath(new URL('./fixtures/new_agent.json', import.meta.url));
const EXAMPLE_FLOW = fileURLToPath(new URL('../../backend/example_flow.json', import.meta.url));
const read = (path: string): AgentJson => JSON.parse(readFileSync(path, 'utf8'));

async function expectWholeGraphInView(page: Page, editor: Editor) {
  await editor.waitForCanvasToSettle();
  const canvas = (await page.locator('.react-flow').boundingBox())!;
  for (const el of await page.locator('.react-flow__node').all()) {
    const box = (await el.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(canvas.x);
    expect(box.y).toBeGreaterThanOrEqual(canvas.y);
    expect(box.x + box.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(box.y + box.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
}

test.describe('Import JSON', () => {
  test('imports new_agent.json, renders it, and exports it unchanged', async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    const agent = read(NEW_AGENT);

    await editor.importFile(NEW_AGENT);

    await expect(page.getByRole('status')).toHaveText(/Imported "New agent": 4 nodes, 3 edges\./);
    for (const node of agent.nodes) {
      await expect(editor.node(node.name)).toBeVisible();
      for (const edge of node.edges ?? []) await expect(editor.pill(edge.function)).toBeVisible();
    }
    await expect(page.locator('.agent-node')).toHaveCount(4);
    await expect(page.getByRole('button', { name: '✓ Valid' })).toBeVisible();
    await expectWholeGraphInView(page, editor);

    const { json } = await editor.exportJson();
    expect(json).toEqual(agent);
  });

  test("imports the backend's example_flow.json and exports it unchanged", async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    await editor.importFile(EXAMPLE_FLOW);
    await expect(page.locator('.top-bar__title')).toHaveText('Prosper Scheduler');
    const { filename, json } = await editor.exportJson();
    expect(filename).toBe('prosper_scheduler.json');
    expect(json).toEqual(read(EXAMPLE_FLOW));
  });

  test('an imported agent can be edited like one built by hand', async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    await editor.importFile(NEW_AGENT);

    await editor.addEdgeUnder(editor.node('Confirm'));
    await editor.addNodeUnder(editor.selectedPill());
    await expect(page.locator('.agent-node')).toHaveCount(5);
    await editor.expectPanel('Node');
  });

  test('asks before replacing work in progress', async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    await editor.addEdgeUnder(editor.node('Greeting')); // now there's something to lose

    page.once('dialog', (d) => d.dismiss());
    await editor.importFile(NEW_AGENT);
    await expect(editor.pill('edge_1')).toBeVisible();
    await expect(page.locator('.agent-node')).toHaveCount(1);

    page.once('dialog', (d) => {
      expect(d.message()).toBe('Replace "New agent" with the agent from new_agent.json?');
      return d.accept();
    });
    await editor.importFile(NEW_AGENT);
    await expect(page.locator('.agent-node')).toHaveCount(4);
    await expect(editor.pill('edge_1')).toHaveCount(0);
  });

  test('rejects an agent with a loop and explains why', async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    const looped = read(NEW_AGENT);
    const confirm = looped.nodes.find((n) => n.name === 'Confirm')!;
    delete confirm.end;
    confirm.edges = [{ function: 'start_over', description: 'Again.', target: 'Greeting', properties: {}, required: [] }];

    await editor.importFile({ name: 'looped.json', json: looped });

    const alert = page.getByRole('alert');
    await expect(alert).toContainText("Couldn't import looped.json");
    await expect(alert).toContainText('Loops back to the start aren\'t supported yet.');
    await expect(page.locator('.agent-node')).toHaveCount(1); // untouched
    await alert.getByRole('button', { name: 'Dismiss' }).click();
    await expect(alert).toHaveCount(0);
  });

  test('the imported agent survives a reload', async ({ page }) => {
    const editor = new Editor(page);
    await editor.open();
    await editor.importFile(NEW_AGENT);
    await expect(page.locator('.agent-node')).toHaveCount(4);
    await page.reload();
    await expect(page.locator('.agent-node')).toHaveCount(4);
    const { json } = await editor.exportJson();
    expect(json).toEqual(read(NEW_AGENT));
  });
});
