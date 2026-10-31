import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waitForNewMedia, retryNewErrorTiles } from '../dist/flow.js';

test('failed paid result is reported after one scan without ever clicking Retry', async () => {
  const responses = [[], [], 1];
  const page = {
    waitForTimeout: async () => {},
    evaluate: async () => responses.shift(),
    locator: () => { throw Error('Must never look up Retry or another submit control'); },
  };
  await assert.rejects(waitForNewMedia(page, [], 1, 10000,
    { params: { type: 'video', max_credits: 100, retries: 100 }, credits: 20, submissionAttempted: true }, 'video'), /tidak ada retry otomatis/);
  assert.equal(responses.length, 0);
});
test('generation timeout does not claim zero charges and warns about ambiguous submission', async t => {
  let clock = 0; t.mock.method(Date, 'now', () => clock += 1000);
  const page = { waitForTimeout: async () => {}, evaluate: async () => [] };
  await assert.rejects(waitForNewMedia(page, [], 1, 500), error => error.code === 'FLOW_GENERATION_TIMEOUT' && error.submitted && /memakai kredit/.test(error.message));
});
test('error tile inspection defaults to dry-run without clicking Retry', async () => {
  const page = {
    waitForTimeout: async () => {},
    evaluate: async (_fn, args) => args ? 'error' : undefined,
    locator: () => { throw Error('Must not locate a Retry button'); },
  };
  assert.deepEqual(await retryNewErrorTiles(page, []), { errors: 1, reachedKnown: false, retried: 0 });
});
