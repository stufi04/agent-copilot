import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { Editor } from './editor';

// The copilot chat in a real browser. The backend's reply is faked at the network level
// (page.route), so this never reaches OpenAI; the test build's backend URL is dead anyway.

test('chats with the copilot in a panel along the bottom', async ({ page }) => {
  const requests: unknown[] = [];
  await page.route('**/api/copilot/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        [
          { type: 'delta', text: 'Start with a greeting node' },
          { type: 'delta', text: ' that branches on intent.' },
          { type: 'done' },
        ]
          .map((e) => JSON.stringify(e))
          .join('\n') + '\n',
    });
  });

  const editor = new Editor(page);
  await editor.open();
  const panel = page.getByRole('region', { name: 'Copilot' });

  // Full width along the bottom of the window, under the canvas.
  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  const canvas = (await page.locator('.canvas').boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(viewport.width);
  expect(Math.round(box.y + box.height)).toBe(viewport.height);
  expect(Math.round(canvas.y + canvas.height)).toBeLessThanOrEqual(Math.round(box.y) + 1);

  const input = panel.getByRole('textbox', { name: 'Message the copilot' });
  await input.fill('How should I structure a booking agent?');
  await input.press('Enter');

  await expect(panel).toContainText('Start with a greeting node that branches on intent.');
  expect(requests).toEqual([
    {
      messages: [{ role: 'user', content: 'How should I structure a booking agent?' }],
      agent: expect.objectContaining({ name: 'New agent', initial_node: 'Greeting' }), // the agent on screen
    },
  ]);

  // The conversation survives a reload.
  await page.reload();
  await expect(panel).toContainText('Start with a greeting node that branches on intent.');
});

test('the panel resizes by dragging its top edge, and collapses to a bar', async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  const panel = page.getByRole('region', { name: 'Copilot' });
  const before = (await panel.boundingBox())!.height;

  const handle = (await page.getByRole('separator', { name: 'Resize copilot' }).boundingBox())!;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(handle.x + 200, y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 200, y - 100, { steps: 5 });
  await page.mouse.up();
  expect(Math.round((await panel.boundingBox())!.height)).toBe(Math.round(before + 100));

  await panel.getByRole('button', { name: 'Copilot' }).click();
  expect((await panel.boundingBox())!.height).toBeLessThan(40);
});

test("says so when the backend isn't running", async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  const panel = page.getByRole('region', { name: 'Copilot' });
  const input = panel.getByRole('textbox', { name: 'Message the copilot' });
  await input.fill('Hello?');
  await input.press('Enter');
  await expect(panel.getByRole('alert')).toContainText("Couldn't reach the backend");
});

test('the copilot edits the graph live, and one ⌘Z takes back its whole reply', async ({ page }) => {
  // Two steps from the model: tool calls adding a branch, then a short reply.
  const steps = [
    [
      { type: 'tool_calls', calls: [
        { id: 'a', name: 'add_node', arguments: JSON.stringify({ name: 'opening_hours', task_message: 'Give the opening hours and say goodbye.', end: true }) },
        { id: 'b', name: 'add_edge', arguments: JSON.stringify({ from: 'greeting', function: 'ask_opening_hours', description: 'The caller asks when the clinic is open.', to: 'opening_hours' }) },
      ] },
      { type: 'done' },
    ],
    [{ type: 'delta', text: 'Added an opening-hours branch to greeting.' }, { type: 'done' }],
  ];
  const requests: { messages: { role: string }[]; agent: { nodes: { name: string }[] } }[] = [];
  await page.route('**/api/copilot/chat', async (route) => {
    requests.push(route.request().postDataJSON());
    const events = steps[requests.length - 1];
    await route.fulfill({ contentType: 'application/x-ndjson', body: events.map((e) => JSON.stringify(e)).join('\n') + '\n' });
  });

  const editor = new Editor(page);
  await editor.open();
  await editor.importFile(fileURLToPath(new URL('../../backend/branching_flow.json', import.meta.url)));
  await page.getByRole('status').getByRole('button', { name: 'Dismiss' }).click();
  const before = (await editor.exportJson()).json;

  const panel = page.getByRole('region', { name: 'Copilot' });
  const input = panel.getByRole('textbox', { name: 'Message the copilot' });
  await input.fill('Add a branch for callers asking about opening hours');
  await input.press('Enter');

  await expect(panel).toContainText('Added an opening-hours branch to greeting.');
  await expect(panel).toContainText('✓ Added node "opening_hours".');
  await expect(panel).toContainText('✓ Added edge "ask_opening_hours" from "greeting" to "opening_hours".');
  await expect(editor.node('opening_hours')).toBeVisible();
  await expect(editor.pill('ask_opening_hours')).toBeVisible();
  await expect(page.getByRole('button', { name: /Valid/ })).toBeVisible(); // still a valid agent

  // The second request carried the tool results and the updated graph.
  expect(requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
  expect(requests[1].agent.nodes.map((n) => n.name)).toContain('opening_hours');

  // One ⌘Z (focus outside the chat box) removes the whole branch...
  await editor.node('greeting').click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(editor.node('opening_hours')).toHaveCount(0);
  await expect(editor.pill('ask_opening_hours')).toHaveCount(0);
  expect((await editor.exportJson()).json).toEqual(before);

  // ...and redo brings it back; the chat's button undoes it again.
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(editor.node('opening_hours')).toBeVisible();
  await panel.getByRole('button', { name: 'Undo these changes' }).click();
  await expect(editor.node('opening_hours')).toHaveCount(0);
});
