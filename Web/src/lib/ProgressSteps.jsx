import { useEffect, useState } from 'react';

export function ProgressSteps({ state, onRetry, onUndo }) {
  const [undoAvailable, setUndoAvailable] = useState(false);

  useEffect(() => {
    if (state?.phase !== 'undo') {
      setUndoAvailable(false);
      return undefined;
    }
    setUndoAvailable(true);
    const timer = setTimeout(() => setUndoAvailable(false), Math.max(0, state.undoUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [state?.phase, state?.undoUntil]);

  if (!state || state.phase === 'idle') return null;
  const determinate = Number.isFinite(state.total) && state.total > 0;
  const details = state.error ? `${state.error}\n${state.message}` : state.message;

  return (
    <div className={`admin-preview ${state.phase === 'error' ? 'is-error' : 'is-ok'}`} role="status" aria-live="polite">
      <strong>{state.label}</strong>
      {state.phase === 'working' && <progress value={determinate ? state.done : undefined} max={determinate ? state.total : undefined} aria-label={state.message || 'Action progress'} />}
      {state.message && <span>{state.message}</span>}
      {state.total > 0 && <span>{state.done} of {state.total}</span>}
      {state.steps?.length > 0 && <ol>{state.steps.map((step, index) => <li key={`${step.label}-${index}`}>{step.label}{step.status === 'complete' ? ' ✓' : '…'}{step.durationMs ? ` (${step.durationMs} ms)` : ''}</li>)}</ol>}
      {state.phase === 'error' && <div className="admin-import-actions"><button type="button" className="btn btn-sm" onClick={onRetry || state.retry}>Retry</button><button type="button" className="text-btn" onClick={() => navigator.clipboard?.writeText(details)}>Copy details</button></div>}
      {state.phase === 'undo' && undoAvailable && <button type="button" className="btn btn-sm" onClick={() => { setUndoAvailable(false); onUndo?.(); }}>Undo</button>}
    </div>
  );
}