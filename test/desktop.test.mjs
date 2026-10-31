import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allowedRequest, allowedExternal, studioOrigin, desktopPreferences } from '../dist/desktop/policy.js';

const scratch = mkdtempSync(join(tmpdir(), 'flow-desktop ü '));
let base, backend, startDesktopBackend, token, busy = false, release, entered;
const core = {
  outputs: async () => ({ projects: [] }),
  techniques: async () => { entered?.(); await new Promise(resolve => { release = resolve; }); return []; },
};
before(async () => {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  process.env.FLOW_MCP_PORT = String(port);
  process.env.FLOW_MCP_HOME = scratch;
  process.env.FLOW_MCP_OUTPUT = join(scratch, 'output');
  ({ startDesktopBackend } = await import('../dist/desktop/backend.js'));
  backend = await startDesktopBackend(core, () => busy);
  base = studioOrigin(port);
  token = readFileSync(join(scratch, 'token'), 'utf8');
});
after(async () => { busy = false; release?.(); await backend?.stop(); rmSync(scratch, { recursive: true, force: true }); });

 test('desktop security policy rejects other hosts, ports, protocols and external links', () => {
  assert.deepEqual(desktopPreferences, { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false });
  for (const bad of [0, -1, 65536, NaN, 1.5]) assert.throws(() => studioOrigin(bad));
  assert.equal(studioOrigin(8787), 'http://127.0.0.1:8787');
  for (const url of ['http://127.0.0.1:8788/', 'http://localhost:8787/', 'https://evil.test', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user@127.0.0.1:8787', 'blob:https://evil.test/id']) {
    assert.equal(allowedRequest(url, 'http://127.0.0.1:8787'), false, url);
  }
  assert.equal(allowedRequest('http://127.0.0.1:8787/api/health', 'http://127.0.0.1:8787'), true);
  assert.equal(allowedRequest('blob:http://127.0.0.1:8787/id', 'http://127.0.0.1:8787'), true);
  assert.equal(allowedExternal('https://aistudio.google.com/apikey'), true);
  for (const url of ['file:///C:/Windows/System32/cmd.exe', 'https://aistudio.google.com.evil.test/apikey', 'https://aistudio.google.com/apikey?secret=x', 'http://aistudio.google.com/apikey']) assert.equal(allowedExternal(url), false);
});

test('owned backend serves the existing Studio and authenticated API on loopback', async () => {
  assert.equal(backend.role, 'owner');
  const html = await (await fetch(base)).text();
  assert.match(html, /Flow Studio/); assert.ok(html.includes(token));
  const reply = await fetch(`${base}/api/outputs`, { method: 'POST', headers: { 'x-flow-token': token }, body: '{}' });
  assert.deepEqual(await reply.json(), { projects: [] });
  assert.equal((await fetch(`${base}/api/outputs`, { method: 'POST' })).status, 401);
  const status = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(status, 403);
});

test('second desktop controller attaches without replacing token or stopping MCP owner', async () => {
  const second = await startDesktopBackend({ outputs: () => { throw new Error('must not run'); } }, () => false);
  assert.equal(second.role, 'client');
  assert.equal(readFileSync(join(scratch, 'token'), 'utf8'), token);
  assert.equal(await second.stop(), true);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('shutdown refuses queued work and in-flight API work, then releases owned port', async () => {
  busy = true; assert.equal(await backend.stop(), false); busy = false;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = fetch(`${base}/api/techniques`, { method: 'POST', headers: { 'x-flow-token': token }, body: '{}' });
  await started;
  assert.equal(await backend.stop(), false);
  release(); await (await pending).json();
  // Response finish listeners execute before fetch completion.
  assert.equal(await backend.stop(), true);
  await assert.rejects(fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }));
  backend = undefined;
});

test('unrelated localhost server fails closed without starting a second local core', async () => {
  const other = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"name":"other-app"}'); });
  other.listen(Number(process.env.FLOW_MCP_PORT), '127.0.0.1'); await once(other, 'listening');
  try {
    await assert.rejects(startDesktopBackend(core, () => false), /PORT_IN_USE/);
  } finally { await new Promise(resolve => { other.close(resolve); other.closeAllConnections(); }); }
});

test('Studio CSP permits only the exact served inline scripts and loopback assets', async () => {
  const { studioCsp } = await import('../dist/desktop/csp.js');
  const html = '<script>const token="a";</script>';
  const policy = studioCsp(html);
  assert.match(policy, /script-src 'sha256-/);
  assert.ok(!policy.includes("script-src 'unsafe-inline'"));
  assert.notEqual(policy, studioCsp(html.replace('"a"', '"b"')));
  assert.ok(policy.includes("connect-src 'self'"));
  assert.ok(policy.includes("frame-src 'none'"));
});
