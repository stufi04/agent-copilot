import { useEditor } from './model/store';
import { isMac } from './useUndoShortcuts';

const MOD = isMac ? '⌘' : 'Ctrl+';

/** A curved arrow; mirrored for redo. */
function ArrowIcon({ flip }: { flip?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M6 3.5 2.5 7 6 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 7h6.5a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function UndoRedoButtons() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    <div className="undo-redo" role="group" aria-label="History">
      <button type="button" className="btn btn--icon btn--ghost" aria-label="Undo" title={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={undo}>
        <ArrowIcon />
      </button>
      <button
        type="button"
        className="btn btn--icon btn--ghost"
        aria-label="Redo"
        title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`}
        disabled={!canRedo}
        onClick={redo}
      >
        <ArrowIcon flip />
      </button>
    </div>
  );
}
