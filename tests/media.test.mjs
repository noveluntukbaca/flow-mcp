import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'flow media ü '));
process.env.FLOW_MCP_OUTPUT = join(dir, 'output');
process.env.FLOW_MCP_HOME = join(dir, 'home');
const { assemble } = await import('../dist/assemble.js');
const { extractLastFrame } = await import('../dist/chain.js');
let available = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); }
catch { available = false; }
after(() => rmSync(dir, { recursive: true, force: true }));
test('FFmpeg assembles external synthetic inputs and extracts output frame without Google', { skip: available ? false : 'FFmpeg/ffprobe not installed (optional media integration)', timeout: 30_000 }, async () => {
  const project = join(process.env.FLOW_MCP_OUTPUT, 'synthetic'); mkdirSync(project, { recursive: true });
  // External user-selected inputs remain allowed; only generated outputs are contained.
  const clip = join(dir, 'input clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=24:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip]);
  const result = await assemble({ dir: project, clips: [clip, clip], output_name: 'offline film', music_volume: 0.2 });
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', result.output], { encoding: 'utf8' }));
  assert.ok(Math.abs(Number(probe.format.duration) - 2) < 0.2);
  assert.ok(probe.streams.some(s => s.codec_type === 'video')); assert.ok(probe.streams.some(s => s.codec_type === 'audio'));
  assert.ok(statSync(await extractLastFrame(result.output)).size > 0);
});
