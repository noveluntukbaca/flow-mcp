import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export const OUTPUT_ROOT = resolve(process.env.FLOW_MCP_OUTPUT ?? join(homedir(), "flow-mcp-out"));

export function inside(file: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(file));
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

// Reject links at every component below the configured root, including dangling links
// and Windows junctions. Missing suffixes are allowed for destinations not created yet.
// Roots must also be real directories, not symlinks or junctions.
export function safePath(file: string, root: string): string {
  const target = resolve(file);
  const base = resolve(root);
  if (!inside(target, base)) throw new Error("Path must be inside its allowed root.");
  let current = base;
  let canonicalRoot: string | undefined;
  try {
    if (lstatSync(base).isSymbolicLink()) throw new Error("Symbolic links and junctions are not allowed as a root.");
    canonicalRoot = realpathSync(base);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  for (const part of relative(base, target).split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error("Symbolic links and junctions are not allowed inside this root.");
      if (canonicalRoot && !inside(realpathSync(current), canonicalRoot)) throw new Error("Path escapes its allowed root.");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return target;
}

export const outputPath = (file: string) => safePath(file, OUTPUT_ROOT);

export function projectName(project: string): string {
  // Reject path syntax before sanitizing: never silently turn traversal into a folder.
  if (!project.trim() || /[\\/:\x00-\x1f]/.test(project) || /[. ]$/.test(project)
      || /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(project)) {
    throw new Error("Invalid project folder name.");
  }
  const name = project.replace(/[^\w.-]+/g, "_");
  if (name === "." || name === "..") throw new Error("Invalid project folder name.");
  return name;
}

export const projectDir = (project: string) => outputPath(join(OUTPUT_ROOT, projectName(project)));
