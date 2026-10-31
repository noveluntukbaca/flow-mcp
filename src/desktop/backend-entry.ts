import { LocalCore } from "../core.js";
import { startDesktopBackend } from "./backend.js";

// Electron utilityProcess supplies only a private parent channel; it exposes no renderer IPC.
const parent = (process as typeof process & {
  parentPort: { postMessage(value: unknown): void; on(event: "message", handler: (event: { data: unknown }) => void): void };
}).parentPort;
const core = new LocalCore();
try {
  const backend = await startDesktopBackend(core, () => core.busy);
  parent.on("message", async ({ data }) => {
    if (data !== "stop") return;
    try {
      const stopped = await backend.stop();
      parent.postMessage({ type: stopped ? "stopped" : "busy" });
      if (stopped) process.exit(0);
    } catch { parent.postMessage({ type: "stop-error" }); }
  });
  parent.postMessage({ type: "ready", role: backend.role });
} catch {
  parent.postMessage({ type: "error" });
  process.exit(1);
}
