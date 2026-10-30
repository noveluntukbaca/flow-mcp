import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const dir = mkdtempSync(join(tmpdir(), 'flow api ü '));
const env = { ...process.env, FLOW_MCP_HOME: join(dir, 'home'), FLOW_MCP_OUTPUT: join(dir, 'output'), FLOW_MCP_CHROME: join(dir, 'no-browser') };
const repo = fileURLToPath(new URL('..', import.meta.url));
let child, base, token, client;
function http(path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, { method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(body);
  });
}
const auth = () => ({ 'x-flow-token': token, 'content-type': 'application/json' });
before(async () => {
  const port = createServer(); port.listen(0, '127.0.0.1'); await once(port, 'listening');
  env.FLOW_MCP_PORT = String(port.address().port); await new Promise(r => port.close(r));
  base = `http://127.0.0.1:${env.FLOW_MCP_PORT}`;
  for (const folder of [env.FLOW_MCP_HOME, env.FLOW_MCP_OUTPUT, join(env.FLOW_MCP_HOME, 'captions')]) mkdirSync(folder, { recursive: true });
  child = fork(fileURLToPath(new URL('helpers/fixture.mjs', import.meta.url)), { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let errors = ''; child.stderr.on('data', c => errors += c);
  const message = await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error(errors); })]);
  token = message[0].token; assert.ok(message[0].ready);
});
after(async () => {
  if (client) await client.close();
  if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
  rmSync(dir, { recursive: true, force: true });
});
test('health and Studio HTML work without executing browser UI', async () => {
  assert.equal((await http('/api/health')).status, 200);
  const page = await http('/'); assert.equal(page.status, 200);
  assert.ok(page.body.includes('flow-studio-v2')); assert.ok(!page.body.includes('__FLOW_TOKEN__'));
});
test('API rejects wrong Host, missing token and wrong token', async () => {
  assert.equal((await http('/api/health', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await http('/api/techniques', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await http('/api/techniques', { method: 'POST', headers: { 'x-flow-token': 'bad' }, body: '{}' })).status, 401);
});
test('only explicitly declared API methods are callable', async () => {
  assert.equal((await http('/api/toString', { method: 'POST', headers: auth(), body: '{}' })).status, 404);
  const techniques = await http('/api/techniques', { method: 'POST', headers: auth(), body: '{}' });
  assert.ok(JSON.parse(techniques.body).length > 0);
});
test('invalid generation schema fails before fake core execution', async () => {
  const res = await http('/api/generate', { method: 'POST', headers: auth(), body: JSON.stringify({ project: 'demo', scenes: [] }) });
  assert.equal(res.status, 400); assert.ok(!res.body.includes('Flow disabled'));
  const traversal = await http('/api/generate', { method: 'POST', headers: auth(), body: JSON.stringify({ project: '..', scenes: [{ prompt: 'offline' }] }) });
  assert.equal(traversal.status, 400); assert.ok(traversal.body.includes('Invalid project'));
  assert.ok(!traversal.body.includes('Flow disabled'));
});
for (const root of ['output', 'uploads', 'captions']) {
  test(`media denies directory symlink/junction escape under ${root}`, async () => {
    const allowed = root === 'output' ? env.FLOW_MCP_OUTPUT : join(env.FLOW_MCP_HOME, root);
    const external = join(dir, `outside-${root}`); mkdirSync(external); writeFileSync(join(external, 'secret.mp4'), 'private sentinel');
    const link = join(allowed, 'linked'); symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    const response = await http('/media?' + new URLSearchParams({ path: join(link, 'secret.mp4') }), { headers: auth() });
    assert.equal(response.status, 404); assert.ok(!response.body.includes('private sentinel'));
  });
}
test('media denies file symlink escape', { skip: process.platform === 'win32' ? 'Developer Mode needed; junction coverage runs on Windows' : false }, async () => {
  const external = join(dir, 'private.mp4'); writeFileSync(external, 'private');
  const link = join(env.FLOW_MCP_OUTPUT, 'file-link.mp4'); symlinkSync(external, link);
  assert.equal((await http('/media?' + new URLSearchParams({ path: link }), { headers: auth() })).status, 404);
});
test('media allows normal files and ranges, denies sibling/directory/missing paths', async () => {
  const file = join(env.FLOW_MCP_OUTPUT, 'ok.mp4'); writeFileSync(file, '0123456789');
  const query = '/media?' + new URLSearchParams({ path: file });
  assert.equal((await http(query, { headers: auth() })).body, '0123456789');
  const ranged = await http(query, { headers: { ...auth(), range: 'bytes=2-4' } });
  assert.equal(ranged.status, 206); assert.equal(ranged.body, '234');
  assert.equal((await http(query, { headers: { ...auth(), range: 'bytes=-3' } })).body, '789');
  assert.equal((await http(query, { headers: { ...auth(), range: 'bytes=3-' } })).body, '3456789');
  for (const range of ['bytes=-0', 'bytes=-', 'bytes=5-2', 'bytes=0-1,3-4', 'invalid']) assert.equal((await http(query, { headers: { ...auth(), range } })).status, 416);
  assert.equal((await http(query, { headers: { ...auth(), range: 'bytes=99-100' } })).status, 416);
  for (const path of [env.FLOW_MCP_OUTPUT, join(dir, 'output-evil', 'ok.mp4'), join(env.FLOW_MCP_OUTPUT, 'missing.mp4')]) {
    assert.equal((await http('/media?' + new URLSearchParams({ path }), { headers: auth() })).status, 404);
  }
});
test('upload creates private readable files inside the upload folder', async () => {
  const first = await http('/api/upload?name=../../clip.mp4', { method: 'POST', headers: auth(), body: 'offline upload' });
  assert.equal(first.status, 200); const file = JSON.parse(first.body).path;
  assert.equal(readFileSync(file, 'utf8'), 'offline upload');
  assert.equal((await http('/media?' + new URLSearchParams({ path: file }), { headers: auth() })).body, 'offline upload');
});
test('discard outside/junction targets returns error without deleting sentinel', async () => {
  const path = join(env.FLOW_MCP_OUTPUT, 'linked', 'secret.mp4');
  const res = await http('/api/discard', { method: 'POST', headers: auth(), body: JSON.stringify({ path }) });
  assert.equal(res.status, 400); assert.equal(readFileSync(join(dir, 'outside-output', 'secret.mp4'), 'utf8'), 'private sentinel');
});
test('MCP preserves all tools and calls RemoteCore over the running owner', async () => {
  client = new Client({ name: 'offline-regression', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], cwd: repo, env }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(t => t.name).sort(), ['flow_status','flow_generate','flow_wait','flow_cancel','flow_retry','flow_assets','flow_download','flow_agent_images','flow_edit','flow_continue','flow_trash','flow_character','flow_character_edit','flow_characters','flow_techniques','flow_narrate','flow_voices','flow_assemble','flow_transcribe','flow_captions'].sort());
  const result = await client.callTool({ name: 'flow_techniques', arguments: {} });
  assert.ok(!result.isError); assert.ok(JSON.parse(result.content[0].text).length > 0);
});

test('media refuses hardlinks to outside files', async () => {
  const external = join(dir, 'hardlink-sentinel.mp4'); writeFileSync(external, 'hardlink sentinel');
  const linked = join(env.FLOW_MCP_OUTPUT, 'hardlink.mp4'); linkSync(external, linked);
  assert.equal((await http('/media?' + new URLSearchParams({ path: linked }), { headers: auth() })).status, 404);
});
for (const folder of ['uploads', 'captions']) {
  test(`replaced ${folder} root cannot become a trusted media or write root`, async () => {
    const original = join(env.FLOW_MCP_HOME, folder), backup = original + '-backup';
    const external = join(dir, `relocated-${folder}`); mkdirSync(external); writeFileSync(join(external, 'private.mp4'), 'private');
    renameSync(original, backup);
    symlinkSync(external, original, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      assert.equal((await http('/media?' + new URLSearchParams({ path: join(original, 'private.mp4') }), { headers: auth() })).status, 404);
      if (folder === 'uploads') assert.equal((await http('/api/upload?name=new.mp4', { method: 'POST', headers: auth(), body: 'no write' })).status, 400);
    } finally { rmSync(original, { recursive: true, force: true }); renameSync(backup, original); }
    assert.deepEqual((await import('node:fs')).readdirSync(external), ['private.mp4']);
  });
}
