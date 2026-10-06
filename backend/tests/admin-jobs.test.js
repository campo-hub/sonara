import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAdminJobs, getAdminJob, startAdminJob } from '../src/adminJobs.js';

test('admin jobs report step and determinate progress until completion', async () => {
  clearAdminJobs();
  let finish;
  const { jobId } = startAdminJob({
    label: 'Re-queue batch',
    total: 3,
    run: async ({ step, report }) => {
      step('Finding outstanding tracks');
      report({ done: 2, total: 3, message: 'Re-queued 2 of 3 tracks.' });
      await new Promise((resolve) => { finish = resolve; });
      return { message: 'Re-queued 3 tracks.' };
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getAdminJob(jobId).status, 'running');
  assert.equal(getAdminJob(jobId).done, 2);
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getAdminJob(jobId).status, 'succeeded');
});

test('admin jobs preserve failure reason and current progress', async () => {
  clearAdminJobs();
  const { jobId } = startAdminJob({ label: 'Apply import', run: async () => { throw new Error('batch no longer exists'); } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getAdminJob(jobId).status, 'failed');
  assert.equal(getAdminJob(jobId).error, 'batch no longer exists');
});