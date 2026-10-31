import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const scratch = mkdtempSync(join(tmpdir(), 'flow security ü '));
process.env.FLOW_MCP_OUTPUT = join(scratch, 'films');
process.env.FLOW_MCP_HOME = join(scratch, 'home');
const { OUTPUT_ROOT, projectDir, safePath, inside } = await import('../dist/paths.js');
const { LocalCore, shapes } = await import('../dist/core.js');
mkdirSync(OUTPUT_ROOT);
const outside = join(scratch, 'outside');
mkdirSync(outside);
writeFileSync(join(outside, 'sentinel.mp4'), 'untouched');
after(() => rmSync(scratch, { recursive: true, force: true }));

for (const name of ['', ' ', '.', '..', '../escape', '..\\escape', '/tmp', 'C:\\escape', 'C:escape', '\\\\server\\share', 'NUL', 'con.txt', 'COM1', 'lpt9.mp4', 'COM¹', 'trailing.', 'trailing ', 'bad\0name']) {
  test(`project rejects ${JSON.stringify(name)} before filesystem work`, () => {
    assert.throws(() => projectDir(name));
    assert.equal(z.object(shapes.generate).safeParse({ project: name, scenes: [{ prompt: 'x' }] }).success, false);
  });
}
test('safe legacy names and sanitized spaces/Unicode stay within output', () => {
  assert.equal(projectDir('HotelPromo'), join(OUTPUT_ROOT, 'HotelPromo'));
  assert.equal(projectDir('Film Indonesia ü'), join(OUTPUT_ROOT, 'Film_Indonesia_'));
  assert.ok(inside(projectDir('..hidden'), OUTPUT_ROOT));
  assert.throws(() => safePath(OUTPUT_ROOT, OUTPUT_ROOT));
  assert.throws(() => safePath(join(scratch, 'films-other', 'x'), OUTPUT_ROOT));
  assert.throws(() => safePath(resolve(OUTPUT_ROOT, '..', 'outside'), OUTPUT_ROOT));
  assert.equal(safePath(join(OUTPUT_ROOT, 'new', 'child.mp4'), OUTPUT_ROOT), join(OUTPUT_ROOT, 'new', 'child.mp4'));
});

test('directory symlink / Windows junction rejects project, nested file, listing, discard and captions', async () => {
  const link = join(OUTPUT_ROOT, 'linked');
  symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => projectDir('linked'), /links|junctions/);
  assert.throws(() => safePath(join(link, 'new.mp4'), OUTPUT_ROOT), /links|junctions/);
  const core = new LocalCore();
  await assert.rejects(core.discard({ path: join(link, 'sentinel.mp4') }), /links|junctions/);
  await assert.rejects(core.captions({ video: join(link, 'sentinel.mp4') }), /links|junctions/);
  const outputs = await core.outputs();
  assert.equal(outputs.projects.length, 0);
  assert.equal(readFileSync(join(outside, 'sentinel.mp4'), 'utf8'), 'untouched');
});

test('file links, dangling links and existing output overwrite links are rejected', async t => {
  // Windows directory junctions above require no symlink privilege; file links may.
  const folder = projectDir('Normal');
  mkdirSync(folder);
  try {
    symlinkSync(join(outside, 'sentinel.mp4'), join(folder, 'final.mp4'), 'file');
    symlinkSync(join(outside, 'missing.mp4'), join(folder, 'dangling.mp4'), 'file');
  } catch (err) {
    if (process.platform === 'win32' && err.code === 'EPERM') return t.skip('File symlink privilege unavailable; junction regression still runs.');
    throw err;
  }
  assert.throws(() => safePath(join(folder, 'final.mp4'), OUTPUT_ROOT));
  assert.throws(() => safePath(join(folder, 'dangling.mp4'), OUTPUT_ROOT));
  const { assemble } = await import('../dist/assemble.js');
  await assert.rejects(assemble({ dir: folder, output_name: 'final', clips: ['unused'] }), /links|junctions/);
  const { burnCaptions } = await import('../dist/captions.js');
  await assert.rejects(burnCaptions('unused', {}, join(folder, 'final.mp4')), /links|junctions/);
  const { extractLastFrame } = await import('../dist/chain.js');
  symlinkSync(join(outside, 'sentinel.mp4'), join(folder, 'clip-lastframe.jpg'), 'file');
  await assert.rejects(extractLastFrame(join(folder, 'clip.mp4')), /links|junctions/);
  assert.equal(readFileSync(join(outside, 'sentinel.mp4'), 'utf8'), 'untouched');
});

test('a linked allowed root is also refused', () => {
  const root = join(scratch, 'linked-root');
  symlinkSync(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => safePath(join(root, 'sentinel.mp4'), root), /links|junctions/);
});
