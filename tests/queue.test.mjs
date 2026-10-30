import test from 'node:test';
import assert from 'node:assert/strict';
process.env.FLOW_MCP_PAUSE_MIN_S = '0'; process.env.FLOW_MCP_PAUSE_MAX_S = '0';
const { JobQueue } = await import('../dist/queue.js');
const { alignText } = await import('../dist/captions.js');
const { shapes } = await import('../dist/core.js');
const { z } = await import('zod');
const params = { prompt: 'offline', type: 'image', max_credits: 0, output_dir: 'unused', file_stem: 'scene-01' };
async function settled(queue) {
  for (let i = 0; i < 100; i++) { if (!queue.list().some(j => ['running','queued'].includes(j.status))) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('Queue never settled');
}
test('queue serializes jobs and cancels only queued jobs', async () => {
  let release, running = 0, maximum = 0; const gate = new Promise(r => release = r);
  const queue = new JobQueue(async () => { running++; maximum = Math.max(maximum, running); await gate; running--; return ['fake.mp4']; });
  const a = queue.add(params), b = queue.add(params); queue.cancel(a.id); queue.cancel(b.id);
  assert.equal(a.status, 'running'); assert.equal(b.status, 'cancelled'); release(); await settled(queue);
  assert.equal(a.status, 'done'); assert.equal(maximum, 1);
});
test('failed job can retry explicitly; ambiguous timeout is not automatically retried', async () => {
  let calls = 0; const queue = new JobQueue(async () => { if (++calls === 1) throw new Error('Timeout: outcome unknown'); return ['fake.mp4']; });
  const job = queue.add(params); await settled(queue); assert.equal(job.status, 'failed'); assert.equal(calls, 1);
  queue.retry(job.id); await settled(queue); assert.equal(job.status, 'done'); assert.equal(calls, 2);
});
test('schemas retain credit caps and scene validation', () => {
  assert.throws(() => z.object(shapes.generate).parse({ project: '..', scenes: [{ prompt: 'x' }] }));
  assert.throws(() => z.object(shapes.generate).parse({ project: 'demo', scenes: [{ prompt: 'x', max_credits: -1 }] }));
  assert.equal(z.object(shapes.generate).parse({ project: 'demo', scenes: [{ prompt: 'x' }] }).scenes[0].max_credits, 25);
});
test('caption alignment keeps timing and explicit line breaks', () => {
  const result = alignText([{ text: 'Hello', start: 0, end: 1 }, { text: 'world', start: 1, end: 2 }], 'Hello\nworld');
  assert.equal(result[1].br, true); assert.equal(result[1].start, 1);
});
