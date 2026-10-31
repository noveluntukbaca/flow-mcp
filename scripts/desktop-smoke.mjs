// Real Electron, fake HTTP backend. No Chrome/Flow/Google calls or credits.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';
// Avoid a trailing Windows backslash before a closing CLI quote.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'flow-electron ü '));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const env = { ...process.env, FLOW_MCP_PORT: String(port), FLOW_MCP_HOME: join(scratch, 'home'), FLOW_MCP_OUTPUT: join(scratch, 'output'),
  // Exists, satisfies the file dependency check, never invoked by the fake backend.
  FLOW_MCP_CHROME: process.execPath, FLOW_MCP_FFMPEG: join(scratch, 'missing-ffmpeg'), FLOW_MCP_FFPROBE: join(scratch, 'missing-ffprobe') };
delete env.ELECTRON_RUN_AS_NODE;
let electron, fake;
try {
  fake = fork(join(root, 'test/fixtures/desktop-smoke-backend.mjs'), [], { env, silent: true });
  const [ready] = await Promise.race([
    once(fake, 'message'),
    once(fake, 'exit').then(() => { throw new Error('Fake backend exited'); }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Fake backend timeout')), 10000); timer.unref(); }),
  ]);
  assert.equal(ready.role, 'owner');
  const executablePath = process.env.FLOW_DESKTOP_SMOKE_EXECUTABLE;
  electron = await _electron.launch({ executablePath, args: [...(executablePath ? [] : [root]), `--user-data-dir=${join(scratch, 'electron')}`], env, timeout: 60000 });
  const startup = await electron.firstWindow();
  await startup.locator('#start:enabled').waitFor();
  assert.match(await startup.locator('#ffmpeg').textContent(), /opsional/);
  assert.equal(await startup.evaluate(() => typeof window.require), 'undefined');
  assert.deepEqual(await startup.evaluate(() => Object.keys(window.flowDesktop).sort()), ['check', 'start']);
  await electron.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    if (!prefs.sandbox || !prefs.contextIsolation || prefs.nodeIntegration) throw new Error('Insecure startup preferences');
  });
  const nextWindow = electron.waitForEvent('window');
  await startup.locator('#start').click();
  const studio = await nextWindow;
  await studio.waitForURL(`http://127.0.0.1:${port}/`);
  await studio.waitForFunction(() => document.querySelector('#status')?.textContent.includes('Not signed in'));
  assert.equal(await studio.evaluate(() => typeof window.flowDesktop), 'undefined');
  assert.equal(await studio.evaluate(() => typeof window.require), 'undefined');
  assert.equal(await studio.evaluate(async () => (await fetch('/api/health')).status), 200);
  assert.equal(await studio.evaluate(async () => { try { await fetch('https://example.com'); return false; } catch { return true; } }), true);
  const csp = await studio.evaluate(async () => (await fetch('/')).headers.get('content-security-policy'));
  assert.match(csp, /script-src 'sha256-/);
  assert.equal(await studio.evaluate(() => { const script = document.createElement('script'); script.textContent = 'window.UNTRUSTED_SCRIPT_RAN=true'; document.body.append(script); return !!window.UNTRUSTED_SCRIPT_RAN; }), false);
  await studio.evaluate(() => { const link = document.createElement('a'); link.href = 'https://example.com'; link.textContent = 'test navigation'; link.id = 'blocked-navigation'; document.body.append(link); });
  await studio.locator('#blocked-navigation').click({ noWaitAfter: true });
  assert.equal(studio.url(), `http://127.0.0.1:${port}/`);
  await electron.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    if (!prefs.sandbox || !prefs.contextIsolation || prefs.nodeIntegration || prefs.preload) throw new Error('Insecure Studio preferences');
    BrowserWindow.getAllWindows()[0].close();
  });
  if (electron.process().exitCode === null) await once(electron.process(), 'exit');
  // The desktop utility attached as a client, so its exit must leave the fake owner alive.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
  console.log('Electron startup → Studio → authenticated local UI → safe client shutdown: PASS (no Google calls)');
} finally {
  await electron?.close().catch(() => {});
  if (fake && fake.exitCode === null) { const stopped = once(fake, 'exit'); fake.kill(); await stopped; }
  rmSync(scratch, { recursive: true, force: true });
}
