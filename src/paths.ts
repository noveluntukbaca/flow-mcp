import { constants, closeSync, fstatSync, lstatSync, openSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

export const OUTPUT_ROOT = process.env.FLOW_MCP_OUTPUT ?? join(homedir(), "flow-mcp-out");
const RESERVED = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$|clock\$)[ .]*(?:\.|$)/i;

// Validate before legacy sanitization: never turn a path, device name or ADS into a project name.
export function portableName(name: string): string {
  if (!name || name === "." || name === ".." || name !== name.trim() || /[. ]$/.test(name) ||
      /[<>:"/\\|?*\x00-\x1f\x7f]/.test(name) || RESERVED.test(name) || Buffer.byteLength(name, "utf8") > 240) {
    throw new Error("Invalid file or project name: use a single name without paths, Windows device names, or trailing dots/spaces.");
  }
  return name;
}

// Keep existing project/file naming for valid inputs, including names with spaces.
export const localName = (name: string): string => portableName(portableName(name).replace(/[^\w.-]+/g, "_"));
const below = (root: string, file: string): boolean => {
  const rel = relative(root, file);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};

function canonical(path: string): string {
  try { return realpathSync.native(path); }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // A dangling link is not a missing output that can safely be created.
    try { if (lstatSync(path).isSymbolicLink()) throw new Error("Symbolic links and junctions are not allowed here."); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const parent = dirname(path);
    if (parent === path) throw err;
    return join(canonical(parent), parse(path).base);
  }
}

// The configured root is trusted and may itself be relocated by a symlink. Descendants may not be links,
// including Windows junctions, even when they currently point inside the root. Missing write targets are OK.
export function safePath(root: string, file: string): string {
  if (!file || file.includes("\0") || !isAbsolute(file)) throw new Error("An absolute local path is required.");
  if (file.split(/[\\/]/).some((part) => part === "." || part === "..")) throw new Error("Dot path segments are not allowed.");
  const base = resolve(root), target = resolve(file);
  if (!below(base, target)) throw new Error("Path must stay inside its allowed folder.");
  let cursor = base;
  for (const part of relative(base, target).split(sep)) {
    portableName(part);
    cursor = join(cursor, part);
    try {
      const entry = lstatSync(cursor);
      if (entry.isSymbolicLink()) throw new Error("Symbolic links and junctions are not allowed here.");
      if (entry.isFile() && entry.nlink > 1) throw new Error("Hard-linked files are not allowed here.");
    } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
  }
  if (!below(canonical(base), canonical(target))) throw new Error("Resolved path leaves its allowed folder.");
  return target;
}

export const projectPath = (project: string): string => safePath(OUTPUT_ROOT, resolve(OUTPUT_ROOT, localName(project)));
export const outputPath = (file: string): string => safePath(OUTPUT_ROOT, file);
export const outputDirectory = (dir: string): string => resolve(dir) === resolve(OUTPUT_ROOT) ? resolve(OUTPUT_ROOT) : outputPath(dir);

// Stream the descriptor we checked rather than reopening a user-controlled path after validating it.
export function openMedia(file: string, roots: string[]): { fd: number; size: number } {
  for (const root of roots) {
    let fd: number | undefined;
    try {
      const path = safePath(root, file);
      const before = lstatSync(path);
      if (!before.isFile()) throw new Error("Not a regular file.");
      fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = fstatSync(fd);
      safePath(root, path);
      const after = lstatSync(path);
      if (!opened.isFile() || before.dev !== opened.dev || before.ino !== opened.ino || after.dev !== opened.dev || after.ino !== opened.ino) {
        throw new Error("File changed while opening.");
      }
      return { fd, size: opened.size };
    } catch { if (fd !== undefined) closeSync(fd); }
  }
  throw new Error("Not found.");
}
