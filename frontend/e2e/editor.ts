import { expect, type Locator, type Page } from '@playwright/test';

// A small page object for the agent editor: every action goes through the real UI
// (hovering to reveal [+], clicking, typing into the side panel), like a user would.

/** The backend agent JSON format (backend/agent_builder/schema.py). */
export interface AgentJson {
  name: string;
  voice_id: string;
  model: string;
  persona: string;
  initial_node: string;
  nodes: NodeJson[];
}
interface NodeJson {
  name: string;
  role_message?: string;
  task_messages: { role: string; content: string }[];
  edges?: EdgeJson[];
  end?: boolean;
}
interface EdgeJson {
  function: string;
  description: string;
  target: string;
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required: string[];
}

export class Editor {
  readonly page: Page;
  readonly panel: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('.side-panel');
  }

  async open() {
    await this.page.goto('/');
    await expect(this.node('Greeting')).toBeVisible();
  }

  node(name: string): Locator {
    return this.page.locator('.agent-node').filter({
      has: this.page.locator('.agent-node__name').getByText(name, { exact: true }),
    });
  }

  pill(fn: string): Locator {
    return this.page.locator('.edge-pill').filter({
      has: this.page.locator('.edge-pill__label').getByText(fn, { exact: true }),
    });
  }

  selectedNode = () => this.page.locator('.agent-node.is-selected');
  selectedPill = () => this.page.locator('.edge-pill.is-selected');

  async expectPanel(title: 'Node' | 'Edge' | 'Agent settings') {
    await expect(this.panel.getByRole('heading', { level: 2 })).toHaveText(title);
  }

  /** Hover an element on the canvas and click the [+] that appears under it. */
  private async hoverPlus(element: Locator, buttonName: string) {
    // The wrapper fades in on hover (the button's own opacity never changes).
    const slot = element.locator('.plus-slot', { has: this.page.getByRole('button', { name: buttonName }) });
    const plus = slot.getByRole('button', { name: buttonName });
    // Park the mouse off the canvas (on the top bar) so we start un-hovered, and let
    // any zoom-to-fit animation finish so the element doesn't slide out from under it.
    await this.page.mouse.move(5, 5);
    await this.waitForCanvasToSettle();
    await expect(slot).toHaveCSS('opacity', '0'); // hidden until hovered
    await element.hover();
    await expect(slot).toHaveCSS('opacity', '1');
    await plus.click();
  }

  /** Wait until the canvas pan/zoom transform stops changing. */
  async waitForCanvasToSettle() {
    const viewport = this.page.locator('.react-flow__viewport');
    let last = '';
    await expect
      .poll(
        async () => {
          await this.page.waitForTimeout(100);
          const now = await viewport.evaluate((el) => getComputedStyle(el).transform);
          const settled = now === last;
          last = now;
          return settled;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  }

  async addEdgeUnder(node: Locator) {
    await this.hoverPlus(node, 'Add an edge');
    await this.expectPanel('Edge');
  }

  async addNodeUnder(pill: Locator) {
    await this.hoverPlus(pill, 'Add the target node');
    await this.expectPanel('Node');
  }

  async fillAgentSettings(agent: AgentJson) {
    await this.page.getByRole('button', { name: 'Agent settings' }).click();
    await this.expectPanel('Agent settings');
    await this.panel.getByLabel(/^Agent name/).fill(agent.name);
    await this.panel.getByLabel(/^Persona/).fill(agent.persona);
    await this.panel.getByLabel(/^ElevenLabs voice ID/).fill(agent.voice_id);
    await this.panel.getByLabel(/^OpenAI model/).fill(agent.model);
  }

  /** Fill the open Node panel. */
  async fillNode(node: NodeJson) {
    await this.expectPanel('Node');
    await this.panel.getByLabel(/^Name/).fill(node.name);
    await this.panel.getByLabel(/^Task message/).fill(node.task_messages.map((m) => m.content).join('\n'));
    await this.panel.getByLabel(/^Role message override/).fill(node.role_message ?? '');
    await this.panel.getByRole('checkbox', { name: /Ends the call/ }).setChecked(Boolean(node.end));
  }

  /** Fill the open Edge panel, including its fields. */
  async fillEdge(edge: EdgeJson) {
    await this.expectPanel('Edge');
    await this.panel.getByLabel(/^Function name/).fill(edge.function);
    await this.panel.getByLabel(/^Description/).fill(edge.description);

    for (const [key, prop] of Object.entries(edge.properties)) {
      await this.panel.getByRole('button', { name: '+ Add field' }).click();
      const row = this.panel.locator('.prop').last();
      await row.getByPlaceholder('name', { exact: true }).fill(key);
      await row.getByRole('combobox').selectOption(prop.type);
      await row.getByPlaceholder('description', { exact: true }).fill(prop.description ?? '');
      if (prop.enum) await row.getByPlaceholder(/allowed values/).fill(prop.enum.join(', '));
      await row.getByRole('checkbox', { name: 'Required' }).setChecked(edge.required.includes(key));
    }
  }

  /**
   * Recreate an agent through the UI: settings, then a walk from the initial node,
   * adding each edge with the node's [+] and each target with the edge's [+].
   * The editor builds trees, so every node must be the target of exactly one edge.
   */
  async buildAgent(agent: AgentJson) {
    const byName = new Map(agent.nodes.map((n) => [n.name, n]));
    await this.fillAgentSettings(agent);

    await this.node('Greeting').click();
    await this.fillNode(byName.get(agent.initial_node)!);

    const queue = [agent.initial_node];
    while (queue.length) {
      const source = byName.get(queue.shift()!)!;
      for (const edge of source.edges ?? []) {
        await this.addEdgeUnder(this.node(source.name));
        await this.fillEdge(edge);
        await this.addNodeUnder(this.selectedPill());
        await this.fillNode(byName.get(edge.target)!);
        queue.push(edge.target);
      }
    }
    await this.page.keyboard.press('Escape');
    await expect(this.panel).not.toHaveClass(/is-open/);
  }

  /**
   * Drag one canvas element onto another with a real mouse: press on the source,
   * move in small steps to the target's centre, release. `during` runs while the
   * button is still held, to check what the drag looks like mid-flight.
   */
  async drag(source: Locator, target: Locator | { x: number; y: number }, during?: () => Promise<void>) {
    await this.page.mouse.move(5, 5);
    await this.waitForCanvasToSettle();
    const from = (await source.boundingBox())!;
    const to = 'boundingBox' in target ? await this.centre(target) : target;
    await this.page.mouse.move(from.x + from.width / 2, from.y + from.height / 3);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 20 });
    if (during) await during();
    await this.page.mouse.up();
    await this.waitForCanvasToSettle();
  }

  /**
   * Press the [+] under `element` and drag it onto `target` instead of clicking:
   * links to an existing node. `during` runs while the button is still held.
   */
  async plusDrag(element: Locator, target: Locator, during?: () => Promise<void>) {
    await this.page.mouse.move(5, 5);
    await this.waitForCanvasToSettle();
    await element.hover();
    const plus = element.locator('.plus-slot button');
    await expect(plus).toBeVisible();
    const from = await this.centre(plus);
    const to = await this.centre(target);
    await this.page.mouse.move(from.x, from.y);
    await this.page.mouse.down();
    await this.page.mouse.move(to.x, to.y, { steps: 20 });
    if (during) await during();
    await this.page.mouse.up();
    await this.waitForCanvasToSettle();
  }

  /** Centre of an element on screen. */
  async centre(el: Locator) {
    const b = (await el.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }

  /** Import an agent file through the Import JSON button's file picker. */
  async importFile(file: string | { name: string; json: unknown }) {
    const chooser = this.page.waitForEvent('filechooser');
    await this.page.getByRole('button', { name: 'Import JSON' }).click();
    const picker = await chooser;
    await picker.setFiles(
      typeof file === 'string'
        ? file
        : { name: file.name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file.json)) },
    );
  }

  /** Click Export JSON and return the parsed downloaded file. */
  async exportJson(): Promise<{ filename: string; json: unknown }> {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.page.getByRole('button', { name: 'Export JSON' }).click(),
    ]);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return { filename: download.suggestedFilename(), json: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  }
}
