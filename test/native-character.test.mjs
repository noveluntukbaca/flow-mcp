import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CharacterStore, characterKey } from '../dist/character-store.js';
import { characterPrompt, characterFingerprint, parseCharacterQuote } from '../dist/native-character.js';
const scratch = mkdtempSync(join(tmpdir(), 'flow-native-store ü '));
after(() => rmSync(scratch, { recursive: true, force: true }));
const project = 'https://flow.google.com/project/local';
test('native prompt maps description/personality, keeps name and voice local', () => {
  const input = { name: 'LOCAL_NAME', describe: '  A red fox  ', personality: ' Curious and patient ', voice: 'LOCAL_VOICE' };
  assert.equal(characterPrompt(input), 'A red fox\n\nPersonality: Curious and patient');
  assert.ok(!characterPrompt(input).includes('LOCAL_'));
  assert.match(characterPrompt({ name: 'Image', image: 'asset:Reference' }), /attached reference image/);
});
test('quote parser accepts explicit nonnegative integer credit amounts, rejects balances/unknown/decimals', () => {
  assert.equal(parseCharacterQuote('0 credits'), 0); assert.equal(parseCharacterQuote('Cost: 20 credits'), 20);
  for (const text of ['999 credits remaining','Free','Price unavailable','-1 credits','1.5 credits','20 credits per second','1,000 credits','20–30 credits']) assert.equal(parseCharacterQuote(text), undefined, text);
});
test('fingerprint binds creative inputs and image bytes, not confirmation token or credit ceiling', () => {
  const path = join(scratch, 'ref.png'); writeFileSync(path, 'first');
  const a = { name: 'Ref', image: path, describe: 'fox' }; const first = characterFingerprint(a);
  assert.equal(first, characterFingerprint({ ...a, max_credits: 20, confirmation_token: 'temporary' }));
  assert.notEqual(first, characterFingerprint({ ...a, personality: 'quiet' }));
  assert.notEqual(first, characterFingerprint({ ...a, voice: 'Charon' }));
  writeFileSync(path, 'second'); assert.notEqual(first, characterFingerprint(a));
});
test('durable submit ledger blocks an unverified reference after simulated restart', () => {
  const home = join(scratch, 'ledger'); const store = new CharacterStore(home);
  const row = { project, name: 'Local Hero', fingerprint: 'abc', prompt: 'fox', state: 'submitted', created: new Date().toISOString() };
  store.save(row);
  const restarted = new CharacterStore(home);
  assert.equal(restarted.get(project, ' local hero ').state, 'submitted');
  assert.throws(() => restarted.resolve(project, 'LOCAL HERO'), /FLOW_CHARACTER_UNCERTAIN/);
  assert.equal(restarted.resolve('https://flow.google.com/project/other', 'Local Hero'), 'Local Hero');
  store.save({ ...row, state: 'ready', flow_id: 'native-id', flow_name: 'Native Title', voice: 'local-only', url: project+'/characters/native-id' });
  assert.equal(restarted.resolve(project, 'LOCAL HERO'), 'Native Title');
  assert.equal(restarted.list(project)[0].voice, 'local-only');
  assert.notEqual(characterKey(project, 'hero'), characterKey('https://flow.google.com/project/other', 'hero'));
});
test('corrupt ledger fails closed instead of erasing an uncertain submission', () => {
  const store = new CharacterStore(join(scratch, 'corrupt'));
  store.list(project); writeFileSync(join(scratch, 'corrupt', 'native-characters.json'), '{broken');
  assert.throws(() => store.get(project, 'Name'), /FLOW_CHARACTER_STORE/);
});

test('attachment guard persists after restart and only verified staging can be cleared', () => {
  const store = new CharacterStore(join(scratch,'attachment'));
  const row = {project,name:'Image',prompt:'fox',fingerprint:'one',state:'attachment',created:new Date().toISOString()};
  store.save(row); assert.equal(new CharacterStore(join(scratch,'attachment')).get(project,'Image').state,'attachment');
  assert.throws(() => store.clearAttachment(project,'Image','wrong'),/mismatch/);
  store.clearAttachment(project,'Image','one'); assert.equal(store.get(project,'Image'),undefined);
});
test('a ready identity with missing remote proof is rejected on the next read', () => {
  const store = new CharacterStore(join(scratch,'invalid-ready'));
  store.save({project,name:'Unknown',prompt:'fox',fingerprint:'one',state:'ready',created:new Date().toISOString()});
  assert.throws(() => store.list(project),/FLOW_CHARACTER_STORE/);
});
