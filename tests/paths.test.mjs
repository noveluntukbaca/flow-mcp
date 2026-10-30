import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, linkSync, existsSync, rmSync, closeSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
const base = mkdtempSync(join(tmpdir(), 'flow paths ü '));
process.env.FLOW_MCP_OUTPUT = join(base, 'output');
process.env.FLOW_MCP_HOME = join(base, 'home');
const { projectDir, LocalCore } = await import('../dist/core.js');
const { safePath, outputPath, openMedia, localName } = await import('../dist/paths.js');
const { assemble, speakLocally, voiceTrack } = await import('../dist/assemble.js');
const { captionedName, burnCaptions } = await import('../dist/captions.js');
const { extractLastFrame } = await import('../dist/chain.js');
const { extractZip } = await import('../dist/platform.js');
mkdirSync(process.env.FLOW_MCP_OUTPUT); mkdirSync(process.env.FLOW_MCP_HOME);
after(() => rmSync(base, { recursive: true, force: true }));
for (const name of ['..', '.', '', '../outside', '..\\outside', '/tmp/escape', 'C:\\escape', 'C:relative', '\\\\server\\share', 'name:stream', 'CON', 'CON .txt', 'con.txt', 'NUL', 'COM1.mp4', 'LPT9', 'COM¹', 'LPT².txt', 'CONIN$', 'CONOUT$', 'CLOCK$', 'bad.', 'bad ', ' bad', 'bad\0name', 'bad\nname', 'a?b', 'a*b', 'a|b', 'a<b', 'a>b', 'a"b', 'x'.repeat(241)]) {
  test(`reject invalid portable project ${JSON.stringify(name)}`, () => assert.throws(() => projectDir(name), /Invalid/));
}
test('valid names keep legacy project mapping without traversing', () => {
  assert.equal(projectDir('Hotel Promo'), join(process.env.FLOW_MCP_OUTPUT, 'Hotel_Promo'));
  assert.equal(projectDir('..draft'), join(process.env.FLOW_MCP_OUTPUT, '..draft'));
  assert.equal(localName('Kota indah'), 'Kota_indah');
  assert.equal(localName('東京'), '_');
});
test('output root and sibling-prefix escapes are rejected', () => {
  assert.throws(() => outputPath(process.env.FLOW_MCP_OUTPUT));
  assert.throws(() => outputPath(join(base, 'output-other', 'file')));
  assert.throws(() => outputPath('relative.mp4'));
  assert.throws(() => outputPath(process.env.FLOW_MCP_OUTPUT + '/gallery/../normal.mp4'), /Dot path/);
});
const external = join(base, 'outside'); mkdirSync(external); writeFileSync(join(external, 'secret.mp4'), 'sentinel');
const link = join(process.env.FLOW_MCP_OUTPUT, 'linked');
symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
test('project symlink/junction and children cannot escape output root', () => {
  assert.throws(() => projectDir('linked'), /links|junctions/);
  assert.throws(() => outputPath(join(link, 'new.mp4')), /links|junctions/);
  assert.throws(() => openMedia(join(link, 'secret.mp4'), [process.env.FLOW_MCP_OUTPUT]));
});
test('discard through symlink/junction refuses before touching sentinel', async () => {
  await assert.rejects(new LocalCore().discard({ path: join(link, 'secret.mp4') }));
  await assert.rejects(new LocalCore().discard({ path: link }));
  assert.equal(readFileSync(join(external, 'secret.mp4'), 'utf8'), 'sentinel');
});
test('caption/assembly/voice/frame output guards run before external tools', async () => {
  const unsafe = join(link, 'film.mp4');
  await assert.rejects(assemble({ dir: link, output_name: 'film', clips: [], music_volume: 0 }));
  await assert.rejects(assemble({ dir: process.env.FLOW_MCP_OUTPUT, output_name: 'CON', clips: [], music_volume: 0 }));
  await assert.rejects(speakLocally('hello', 'unused', unsafe));
  await assert.rejects(voiceTrack([], unsafe));
  await assert.rejects(extractLastFrame(join(link, 'secret.mp4')));
  await assert.rejects(burnCaptions('unused.mp4', {}, unsafe));
  assert.throws(() => captionedName(link, 'source.mp4'));
  assert.equal(existsSync(join(external, 'film.mp4')), false);
});
test('gallery excludes file symlinks and outside directories', async () => {
  const project = projectDir('gallery'); mkdirSync(project);
  writeFileSync(join(project, 'ok.mp4'), 'valid');
  symlinkSync(external, join(project, 'folder'), process.platform === 'win32' ? 'junction' : 'dir');
  // Directory entries with a media suffix are not videos either.
  mkdirSync(join(project, 'not-video.mp4'));
  if (process.platform !== 'win32') symlinkSync(join(external, 'secret.mp4'), join(project, 'leak.mp4'));
  const result = await new LocalCore().outputs();
  assert.deepEqual(result.projects.map(p => p.name), ['gallery']);
  assert.deepEqual(result.projects[0].files.map(f => f.name), ['ok.mp4']);
});
test('normal file opens as a checked descriptor; directories are rejected', () => {
  const file = join(process.env.FLOW_MCP_OUTPUT, 'normal.mp4'); writeFileSync(file, 'abc');
  const media = openMedia(file, [process.env.FLOW_MCP_OUTPUT]);
  try { assert.equal(media.size, 3); assert.equal(readFileSync(media.fd, 'utf8'), 'abc'); } finally { closeSync(media.fd); }
  assert.throws(() => openMedia(external, [process.env.FLOW_MCP_OUTPUT]));
});
test('dangling and in-root file symlinks are rejected on POSIX', { skip: process.platform === 'win32' ? 'File symlink requires Windows Developer Mode; junction cases remain mandatory' : false }, () => {
  const dangling = join(process.env.FLOW_MCP_OUTPUT, 'dangling.mp4'); symlinkSync(join(external, 'missing'), dangling);
  assert.throws(() => outputPath(dangling));
  const internal = join(process.env.FLOW_MCP_OUTPUT, 'alias.mp4'); symlinkSync(join(process.env.FLOW_MCP_OUTPUT, 'normal.mp4'), internal);
  assert.throws(() => openMedia(internal, [process.env.FLOW_MCP_OUTPUT]));
});
test('configured root can be a trusted relocation link', () => {
  const alias = join(base, 'root-alias'); symlinkSync(process.env.FLOW_MCP_OUTPUT, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(safePath(alias, join(alias, 'normal.mp4')), resolve(alias, 'normal.mp4'));
});
for (const entry of ['../escape.txt', '/escape.txt', 'C:/escape.txt', 'dir/../../escape.txt', 'dir\\escape.txt', 'NUL.txt']) {
  test(`ZIP rejects unsafe entry ${entry} before writing`, () => {
    const zip = join(base, 'bad.zip'); writeFileSync(zip, zipSync({ [entry]: strToU8('bad') }));
    const dest = join(base, 'extract-bad'); assert.throws(() => extractZip(zip, dest));
    assert.equal(existsSync(dest), false);
  });
}
test('ZIP extracts nested regular files and refuses existing junction destinations', () => {
  const zip = join(base, 'good.zip'); writeFileSync(zip, zipSync({ 'nested/clip.txt': strToU8('clip') }));
  const dest = join(base, 'extract-good');
  assert.deepEqual(extractZip(zip, dest), [join(dest, 'nested', 'clip.txt')]);
  assert.equal(readFileSync(join(dest, 'nested', 'clip.txt'), 'utf8'), 'clip');
  assert.throws(() => extractZip(zip, dest)); // exclusive writes do not overwrite user files
  const other = join(base, 'extract-link'); mkdirSync(other); symlinkSync(external, join(other, 'nested'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => extractZip(zip, other));
  assert.equal(existsSync(join(external, 'clip.txt')), false);
});

test('hardlinks cannot leak media, overwrite outputs or be discarded', async () => {
  const hardlink = join(process.env.FLOW_MCP_OUTPUT, 'hardlink.mp4');
  linkSync(join(external, 'secret.mp4'), hardlink);
  assert.throws(() => outputPath(hardlink), /Hard-linked/);
  assert.throws(() => openMedia(hardlink, [process.env.FLOW_MCP_OUTPUT]));
  await assert.rejects(new LocalCore().discard({ path: hardlink }));
  assert.equal(readFileSync(join(external, 'secret.mp4'), 'utf8'), 'sentinel');
});
test('invalid continuation project is rejected before Flow lookup', async () => {
  await assert.rejects(new LocalCore().continue_shot({ project: '..', from_asset: 'unused', prompt: 'unused' }), /Invalid/);
});
test('ZIP rejects oversized declared output before allocating it', () => {
  const zip = join(base, 'large.zip');
  const bytes = Buffer.from(zipSync({ 'big.txt': strToU8('small') }));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(600 * 1024 * 1024, central + 24);
  writeFileSync(zip, bytes);
  assert.throws(() => extractZip(zip, join(base, 'large-extract')), /size limit/);
});
test('state metadata refuses symlink to external file', { skip: process.platform === 'win32' ? 'Requires Developer Mode; directory junctions tested separately' : false }, async () => {
  const { rememberCharacter } = await import('../dist/flow.js');
  const target = join(process.env.FLOW_MCP_HOME, 'characters.json');
  symlinkSync(join(external, 'secret.mp4'), target);
  assert.throws(() => rememberCharacter('offline', 'test'));
  assert.equal(readFileSync(join(external, 'secret.mp4'), 'utf8'), 'sentinel');
});

test('ZIP Unix symlink attributes are materialized only as regular file data', () => {
  const zip = join(base, 'unix-link.zip');
  const bytes = Buffer.from(zipSync({ 'link.txt': strToU8('../../outside/secret.mp4') }));
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt16LE(0x0314, central + 4); // made by Unix
  bytes.writeUInt32LE(0xa1ff0000, central + 38); // symlink attributes
  writeFileSync(zip, bytes);
  const dest = join(base, 'unix-link-extract'); extractZip(zip, dest);
  assert.equal(lstatSync(join(dest, 'link.txt')).isSymbolicLink(), false);
  assert.equal(readFileSync(join(dest, 'link.txt'), 'utf8'), '../../outside/secret.mp4');
});
