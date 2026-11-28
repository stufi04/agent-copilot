import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setConnectionFactory, useCall } from '../call/call';
import { useEditor } from '../model/store';

// jsdom lacks a few browser APIs React Flow relies on; minimal stand-ins.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

class DOMMatrixReadOnlyStub {
  m22: number;
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.])\)/)?.[1];
    this.m22 = scale !== undefined ? Number(scale) : 1;
  }
}
globalThis.DOMMatrixReadOnly ??= DOMMatrixReadOnlyStub as unknown as typeof DOMMatrixReadOnly;

// Every test starts from a fresh agent (a lone Greeting node) and empty storage.
beforeEach(() => {
  localStorage.clear();
  useEditor.getState().reset();
  useEditor.setState({ past: [], future: [] });
  useCall.setState({ status: 'idle', lines: [], activeNode: null, error: null, agentName: null });
  setConnectionFactory(null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
