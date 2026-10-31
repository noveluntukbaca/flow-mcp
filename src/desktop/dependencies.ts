import { execFile } from "node:child_process";
import { chromeExecutable } from "../chrome.js";

export type Checks = { chrome: boolean; ffmpeg: boolean; ffprobe: boolean };
function available(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(command, ["-version"], { timeout: 4000, windowsHide: true, maxBuffer: 64 * 1024 }, (error) => resolve(!error));
  });
}
export async function checkDependencies(): Promise<Checks> {
  let chrome = false;
  try { chromeExecutable(); chrome = true; } catch { /* Missing Chrome is shown in Indonesian by the startup UI. */ }
  const [ffmpeg, ffprobe] = await Promise.all([
    available(process.env.FLOW_MCP_FFMPEG ?? "ffmpeg"),
    available(process.env.FLOW_MCP_FFPROBE ?? "ffprobe"),
  ]);
  return { chrome, ffmpeg, ffprobe };
}
