import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

import { unzipSync } from "fflate";
import { safePath } from "./paths.js";

// Everything that differs between macOS, Windows and Linux lives here, so the rest of the code stays the same on all
// three. macOS is the tested platform; the Windows and Linux branches are written to each system's own documented
// tools but have not been run on a real machine yet.
export const IS_MAC = process.platform === "darwin";
export const IS_WIN = process.platform === "win32";

// How the panel names this computer and its bin, so nothing says "Mac" on a PC.
export const COMPUTER = IS_MAC ? "this Mac" : IS_WIN ? "this PC" : "this computer";
export const BIN = IS_MAC ? "the Mac's Trash" : IS_WIN ? "the Recycle Bin" : "the Trash";

export const FFMPEG_HINT = IS_MAC ? "brew install ffmpeg" : IS_WIN ? "winget install Gyan.FFmpeg" : "sudo apt install ffmpeg";

// PowerShell single-quoted string: the only character that needs escaping is the quote itself.
export const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function powershell(script: string, timeout = 120_000): string {
  return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
}

// Puts a file or folder in the system's own bin so it can be restored: the Mac's Trash, Windows' Recycle Bin, or the
// freedesktop Trash on Linux. Never deletes anything outright.
export function moveToBin(target: string): string {
  if (IS_MAC) {
    const bin = join(homedir(), ".Trash");
    const name = basename(target);
    const ext = extname(name);
    const dest = existsSync(join(bin, name)) ? join(bin, `${name.slice(0, name.length - ext.length)}-${Date.now()}${ext}`) : join(bin, name);
    renameSync(target, dest);
    return dest;
  }
  if (IS_WIN) {
    const kind = statSync(target).isDirectory() ? "DeleteDirectory" : "DeleteFile";
    powershell(
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${kind}(${psQuote(target)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
    );
    return BIN;
  }
  try {
    execFileSync("gio", ["trash", target], { stdio: "ignore" });
    return BIN;
  } catch {
    const bin = join(homedir(), ".local", "share", "Trash", "files");
    mkdirSync(bin, { recursive: true });
    const dest = join(bin, `${basename(target)}-${Date.now()}`);
    renameSync(target, dest);
    return dest;
  }
}

// Decode ZIP entries as regular files rather than letting tar/unzip create archive-supplied links.
// Validate every entry before writing, and cap declared uncompressed sizes before decompression.
export function extractZip(zip: string, dest: string): string[] {
  if (statSync(zip).size > 512 * 1024 * 1024) throw new Error("ZIP exceeds the compressed size limit.");
  let total = 0, count = 0;
  const entries = unzipSync(readFileSync(zip), { filter(entry) {
    if (++count > 10_000) throw new Error("ZIP contains too many entries.");
    total += entry.originalSize;
    if (entry.originalSize > 512 * 1024 * 1024 || total > 1024 * 1024 * 1024) throw new Error("ZIP exceeds the extraction size limit.");
    return true;
  } });
  const base = resolve(dest);
  const paths = Object.entries(entries).map(([name, data]) => {
    if (name.includes("\\") || name.startsWith("/") || name.split("/").some((p) => p === "." || p === "..")) throw new Error("Unsafe ZIP entry path.");
    const directory = name.endsWith("/");
    const target = safePath(base, resolve(base, directory ? name.slice(0, -1) : name));
    return { target, data, directory };
  });
  mkdirSync(base, { recursive: true });
  const files: string[] = [];
  for (const { target, data, directory } of paths) {
    if (relative(base, target).split(sep).some((p) => p.startsWith(".") || p === "__MACOSX")) continue;
    safePath(base, target);
    if (directory) mkdirSync(target, { recursive: true });
    else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(safePath(base, target), data, { flag: "wx" });
      files.push(target);
    }
  }
  return files;
}

// Opens a page in the default browser.
export function openUrl(url: string): void {
  try {
    if (IS_MAC) execFileSync("open", [url], { stdio: "ignore" });
    else if (IS_WIN) execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
    else execFileSync("xdg-open", [url], { stdio: "ignore" });
  } catch {
    // Opening the browser is a convenience; the address is printed either way.
  }
}
