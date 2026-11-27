import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import newAgent from '../e2e/fixtures/new_agent.json';
import App from './App';
import { buildExampleFlow, draft } from './test/helpers';

// The [+] buttons are revealed by CSS :hover, which jsdom doesn't apply. They're
// always in the DOM though, so the tests click them directly.
//
// Elements on the canvas are clicked with fireEvent rather than user-event: React
// Flow's d3-zoom pane handles mousedown, and user-event's synthetic mousedown has no
// `view`, which d3 dereferences. Forms and the top bar use user-event as normal.
const canvasClick = (el: HTMLElement) => fireEvent.click(el);
const plus = (name: 'Add an edge' | 'Add the target node') =>
  canvasClick(screen.getByRole('button', { name }));

function setup() {
  const user = userEvent.setup();
  render(<App />);
  return { user, panel: () => screen.queryByRole('complementary') };
}

const graphNode = (name: string) => screen.getByText(name, { selector: '.agent-node__name' });
const graphPill = (label: string) => screen.getByText(label, { selector: '.edge-pill__label' });
const panelHeading = () => screen.queryByRole('heading', { level: 2 })?.textContent ?? null;

describe('App', () => {
  it('opens on a single Greeting node with no panel', () => {
    setup();
    expect(graphNode('Greeting')).toBeInTheDocument();
    expect(screen.getByText('start')).toBeInTheDocument();
    expect(document.querySelectorAll('.edge-pill')).toHaveLength(0);
    expect(panelHeading()).toBeNull();
  });

  it('clicking a node opens its form in the side panel; Esc and × close it', async () => {
    const { user } = setup();
    canvasClick(graphNode('Greeting'));
    expect(panelHeading()).toBe('Node');
    expect(screen.getByLabelText('Name')).toHaveValue('Greeting');

    await user.keyboard('{Escape}');
    expect(panelHeading()).toBeNull();

    canvasClick(graphNode('Greeting'));
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(panelHeading()).toBeNull();
  });

  it('editing the node name in the panel updates the graph', async () => {
    const { user } = setup();
    canvasClick(graphNode('Greeting'));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Welcome');
    expect(graphNode('Welcome')).toBeInTheDocument();
  });

  it('[+] under a node adds an edge and opens the edge panel', async () => {
    const { user } = setup();
    plus('Add an edge');

    expect(graphPill('edge_1')).toBeInTheDocument();
    expect(panelHeading()).toBe('Edge');
    expect(screen.getByText(/no target yet/)).toBeInTheDocument();

    const fn = screen.getByLabelText(/^Function name/);
    await user.clear(fn);
    await user.type(fn, 'choose_intent');
    expect(graphPill('choose_intent')).toBeInTheDocument();
  });

  it('[+] under a dangling edge adds its target node, then disappears', async () => {
    const { user } = setup();
    plus('Add an edge');
    plus('Add the target node');

    expect(graphNode('node_1')).toBeInTheDocument();
    expect(panelHeading()).toBe('Node');
    expect(screen.queryByRole('button', { name: 'Add the target node' })).toBeNull();

    // The edge panel now shows the route, with links to both ends.
    canvasClick(graphPill('edge_1'));
    const route = document.querySelector('.route') as HTMLElement;
    expect(within(route).getByRole('button', { name: 'Greeting' })).toBeInTheDocument();
    await user.click(within(route).getByRole('button', { name: 'node_1' }));
    expect(panelHeading()).toBe('Node');
    expect(screen.getByLabelText('Name')).toHaveValue('node_1');
  });

  it('adds and fills edge fields', async () => {
    const { user } = setup();
    plus('Add an edge');
    await user.click(screen.getByRole('button', { name: '+ Add field' }));
    await user.type(screen.getByPlaceholderText('name'), 'intent');
    await user.type(screen.getByPlaceholderText(/allowed values/), 'book, cancel');

    const [edge] = Object.values(draft().edges);
    expect(edge.properties[0]).toMatchObject({ key: 'intent', enumText: 'book, cancel', required: true });

    await user.selectOptions(screen.getByRole('combobox'), 'boolean');
    expect(screen.queryByPlaceholderText(/allowed values/)).toBeNull(); // enums are string-only

    await user.click(screen.getByRole('button', { name: 'Remove field' }));
    expect(Object.values(draft().edges)[0].properties).toEqual([]);
  });

  it('shows validation inline and outlines invalid elements', async () => {
    const { user } = setup();
    expect(graphNode('Greeting').closest('.agent-node')).toHaveClass('has-error');
    canvasClick(graphNode('Greeting'));
    expect(screen.getByText('Task message is required.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Task message/), 'Say hello.');
    expect(screen.queryByText('Task message is required.')).toBeNull();
    expect(graphNode('Greeting').closest('.agent-node')).not.toHaveClass('has-error');
  });

  it('the problems list jumps to the element with the issue', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: '1 error, 1 warning' }));
    await user.click(screen.getByRole('button', { name: /Task message is required/ }));
    expect(panelHeading()).toBe('Node');
    expect(screen.getByLabelText('Name')).toHaveValue('Greeting');
  });

  it('enables Export JSON only once the agent is valid, and downloads it', async () => {
    const { user } = setup();
    const exportBtn = screen.getByRole('button', { name: 'Export JSON' });
    expect(exportBtn).toBeDisabled();

    buildExampleFlow();
    expect(await screen.findByRole('button', { name: '✓ Valid' })).toBeInTheDocument();
    expect(exportBtn).toBeEnabled();

    const createObjectURL = vi.fn(() => 'blob:agent');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await user.click(exportBtn);
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('prosper_scheduler.json');
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(JSON.parse(await blob.text())).toMatchObject({ name: 'Prosper Scheduler', initial_node: 'greeting' });
  });

  it('Agent settings opens the agent form', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Agent settings' }));
    expect(panelHeading()).toBe('Agent settings');
    const name = screen.getByLabelText('Agent name');
    await user.clear(name);
    await user.type(name, 'Clinic bot');
    expect(screen.getByRole('button', { name: 'Clinic bot' })).toBeInTheDocument(); // top-bar title
  });

  it('deleting asks for confirmation and removes the subtree', async () => {
    const { user } = setup();
    plus('Add an edge');
    plus('Add the target node');
    canvasClick(graphPill('edge_1'));

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Delete edge' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('and the 1 node(s) it leads to'));
    expect(graphPill('edge_1')).toBeInTheDocument();

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Delete edge' }));
    expect(document.querySelectorAll('.edge-pill')).toHaveLength(0);
    expect(screen.queryByText('node_1')).toBeNull();
    expect(panelHeading()).toBeNull();
  });

  it('the start node cannot be deleted', async () => {
    setup();
    canvasClick(graphNode('Greeting'));
    expect(screen.queryByRole('button', { name: 'Delete node' })).toBeNull();
    expect(screen.getByText(/start node/)).toBeInTheDocument();
  });

  it('Reset discards the agent after confirmation', async () => {
    const { user } = setup();
    plus('Add an edge');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(document.querySelectorAll('.edge-pill')).toHaveLength(0);
    expect(graphNode('Greeting')).toBeInTheDocument();
  });

  describe('Import JSON', () => {
    const jsonFile = (data: unknown, name = 'agent.json') =>
      new File([typeof data === 'string' ? data : JSON.stringify(data)], name, { type: 'application/json' });
    const fileInput = () => screen.getByLabelText('Import agent JSON file');

    it('sits next to Export and builds the graph from the file', async () => {
      const { user } = setup();
      const buttons = screen.getAllByRole('button').map((b) => b.textContent);
      expect(buttons.indexOf('Import JSON')).toBe(buttons.indexOf('Export JSON') - 1);

      await user.upload(fileInput(), jsonFile(newAgent, 'new_agent.json'));

      for (const name of ['Greeting', 'Collect Details', 'Offer Times', 'Confirm']) expect(graphNode(name)).toBeInTheDocument();
      for (const fn of ['choose_intent', 'record_details', 'select_time']) expect(graphPill(fn)).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Imported "New agent": 4 nodes, 3 edges.');
      expect(screen.getByRole('button', { name: '✓ Valid' })).toBeInTheDocument();
    });

    it('the imported agent is fully editable', async () => {
      const { user } = setup();
      await user.upload(fileInput(), jsonFile(newAgent));
      canvasClick(graphPill('select_time'));
      expect(screen.getByLabelText(/^Function name/)).toHaveValue('select_time');
      expect(screen.getByPlaceholderText(/allowed values/)).toHaveValue('Tuesday 10 AM, Thursday 2 PM');
      const confirmCard = graphNode('Confirm').closest('.agent-node') as HTMLElement;
      canvasClick(within(confirmCard).getByRole('button', { name: 'Add an edge' })); // [+] works on imported nodes
      expect(document.querySelectorAll('.edge-pill')).toHaveLength(4);
    });

    it('asks before replacing an agent with work in it, and keeps it if you cancel', async () => {
      const { user } = setup();
      plus('Add an edge');
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

      await user.upload(fileInput(), jsonFile(newAgent, 'new_agent.json'));
      expect(confirm).toHaveBeenCalledWith('Replace "New agent" with the agent from new_agent.json?');
      expect(graphPill('edge_1')).toBeInTheDocument();
      expect(screen.queryByText('Collect Details')).toBeNull();

      confirm.mockReturnValue(true);
      await user.upload(fileInput(), jsonFile(newAgent, 'new_agent.json'));
      expect(graphNode('Collect Details')).toBeInTheDocument();
      expect(screen.queryByText('edge_1')).toBeNull();
    });

    it('does not ask when the current agent is still blank', async () => {
      const { user } = setup();
      const confirm = vi.spyOn(window, 'confirm');
      await user.upload(fileInput(), jsonFile(newAgent));
      expect(confirm).not.toHaveBeenCalled();
    });

    it('shows why a file was rejected and leaves the graph alone', async () => {
      const { user } = setup();
      await user.upload(fileInput(), jsonFile('{ not json', 'broken.json'));
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent("Couldn't import broken.json");
      expect(alert).toHaveTextContent('Not valid JSON');
      expect(graphNode('Greeting')).toBeInTheDocument();

      await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('lists warnings for anything changed on the way in', async () => {
      const { user } = setup();
      const withExtras = structuredClone(newAgent) as typeof newAgent & { nodes: Record<string, unknown>[] };
      withExtras.nodes[0].pre_actions = [{ type: 'tts_say', text: 'Hello!' }];
      await user.upload(fileInput(), jsonFile(withExtras));
      expect(screen.getByRole('status')).toHaveTextContent('"pre_actions" isn\'t supported by the editor yet and was dropped.');
    });
  });
});

