import { useSyncExternalStore } from 'react';

/** `null` until the launch check has finished. */
let modelsReady: boolean | null = null;
const listeners = new Set<() => void>();

export function setModelsReady(ready: boolean): void {
  modelsReady = ready;
  listeners.forEach((l) => l());
}

export function useModelsReady(): boolean | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => modelsReady,
  );
}
