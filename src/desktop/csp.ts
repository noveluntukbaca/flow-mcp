import { createHash } from "node:crypto";

// Existing Studio uses inline scripts. Hash the served bytes rather than enabling all inline JS.
export function studioCsp(html: string): string {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(match => `'sha256-${createHash("sha256").update(match[1]).digest("base64")}'`);
  return ["default-src 'none'", `script-src ${scripts.join(" ") || "'none'"}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
}
