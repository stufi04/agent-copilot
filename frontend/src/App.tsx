import { ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { CallButton, CallPanel } from './call/CallControls';
import { CopilotPanel } from './copilot/CopilotPanel';
import { Canvas } from './graph/Canvas';
import { useEditor } from './model/store';
import { erroredIds, validate } from './model/validate';
import { SidePanel } from './panel/SidePanel';
import { TopBar } from './TopBar';
import { useUndoShortcuts } from './useUndoShortcuts';

export default function App() {
  const draft = useEditor((s) => s.draft);
  const issues = useMemo(() => validate(draft), [draft]);
  const errored = useMemo(() => erroredIds(issues), [issues]);
  const blocked = issues.some((i) => i.severity === 'error');
  useUndoShortcuts();

  return (
    <div className="app">
      <TopBar issues={issues} />
      <main className="workspace">
        <div className="canvas">
          <ReactFlowProvider>
            <Canvas errored={errored} />
          </ReactFlowProvider>
          {/* Top-left of the canvas, under the AgentEditor title: the call button, and the conversation below it. */}
          <div className="call-dock">
            <CallButton blocked={blocked} />
            <CallPanel />
          </div>
        </div>
        <SidePanel issues={issues} />
      </main>
      {/* Along the bottom, the full width of the editor, like an IDE's assistant panel. */}
      <CopilotPanel />
    </div>
  );
}
