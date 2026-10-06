import { randomUUID } from 'node:crypto';

const jobs = new Map();

export function startAdminJob({ label, total = null, run }) {
  const now = new Date().toISOString();
  const job = {
    jobId: randomUUID(),
    status: 'queued',
    step: 'Queued',
    done: 0,
    total: Number.isFinite(total) ? total : null,
    message: `${label} is queued.`,
    error: null,
    result: null,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.jobId, job);

  const update = (patch) => {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  };

  queueMicrotask(async () => {
    update({ status: 'running', step: 'Starting', message: `${label} started.` });
    try {
      const result = await run({
        job,
        report: (patch) => update(patch),
        step: (step, message = '') => update({ status: 'running', step, message })
      });
      update({ status: 'succeeded', step: 'Complete', message: result?.message || `${label} completed.`, result });
    } catch (error) {
      update({ status: 'failed', step: 'Failed', error: String(error?.message || error), message: 'The operation stopped after the reported completed items; no further items were processed.' });
    }
  });

  return { jobId: job.jobId };
}

export function getAdminJob(jobId) {
  return jobs.get(String(jobId)) || null;
}

export function listRecentAdminJobs(limit = 50) {
  return [...jobs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(1, limit));
}

export function clearAdminJobs() {
  jobs.clear();
}