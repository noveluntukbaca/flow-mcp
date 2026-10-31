import { createHash } from "node:crypto";

// Existing Studio uses inline scripts. Hash the parsed script text rather than enabling all inline JS.
export function studioCsp(html: string): string {
  // HTML parsing normalizes CRLF/CR to LF before Chromium checks a CSP hash.
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)]
    .map(match => `'sha256-${createHash("sha256").update(match[1].replace(/\r\n?/g, "\n")).digest("base64")}'`);
  return ["default-src 'none'", `script-src ${scripts.join(" ") || "'none'"}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:",
    "font-src 'self'", "connect-src 'self'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; ');
}
