import { useCallback, useState } from 'react';

const initialState = { phase: 'idle', label: '', message: '', error: '', steps: [], done: 0, total: null, startedAt: 0 };

export async function runActionSequence(options, onState) {
  const startedAt = Date.now();
  const steps = [];
  let execute = options.execute;

  const publish = (patch) => onState({ ...initialState, ...patch, steps: [...steps] });
  const record = (label, status = 'working', phase = 'working') => {
    const previous = steps.at(-1);
    if (previous && !previous.durationMs) previous.durationMs = Date.now() - previous.startedAt;
    steps.push({ label, status, startedAt: Date.now() });
    publish({ phase, label, startedAt });
  };
  const reportProgress = (progress = {}) => publish({
    phase: 'working',
    label: progress.message || options.label || 'Working…',
    done: Number(progress.done) || 0,
    total: Number.isFinite(Number(progress.total)) ? Number(progress.total) : null,
    message: progress.message || '',
    startedAt
  });

  const run = async () => {
    publish({ phase: 'acknowledged', label: 'Starting…', startedAt });
    await new Promise((resolve) => (globalThis.requestAnimationFrame || ((callback) => setTimeout(callback, 0)))(resolve));
    publish({ phase: 'validating', label: 'Checking request…', startedAt });
    const validationStartedAt = Date.now();
    record('Checking request', 'working', 'validating');
    await options.validate?.();
    steps.at(-1).status = 'complete';
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 180 - (Date.now() - validationStartedAt))));
    record(options.workLabel || 'Working');
    const result = await execute({ reportProgress, step: record });
    const lastStep = steps.at(-1);
    if (lastStep) {
      lastStep.status = 'complete';
      lastStep.durationMs = Date.now() - lastStep.startedAt;
    }
    publish({ phase: 'success', label: 'Complete', message: options.successMessage?.(result) || 'Completed successfully.', done: Number(result?.done) || 0, total: Number.isFinite(Number(result?.total)) ? Number(result.total) : null, startedAt, result, undoUntil: options.undo ? Date.now() + 8000 : 0 });
    if (options.undo) {
      publish({ phase: 'undo', label: 'Completed', message: options.successMessage?.(result) || 'Completed successfully.', startedAt, result, undoUntil: Date.now() + 8000 });
      return { result, undo: () => options.undo(result) };
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    publish({ phase: 'next', label: 'Completed', message: options.nextStep || options.successMessage?.(result) || 'Completed successfully.', startedAt, result });
    return { result };
  };

  try {
    return await run();
  } catch (error) {
    publish({ phase: 'error', label: 'Could not complete', error: String(error?.message || error), message: options.failureMessage || 'Review completed progress; any confirmed work remains applied.', startedAt, retry: run });
    throw error;
  }
}

export function useAction() {
  const [state, setState] = useState(initialState);
  const run = useCallback((options) => runActionSequence(options, setState), []);
  const reset = useCallback(() => setState(initialState), []);
  return { state, run, reset };
}

export function useActionMap() {
  const [states, setStates] = useState({});
  const run = useCallback((key, options) => runActionSequence(options, (state) => {
    setStates((previous) => ({ ...previous, [key]: state }));
  }), []);
  const reset = useCallback((key) => {
    setStates((previous) => {
      const next = { ...previous };
      if (key === undefined) return {};
      delete next[key];
      return next;
    });
  }, []);
  return { states, run, reset };
}