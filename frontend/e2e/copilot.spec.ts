import { expect, test } from '@playwright/test';
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
  expect(requests).toEqual([{ messages: [{ role: 'user', content: 'How should I structure a booking agent?' }] }]);

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
