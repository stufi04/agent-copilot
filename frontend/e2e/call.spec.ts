import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { Editor } from './editor';

// The real call needs the voice backend and API keys, so it isn't run here (the test
// build points at a dead backend URL). This checks the wiring up to the network.

test('Speak to agent sits under the title; when the backend is down, the panel below it says so', async ({ page, context }) => {
  await context.grantPermissions(['microphone']);
  const editor = new Editor(page);
  await editor.open();
  const speak = page.getByRole('button', { name: 'Speak to agent' });
  await expect(speak).toBeDisabled(); // a fresh agent isn't valid yet

  await editor.importFile(fileURLToPath(new URL('./fixtures/new_agent.json', import.meta.url)));
  await page.getByRole('status').getByRole('button', { name: 'Dismiss' }).click();
  await expect(speak).toBeEnabled();

  // Top-left of the canvas, just under the top bar.
  const bar = (await page.locator('.top-bar').boundingBox())!;
  const btn = (await speak.boundingBox())!;
  expect(btn.x).toBeLessThan(40);
  expect(btn.y).toBeGreaterThan(bar.y + bar.height);
  expect(btn.y).toBeLessThan(bar.y + bar.height + 40);

  await speak.click();
  const panel = page.getByRole('region', { name: 'Call' });
  await expect(panel.getByRole('alert')).toContainText("Couldn't reach the voice backend", { timeout: 20_000 });
  expect((await panel.boundingBox())!.y).toBeGreaterThan(btn.y + btn.height); // the conversation shows under the button

  await panel.getByRole('button', { name: 'Close call panel' }).click();
  await expect(panel).toHaveCount(0);
});
