import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Editor, type AgentJson } from './editor';

// Undo / redo with real input, starting from the clinic scheduler (imported from new_agent.json):
//
//   Greeting ─choose_intent→ Collect Details ─record_details→ Offer Times ─select_time→ Confirm

const NEW_AGENT = fileURLToPath(new URL('./fixtures/new_agent.json', import.meta.url));
const newAgent: AgentJson = JSON.parse(readFileSync(NEW_AGENT, 'utf8'));
const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

test.beforeEach(async ({ page }) => {
  const editor = new Editor(page);
  await editor.open();
  await editor.importFile(NEW_AGENT);
  await expect(page.locator('.agent-node')).toHaveCount(4);
  await page.getByRole('status').getByRole('button', { name: 'Dismiss' }).click();
});

test('a drag-and-drop move is undone with ⌘Z and redone with ⇧⌘Z', async ({ page }) => {
  const editor = new Editor(page);
  const offer = editor.node('Offer Times');
  const greeting = editor.node('Greeting');
  await editor.waitForCanvasToSettle();
  const rowsBefore = { offer: (await offer.boundingBox())!.y, greeting: (await greeting.boundingBox())!.y };

  await editor.drag(editor.pill('record_details'), greeting);
  const collect = (await editor.node('Collect Details').boundingBox())!;
  expect((await offer.boundingBox())!.y).toBeCloseTo(collect.y, 0); // now a sibling of Collect Details

  await page.keyboard.press(UNDO);
  await editor.waitForCanvasToSettle();
  expect((await offer.boundingBox())!.y).toBeGreaterThan((await editor.node('Collect Details').boundingBox())!.y);
  expect(rowsBefore.offer).toBeGreaterThan(rowsBefore.greeting);
  expect((await editor.exportJson()).json).toEqual(newAgent);

  await page.keyboard.press(REDO);
  await editor.waitForCanvasToSettle();
  expect((await offer.boundingBox())!.y).toBeCloseTo((await editor.node('Collect Details').boundingBox())!.y, 0);
});

test('a move is undone with the Undo button', async ({ page }) => {
  const editor = new Editor(page);
  const confirm = editor.node('Confirm');
  const offer = editor.node('Offer Times');

  // select_time (with Confirm, under Offer Times) moves up beside it, under Collect Details.
  await editor.drag(editor.pill('select_time'), editor.node('Collect Details'));
  expect((await confirm.boundingBox())!.y).toBeCloseTo((await offer.boundingBox())!.y, 0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await editor.waitForCanvasToSettle();
  expect((await confirm.boundingBox())!.y).toBeGreaterThan((await offer.boundingBox())!.y);
  expect((await editor.exportJson()).json).toEqual(newAgent);
});

test('typing in the panel is undone in one step, even with the cursor still in the field', async ({ page }) => {
  const editor = new Editor(page);
  await editor.node('Confirm').click();
  const name = editor.panel.getByLabel(/^Name/);
  await name.fill('');
  await name.pressSequentially('Wrap up');
  await expect(editor.node('Wrap up')).toBeVisible();

  await name.press(UNDO);
  await expect(name).toHaveValue('Confirm');
  await expect(editor.node('Confirm')).toBeVisible();
  expect((await editor.exportJson()).json).toEqual(newAgent);
});

test('several kinds of change unwind one by one, back to the imported agent', async ({ page }) => {
  const editor = new Editor(page);
  const undo = page.getByRole('button', { name: 'Undo' });

  await editor.addEdgeUnder(editor.node('Confirm')); // 1: add an edge
  await editor.addNodeUnder(editor.selectedPill()); // 2: add its node
  await editor.panel.getByRole('checkbox', { name: /Ends the call/ }).check(); // 3: toggle
  await page.keyboard.press('Escape');
  await editor.drag(editor.pill('record_details'), editor.node('Greeting')); // 4: move a subtree
  await expect(page.locator('.agent-node')).toHaveCount(5);
  await expect(page.getByRole('button', { name: /error/ })).toBeVisible(); // the new node is unfinished

  for (let i = 0; i < 4; i++) await undo.click();
  await expect(page.locator('.agent-node')).toHaveCount(4);
  expect((await editor.exportJson()).json).toEqual(newAgent);

  // One more undoes the import itself, back to the blank starting agent.
  await undo.click();
  await expect(page.locator('.agent-node')).toHaveCount(1);
  await expect(editor.node('Greeting')).toBeVisible();
  await expect(undo).toBeDisabled();
});

test("⌘Z and ⇧⌘Z in the copilot's message box edit the message, not the graph", async ({ page }) => {
  const editor = new Editor(page);
  await editor.node('Confirm').click();
  const name = editor.panel.getByLabel(/^Name/);
  await name.fill('Wrap up'); // a graph change that ⌘Z would otherwise undo
  await page.keyboard.press('Escape');
  await expect(editor.node('Wrap up')).toBeVisible();

  const box = page.getByRole('textbox', { name: 'Message the copilot' });
  await box.click();
  await box.pressSequentially('hello');
  await box.press(UNDO);
  await expect(box).toHaveValue('hell'); // the browser's own undo (key by key, for keys typed one at a time)
  await box.press(REDO);
  await expect(box).toHaveValue('hello');
  await expect(editor.node('Wrap up')).toBeVisible(); // the graph is untouched

  await editor.node('Wrap up').click(); // outside the chat, ⌘Z is the graph's again
  await page.keyboard.press(UNDO);
  await expect(editor.node('Confirm')).toBeVisible();
});
