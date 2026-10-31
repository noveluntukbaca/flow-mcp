import type { Server } from "node:http";
import type { Core } from "../core.js";
import { PORT, startServer, type ServerRole } from "../server.js";
import { studioOrigin } from "./policy.js";

// Only this controller owns the server it created. An existing MCP owner is never stopped.
export async function startDesktopBackend(core: Core, busy: () => boolean) {
  const origin = studioOrigin(PORT);
  let owned: Server | undefined;
  let active = 0;
  let requests = 0;
  const tracked = new Proxy(core, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        active++;
        try { return await value.apply(target, args); } finally { active--; }
      };
    },
  });
  const role: ServerRole = await startServer(tracked, { onOwner: (server) => {
    owned = server;
    server.prependListener("request", (_req, res) => {
      requests++;
      let finished = false;
      const done = () => { if (!finished) { finished = true; requests--; } };
      res.once("finish", done); res.once("close", done);
    });
  } });
  if (role === "none") throw new Error("PORT_IN_USE");
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000), redirect: "error" });
    if (!response.ok || (await response.json() as { name?: string }).name !== "flow-mcp") throw new Error("BACKEND_UNAVAILABLE");
  } catch (error) {
    owned?.close();
    owned?.closeAllConnections();
    throw error;
  }
  return {
    role,
    async stop(): Promise<boolean> {
      // Include HTTP uploads/media and long Core calls; don't interrupt paid/ambiguous operations.
      if (owned && (active || requests || busy())) return false;
      if (owned) {
        await new Promise<void>((resolve, reject) => {
          owned!.close(error => error ? reject(error) : resolve());
          owned!.closeIdleConnections();
        });
        owned = undefined;
      }
      return true;
    },
  };
}
