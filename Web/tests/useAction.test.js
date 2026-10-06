import test from 'node:test';
import assert from 'node:assert/strict';
import { runActionSequence } from '../src/lib/useAction.js';

test('action sequence exposes validation, progress, success, and undo states', async () => {
  const phases = [];
  const result = await runActionSequence({
    label: 'Re-queue tracks',
    validate: async () => {},
    execute: async ({ reportProgress, step }) => {
      step('Finding outstanding tracks');
      reportProgress({ done: 3, total: 3, message: 'Re-queued 3 tracks' });
      return { done: 3, total: 3 };
    },
    successMessage: ({ done }) => `Re-queued ${done} tracks`,
    undo: async () => 'undone'
  }, (state) => phases.push(state.phase));

  assert.deepEqual(phases.slice(0, 2), ['acknowledged', 'validating']);
  assert.equal(phases.includes('working'), true);
  assert.equal(phases.includes('success'), true);
  assert.equal(phases.at(-1), 'undo');
  assert.equal(await result.undo(), 'undone');
});

test('action failures expose a concrete error state and retry handler', async () => {
  const phases = [];
  await assert.rejects(runActionSequence({ execute: async () => { throw new Error('batch missing'); } }, (state) => phases.push(state)));
  const errorState = phases.at(-1);
  assert.equal(errorState.phase, 'error');
  assert.match(errorState.error, /batch missing/);
  assert.equal(typeof errorState.retry, 'function');
});