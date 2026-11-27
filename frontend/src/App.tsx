import { ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { Canvas } from './graph/Canvas';
import { useEditor } from './model/store';
import { erroredIds, validate } from './model/validate';
import { SidePanel } from './panel/SidePanel';
import { TopBar } from './TopBar';
import { useUndoShortcuts } from './UndoRedo';

export default function App() {
  const draft = useEditor((s) => s.draft);
  const issues = useMemo(() => validate(draft), [draft]);
  const errored = useMemo(() => erroredIds(issues), [issues]);
  useUndoShortcuts();

  return (
    <div className="app">
      <TopBar issues={issues} />
      <main className="workspace">
        <div className="canvas">
          <ReactFlowProvider>
            <Canvas errored={errored} />
          </ReactFlowProvider>
        </div>
        <SidePanel issues={issues} />
      </main>
    </div>
  );
}
