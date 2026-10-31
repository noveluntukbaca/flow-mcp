// Pure policy shared by the launcher and offline tests. Never accept a URL from IPC.
export const desktopPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
} as const;

export function studioOrigin(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FLOW_MCP_PORT harus berupa angka 1–65535.");
  return `http://127.0.0.1:${port}`;
}

export function allowedRequest(raw: string, origin: string, startupUrl?: string): boolean {
  try {
    if (startupUrl && raw === startupUrl) return true;
    const url = new URL(raw);
    return !url.username && !url.password && (url.origin === origin || url.protocol === "data:" || url.protocol === "blob:" && url.origin === origin);
  } catch { return false; }
}

// External links require a main-process confirmation and an exact allowlisted HTTPS URL.
export function allowedExternal(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.href === "https://aistudio.google.com/apikey";
  } catch { return false; }
}
