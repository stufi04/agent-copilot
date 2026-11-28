import { useEffect } from 'react';
import { useEditor } from './model/store';

// In its own module, not next to the Undo/Redo buttons: React Fast Refresh only
// hot-swaps files that export nothing but components, so edits here apply cleanly.

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y redoes, everywhere in the editor,
 * including while typing in the side panel, so undo always means the same thing.
 * The copilot's message box is the exception: there, ⌘Z undoes typing, as in any chat.
 */
export function useUndoShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.target instanceof Element && e.target.closest('.copilot__composer')) return;
      const key = e.key.toLowerCase();
      const { undo, redo } = useEditor.getState();
      if (key === 'z') {
        e.preventDefault(); // not the text field's own undo
        if (e.shiftKey) redo();
        else undo();
      } else if (key === 'y' && !isMac) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
