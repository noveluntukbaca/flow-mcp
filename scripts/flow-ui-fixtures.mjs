// Actual Playwright locators against synthetic HTML inside sandboxed Electron.
// Network is denied except an invalid fixture host; no Google request, profile, login, or paid action.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { _electron } from 'playwright-core';
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const scratch = mkdtempSync(join(tmpdir(), 'flow-ui-fixtures ü '));
process.env.FLOW_MCP_HOME = join(scratch, 'home');
process.env.FLOW_MCP_OUTPUT = join(scratch, 'output');
const { setAgentModeCompatible, prepareCharacterCreation } = await import('../dist/flow-ui.js');
const { createCharacterOnPage } = await import('../dist/flow.js');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let electron;
try {
 electron = await _electron.launch({ args: [join(root, 'test/fixtures/flow-ui/electron.cjs'), `--user-data-dir=${join(scratch, 'electron')}`], env, timeout: 60000 });
 const real = await electron.firstWindow();
 const html = readFileSync(join(root, 'test/fixtures/flow-ui/project.html'), 'utf8');
 let served = html;
 await real.route('**/*', route => {
   assert.equal(new URL(route.request().url()).hostname, 'flow-fixture.invalid');
   return route.fulfill({ contentType: 'text/html', body: served });
 });
 const projected = raw => new URL(raw.replace('flow-fixture.invalid', 'flow.google.com'));
 // Only the URL read/validation is projected. All browser navigation stays on the invalid fixture host.
 const page = new Proxy(real, { get(target, key) {
   if (key === 'url') return () => projected(target.url()).href;
   if (key === 'goto') return (url, options) => target.goto(url.replace('flow.google.com', 'flow-fixture.invalid'), options);
   if (key === 'waitForURL') return (predicate, options) => target.waitForURL(url => predicate(projected(url.href)), options);
   const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
 }});
 await page.goto('https://flow.google.com/project/offline-project');
 await setAgentModeCompatible(page, false);
 const image = join(scratch, 'portrait.png'); writeFileSync(image, 'offline image fixture');
 let draws = 0;
 const made = await createCharacterOnPage(page, { name: 'Offline Hero', describe: 'fixture portrait' }, undefined, async job => {
   draws++; assert.equal(job.params.max_credits, 0);
   await setAgentModeCompatible(page, false); // Actual locators: no Agent button, known standard composer.
   return [image];
 });
 assert.equal(draws, 1); assert.equal(made.name, 'Offline Hero'); assert.match(made.url, /characters\/local-created$/);
 assert.equal(await real.evaluate(() => window.dispatches), 1); // Upload only, never the fixture generation button.
 assert.equal(await real.getByRole('button', { name: 'Agent', exact: true }).count(), 0);
 // Unknown native creation is intentionally not clicked, and no portrait is drawn.
 served = html.replace("document.querySelector('#main').innerHTML = '<button id=\"new\">Create character</button>';", "document.querySelector('#main').innerHTML = '<label>Character description<textarea aria-label=\"Character description\"></textarea></label><button id=\"new\">Create character</button>';");
 await page.goto('https://flow.google.com/project/offline-project');
 await assert.rejects(createCharacterOnPage(page, { name: 'Unsupported', describe: 'must not draw' }, undefined, async () => { draws++; throw Error('must not run'); }), /FLOW_CHARACTER_FORM_UNSUPPORTED/);
 assert.equal(draws, 1); assert.equal(await real.evaluate(() => window.dispatches), 0);
 // Unnamed/renamed native editor also must not be interpreted as safe navigation.
 served = html.replace('<button id="new">Create character</button>', '<textarea aria-label="Unfamiliar prompt"></textarea><button id="new">Create character</button>');
 await page.goto('https://flow.google.com/project/offline-project');
 await assert.rejects(createCharacterOnPage(page, { name: 'Unknown native', describe: 'must not draw' }, undefined, async () => { draws++; throw Error('must not run'); }), /FLOW_CHARACTER_FORM_UNSUPPORTED/);
 assert.equal(draws, 1); assert.equal(await real.evaluate(() => window.dispatches), 0);
 // A clicked/uploaded request whose editor controls differ must never draw/upload again.
 served = html.replace('Character name', 'Unknown field').replace('aria-label="Character name"', 'aria-label="Unknown field"');
 await page.goto('https://flow.google.com/project/offline-project');
 await assert.rejects(createCharacterOnPage(page, { name: 'Partial', image }), error => error.submitted && /Karakter mungkin sudah dibuat/.test(error.message));
 assert.equal(await real.evaluate(() => window.dispatches), 1);
 // Verify Agent-only tools fail within a short bounded wait rather than the 30s locator default.
 served = html;
 await page.goto('https://flow.google.com/project/offline-project');
 const started = Date.now();
 await assert.rejects(setAgentModeCompatible(page, true), /FLOW_AGENT_UNAVAILABLE/);
 assert.ok(Date.now() - started < 12000);
 // No generic Create fallback when a Characters page has no creation control.
 served = html.replace('<button id="new">Create character</button>', '<button id="new">Create</button>');
 await page.goto('https://flow.google.com/project/offline-project');
 await assert.rejects(prepareCharacterCreation(page, 'image'), /FLOW_CHARACTER_CREATION_UNAVAILABLE/);
 assert.equal(await real.evaluate(() => window.dispatches), 0);
 console.log('Flow UI fixtures: no-Agent create path, opaque editor id, preflight, partial failure, bounded unsupported controls: PASS; no Google requests.');
} finally {
 await electron?.close().catch(() => {});
 rmSync(scratch, { recursive: true, force: true });
}
