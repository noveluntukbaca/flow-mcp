import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mockPage } from './fixtures/flow-ui/mock-page.mjs';
import { setAgentModeCompatible, prepareCharacterCreation, assertProject, projectRoot, FlowUiError } from '../dist/flow-ui.js';
const fixture = () => JSON.parse(readFileSync(new URL('./fixtures/flow-ui/current-project.json', import.meta.url)));
const fail = code => error => error instanceof FlowUiError && error.code === code;

test('character portrait can use known standard composer without Agent, ignoring hidden stale toggle', async () => {
  const page = mockPage(fixture());
  await setAgentModeCompatible(page, false);
  assert.deepEqual(page.clicks, []);
  await prepareCharacterCreation(page, 'image');
  assert.deepEqual(page.clicks, ['chars', 'new']);
  assert.ok(!page.clicks.includes('start'));
});
test('legacy Agent pressed toggle is switched off once, never used to submit', async () => {
  const f = fixture(); f.elements.push({ id: 'legacy', role: 'button', name: 'Agent', attrs: { 'aria-pressed': 'true' }, action: 'toggle' });
  const page = mockPage(f); await setAgentModeCompatible(page, false);
  assert.deepEqual(page.clicks, ['legacy']);
});
test('unknown Agent state fails without toggling or generating', async () => {
  const f = fixture(); f.elements.push({ id: 'agent', role: 'button', name: 'Agent' });
  const page = mockPage(f); await assert.rejects(setAgentModeCompatible(page, false), fail('FLOW_AGENT_STATE_UNKNOWN'));
  assert.deepEqual(page.clicks, []);
});
test('ambiguous visible Agent controls fail instead of choosing first', async () => {
  const f = fixture(); f.elements.push(...['a','b'].map(id => ({ id, role: 'button', name: 'Agent', attrs: { 'aria-pressed': 'false' } })));
  const page = mockPage(f); await assert.rejects(setAgentModeCompatible(page, false), fail('FLOW_UI_AMBIGUOUS'));
  assert.deepEqual(page.clicks, []);
});
test('description-only native form is not mistaken for navigation or a free generation', async () => {
  const f = fixture(); f.characters = [{ id: 'desc', role: 'textbox', name: 'Character description' }, { id: 'paid', role: 'button', name: 'Create character' }];
  const page = mockPage(f); await assert.rejects(prepareCharacterCreation(page, 'image'), fail('FLOW_CHARACTER_FORM_UNSUPPORTED'));
  assert.deepEqual(page.clicks, ['chars']);
});
test('project navigation redirect to login is detected before creation', async () => {
  const f = fixture(); f.elements[0].action = 'redirect';
  const page = mockPage(f); await assert.rejects(prepareCharacterCreation(page, 'image'), fail('FLOW_PROJECT_REQUIRED'));
  assert.deepEqual(page.clicks, ['chars']);
});
test('existing character editor is never treated as a new-character form', async () => {
  const f = fixture(); f.url += '/characters/existing-opaque-id';
  const page = mockPage(f); await assert.rejects(prepareCharacterCreation(page, 'image'), fail('FLOW_CHARACTER_EDITOR_OPEN'));
  assert.deepEqual(page.clicks, []);
});
test('project URLs accept real host/path boundaries and opaque ids, reject login and lookalikes', () => {
  assert.equal(projectRoot('https://flow.google.com/project/my-id/characters?hl=en'), 'https://flow.google.com/project/my-id');
  assert.equal(projectRoot('https://labs.google/fx/tools/flow/project/my-id/'), 'https://labs.google/fx/tools/flow/project/my-id');
  for (const url of ['https://flow.google.com.evil.test/project/id','https://accounts.google.com/project/id','https://flow.google.com/','http://flow.google.com/project/id','https://user@flow.google.com/project/id']) assert.throws(() => assertProject({ url: () => url }), fail('FLOW_PROJECT_REQUIRED'));
});

for (const scenario of [
  { title: 'missing Agent is rejected for Agent-only workflow', setup: f => f, run: page => setAgentModeCompatible(page, true), code: 'FLOW_AGENT_UNAVAILABLE' },
  { title: 'absence of Agent does not prove that an unknown composer is standard', setup: f => ({ ...f, elements: [f.elements[0]] }), run: page => setAgentModeCompatible(page, false), code: 'FLOW_COMPOSER_UNSUPPORTED' },
  { title: 'generic Create is never used as a character creation fallback', setup: f => ({ ...f, characters: [{ id: 'generic', role: 'button', name: 'Create' }] }), run: page => prepareCharacterCreation(page, 'image'), code: 'FLOW_CHARACTER_CREATION_UNAVAILABLE' },
  { title: 'missing Characters does not reload or navigate to a guessed route', setup: f => ({ ...f, elements: [] }), run: page => prepareCharacterCreation(page, 'image'), code: 'FLOW_CHARACTERS_UNAVAILABLE' },
]) {
  test(scenario.title, async t => {
    let clock = 0;
    t.mock.method(Date, 'now', () => clock += 1000);
    const page = mockPage(scenario.setup(fixture()));
    await assert.rejects(scenario.run(page), fail(scenario.code));
    assert.ok(!page.clicks.includes('start') && !page.clicks.includes('generic'));
    assert.ok(clock <= 15000, 'bounded capability detection, not repeated 30s waits');
  });
}

test('legacy empty state exposes upload directly without a new-character button', async () => {
  const f = fixture(); f.characters = [{ id: 'title', role: 'heading', name: 'New character' }, { id: 'upload', role: 'button', name: 'Upload' }];
  const page = mockPage(f); await prepareCharacterCreation(page, 'image');
  assert.deepEqual(page.clicks, ['chars']);
});
test('Indonesian character controls and project asset source are capability-detected', async () => {
  const f = fixture(); f.elements[0].name = 'Karakter'; f.characters[0].name = 'Buat karakter';
  f.creation[0].name = 'Buat karakter'; f.creation[1].name = 'Unggah gambar'; f.creation[2].name = 'Tambahkan dari proyek';
  const page = mockPage(f); await prepareCharacterCreation(page, 'asset');
  assert.deepEqual(page.clicks, ['chars', 'new']);
});
test('a disabled creation control is reported without trying another Create action', async () => {
  const f = fixture(); f.characters[0].disabled = true;
  const page = mockPage(f); await assert.rejects(prepareCharacterCreation(page, 'image'), fail('FLOW_CHARACTER_CREATE_BLOCKED'));
  assert.deepEqual(page.clicks, ['chars']);
});

test('an unnamed native form is not submitted just because its button says Create character', async () => {
  const f = fixture(); f.characters = [{ id: 'unnamed', role: 'textbox', name: '' }, { id: 'create', role: 'button', name: 'Create character', nativeForm: true }];
  const page = mockPage(f); await assert.rejects(prepareCharacterCreation(page, 'image'), fail('FLOW_CHARACTER_FORM_UNSUPPORTED'));
  assert.deepEqual(page.clicks, ['chars']);
});

test('Agent switch uses aria-checked state and toggles off once', async () => {
  const f = fixture(); f.elements.push({ id: 'switch', role: 'switch', name: 'Agent', attrs: { 'aria-checked': 'true' }, action: 'toggle' });
  const page = mockPage(f); await setAgentModeCompatible(page, false);
  assert.deepEqual(page.clicks, ['switch']);
});
