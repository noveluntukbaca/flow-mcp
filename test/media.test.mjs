import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const scratch = mkdtempSync(join(tmpdir(), 'flow media ü '));
process.env.FLOW_MCP_OUTPUT = scratch;
const { assemble } = await import('../dist/assemble.js');
const { extractLastFrame } = await import('../dist/chain.js');
after(() => rmSync(scratch, { recursive: true, force: true }));
const ffmpeg = process.env.FLOW_MCP_FFMPEG ?? 'ffmpeg';
const ffprobe = process.env.FLOW_MCP_FFPROBE ?? 'ffprobe';
const available = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync(ffprobe, ['-version']).status === 0;
test('local synthetic clips assemble with audio and final-frame extraction', { skip: !available && 'Optional FFmpeg/ffprobe not installed' }, async () => {
  const dir = join(scratch, 'Film with spaces'); mkdirSync(dir);
  const clips = ['red', 'blue'].map((color, i) => {
    const file = join(dir, `scene-0${i + 1}.mp4`);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=160x90:r=24:d=1`, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    return file;
  });
  const result = await assemble({ dir, output_name: 'final', clips, clip_volume: 1 });
  assert.ok(existsSync(result.output));
  const info = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_format", "-show_streams", "-of", "json", result.output], { encoding: "utf8" }));
  assert.ok(Number(info.format.duration) >= 1.9 && Number(info.format.duration) < 2.2);
  assert.ok(info.streams.some(s => s.codec_type === "audio"));
  assert.ok(existsSync(await extractLastFrame(clips[0])));
});
