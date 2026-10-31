import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const scratch = mkdtempSync(join(tmpdir(), 'flow protocol ü '));
const home = join(scratch, 'home');
const output = join(scratch, 'films');
const outside = join(scratch, 'outside');
for (const dir of [home, output, outside]) mkdirSync(dir);
writeFileSync(join(outside, 'secret.mp4'), 'private sentinel');
let child, client, transport, base, token, env;
before(async () => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(r => probe.close(r));
  env = { ...process.env, FLOW_MCP_PORT: String(port), FLOW_MCP_HOME: home, FLOW_MCP_OUTPUT: output,
    FLOW_MCP_CHROME: join(scratch, 'CHROME_MUST_NEVER_RUN'), FLOW_MCP_PATIENCE_MS: '100' };
  child = fork(fileURLToPath(new URL('./fixtures/backend.mjs', import.meta.url)), [], { env, silent: true });
  let errors = '';
  child.stderr.on('data', x => errors += x);
  const message = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(errors); })]);
  assert.equal(message[0].role, 'owner');
  token = readFileSync(join(home, 'token'), 'utf8');
  base = `http://127.0.0.1:${port}`;
});
after(async () => {
  await client?.close();
  await transport?.close();
  if (child && child.exitCode === null) { const done = once(child, 'exit'); child.kill(); await done; }
  rmSync(scratch, { recursive: true, force: true });
});
const headers = () => ({ 'x-flow-token': token });
const media = path => `${base}/media?path=${encodeURIComponent(path)}`;

test('Studio HTML, authentication, Host and schema checks', async () => {
  const page = await fetch(base);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Flow Studio/);
  assert.ok(html.includes(token));
  assert.ok(!html.includes('__FLOW_TOKEN__'));
  assert.equal((await fetch(`${base}/api/outputs`, { method: 'POST' })).status, 401);
  const code = await new Promise((ok, fail) => {
    const req = request(base, { headers: { Host: 'evil.example', 'x-flow-token': token } }, res => { res.resume(); ok(res.statusCode); });
    req.on('error', fail); req.end();
  });
  assert.equal(code, 403);
  for (const project of ['..', '../escape', 'CON']) {
    const response = await fetch(`${base}/api/generate`, { method: 'POST', headers: headers(), body: JSON.stringify({ project, scenes: [{ prompt: 'test' }] }) });
    assert.equal(response.status, 400);
  }
});

test('media denies symlink/junction escape in all three allowed roots; valid media and upload work', async () => {
  const roots = [output, join(home, 'uploads'), join(home, 'captions')];
  // Read the actual cache location used by captions (currently HOME/captions).
  for (const root of roots) {
    mkdirSync(root, { recursive: true });
    symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal((await fetch(media(join(root, 'escape', 'secret.mp4')), { headers: headers() })).status, 404);
    writeFileSync(join(root, 'valid.mp4'), '0123456789');
    const valid = await fetch(media(join(root, 'valid.mp4')), { headers: headers() });
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), '0123456789');
  }
  assert.equal((await fetch(media(join(outside, 'secret.mp4')), { headers: headers() })).status, 404);
  assert.equal((await fetch(media(output), { headers: headers() })).status, 404);
  const range = await fetch(media(join(output, 'valid.mp4')), { headers: { ...headers(), Range: 'bytes=2-5' } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), '2345');
  const upload = await fetch(`${base}/api/upload?name=fixture.png`, { method: 'POST', headers: headers(), body: 'offline image fixture' });
  assert.equal(upload.status, 200);
  const { path } = await upload.json();
  assert.equal(await (await fetch(media(path), { headers: headers() })).text(), 'offline image fixture');
});

const calls = {
  flow_status: ['status', {}],
  flow_generate: ['generate', { project: 'Test', scenes: [{ prompt: 'offline' }] }],
  flow_wait: ['wait', { timeout_seconds: 5 }],
  flow_cancel: ['cancel', { job_id: 'fake' }],
  flow_retry: ['retry', {}],
  flow_assets: ['assets', {}],
  flow_download: ['download', { project: 'Test', assets: ['fake'] }],
  flow_agent_images: ['agent', { project: 'Test', scenes: ['offline'] }],
  flow_edit: ['edit', { project: 'Test', asset: 'fake', prompt: 'offline', acknowledge_cost: true }],
  flow_continue: ['continue_shot', { project: 'Test', from_asset: 'fake', prompt: 'offline', acknowledge_cost: true }],
  flow_trash: ['trash', { name: 'fake' }],
  flow_character: ['character', { name: 'fake', describe: 'offline' }],
  flow_character_edit: ['character_edit', { name: 'fake', change: 'offline' }],
  flow_characters: ['characters', {}],
  flow_techniques: ['techniques', {}],
  flow_narrate: ['narrate', { project: 'Test', text: 'offline' }],
  flow_voices: ['voices', {}],
  flow_assemble: ['assemble', { project: 'Test' }],
  flow_transcribe: ['transcribe', { video: 'fake.mp4' }],
  flow_captions: ['captions', { video: 'fake.mp4' }],
};
test('MCP stdio initialize/list and all 20 calls route through RemoteCore to fake owner', async () => {
  transport = new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env, stderr: 'pipe' });
  client = new Client({ name: 'offline-regression', version: '1.0.0' });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), Object.keys(calls).sort());
  for (const [name, [method, args]] of Object.entries(calls)) {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, `${name}: ${JSON.stringify(result)}`);
    assert.equal(JSON.parse(result.content[0].text).method, method, name);
  }
  const rejected = await client.callTool({ name: 'flow_generate', arguments: { project: '..', scenes: [{ prompt: 'offline' }] } });
  assert.ok(rejected.isError);
});
