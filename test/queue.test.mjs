import { test } from 'node:test';
import assert from 'node:assert/strict';
process.env.FLOW_MCP_PAUSE_MIN_S = '0';
process.env.FLOW_MCP_PAUSE_MAX_S = '0';
const { JobQueue } = await import('../dist/queue.js');
const params = { prompt: 'fake', type: 'image', max_credits: 0, output_dir: 'unused', file_stem: 'scene-01' };
const tick = () => new Promise(r => setImmediate(r));
async function idle(queue) {
  for (let i = 0; i < 100; i++) { if (!queue.list().some(j => ['queued', 'running'].includes(j.status))) return; await tick(); }
  assert.fail('Fake queue did not finish');
}
test('queue is serial, cancels pending work and retries cancelled jobs', async () => {
  let release;
  const gate = new Promise(r => release = r);
  const ran = [];
  let active = 0;
  const q = new JobQueue(async job => {
    assert.equal(++active, 1);
    ran.push(job.id);
    await gate;
    active--;
    return ['fake.png'];
  });
  const first = q.add(params), second = q.add(params), third = q.add(params);
  assert.equal(q.busy, true);
  assert.equal(q.cancel(first.id).status, 'running');
  assert.equal(q.cancel(second.id).status, 'cancelled');
  release();
  await idle(q);
  assert.deepEqual(ran, [first.id, third.id]);
  assert.equal(q.retry(second.id).params.file_stem, params.file_stem);
  await idle(q);
  assert.deepEqual(ran, [first.id, third.id, second.id]);
  assert.equal(second.attempts, 1);
});
test('queue retries only a verified zero-cost pre-submit failure; ambiguous timeouts are not retried', async () => {
  const retry = new JobQueue(async job => {
    job.credits = 0;
    if (job.attempts === 1) throw new Error('Agent finished without creating images');
    return ['fake.png'];
  });
  const job = retry.add(params);
  await idle(retry);
  assert.equal(job.status, 'done'); assert.equal(job.attempts, 2);
  const ambiguous = new JobQueue(async () => { throw new Error('Timeout waiting for generation'); });
  const timed = ambiguous.add(params);
  await idle(ambiguous);
  assert.equal(timed.status, 'failed'); assert.equal(timed.attempts, 1);
});

for (const scenario of [
  { label: 'paid video', params: { type: 'video', max_credits: 20 }, credits: 20 },
  { label: 'unknown cost', params: {}, credits: undefined },
  { label: 'submitted image with zero quote', params: {}, credits: 0, submitted: true },
  { label: 'unquoted Agent image batch', params: { agent_scenes: ['fixture'] }, credits: 0 },
]) {
  test(`queue never automatically retries ${scenario.label}`, async () => {
    let calls = 0;
    const q = new JobQueue(async job => {
      calls++; job.credits = scenario.credits; job.submissionAttempted = scenario.submitted;
      throw new Error('Agent finished without creating images');
    });
    const job = q.add({ ...params, ...scenario.params, retries: 10 });
    await idle(q);
    assert.equal(calls, 1); assert.equal(job.status, 'failed');
  });
}
