import { app, BrowserWindow, dialog, ipcMain, session, shell, utilityProcess, type UtilityProcess } from "electron";
import { fileURLToPath } from "node:url";
import { studioCsp } from "./csp.js";
import { checkDependencies } from "./dependencies.js";
import { allowedExternal, allowedRequest, desktopPreferences, studioOrigin } from "./policy.js";

const startupUrl = new URL("../../desktop/startup.html", import.meta.url).href;
const preload = fileURLToPath(new URL("../../desktop/preload.cjs", import.meta.url));
let startup: BrowserWindow | undefined;
let studio: BrowserWindow | undefined;
let backend: UtilityProcess | undefined;
let starting = false;
let stopping = false;
let quitting = false;
let origin: string;

function startupSender(event: Electron.IpcMainInvokeEvent) {
  if (!startup || event.sender !== startup.webContents || event.senderFrame !== startup.webContents.mainFrame || event.senderFrame.url !== startupUrl) {
    throw new Error("Permintaan desktop ditolak.");
  }
}

function secureWindow(window: BrowserWindow, target: string) {
  const contents = window.webContents;
  contents.on("will-navigate", (event, url) => { if (url !== target) event.preventDefault(); });
  contents.on("will-redirect", (event) => event.preventDefault());
  contents.on("will-attach-webview", event => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal(url)) {
      void dialog.showMessageBox(window, {
        type: "question", buttons: ["Batal", "Buka di browser"], defaultId: 0, cancelId: 0,
        message: "Buka halaman kunci API Google AI Studio di browser eksternal?",
        detail: "Kunci API bersifat pribadi. Jangan bagikan kepada orang lain.",
      }).then(({ response }) => { if (response === 1) void shell.openExternal(url).catch(() => {}); });
    }
    return { action: "deny" };
  });
  window.on("close", event => {
    if (quitting) return;
    event.preventDefault();
    void stopAndQuit(window);
  });
}

function showStartup() {
  startup = new BrowserWindow({ width: 860, height: 760, minWidth: 640, minHeight: 600, title: "Flow MCP Studio", autoHideMenuBar: true,
    webPreferences: { ...desktopPreferences, preload, partition: "flow-desktop-startup" } });
  secureWindow(startup, startupUrl);
  startup.on("closed", () => { startup = undefined; });
  void startup.loadURL(startupUrl);
}

async function stopAndQuit(window: BrowserWindow) {
  if (stopping) return;
  if (starting) {
    await dialog.showMessageBox(window, { type: "info", message: "Backend sedang disiapkan. Tunggu hingga proses selesai, lalu tutup aplikasi." });
    return;
  }
  if (!backend) { quitting = true; app.quit(); return; }
  stopping = true;
  const child = backend;
  const result = await new Promise<string>(resolve => {
    const timer = setTimeout(() => done("timeout"), 8000);
    const onMessage = (message: { type?: string }) => {
      if (["stopped", "busy", "stop-error"].includes(message?.type ?? "")) done(message.type!);
    };
    const onExit = () => done("stopped");
    function done(value: string) {
      clearTimeout(timer); child.removeListener("message", onMessage); child.removeListener("exit", onExit); resolve(value);
    }
    child.on("message", onMessage); child.once("exit", onExit); child.postMessage("stop");
  });
  stopping = false;
  if (result === "stopped") { quitting = true; backend = undefined; app.quit(); }
  else await dialog.showMessageBox(window, { type: "info", message: result === "busy"
    ? "Pekerjaan atau permintaan masih berlangsung. Tunggu hingga selesai, lalu tutup kembali."
    : "Backend belum dapat dihentikan dengan aman. Tunggu lalu coba tutup kembali.",
    detail: "Aplikasi tidak menghentikan paksa pekerjaan dan tidak mengulang generasi otomatis." });
}

async function launch() {
  if (starting || studio) return { error: "Studio sedang dibuka atau sudah terbuka." };
  starting = true;
  try {
    if (!(await checkDependencies()).chrome) return { error: "Google Chrome belum ditemukan. Periksa kembali dependensi." };
    await new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(fileURLToPath(new URL("./backend-entry.js", import.meta.url)), [], { serviceName: "Flow Studio Backend", stdio: "ignore" });
      backend = child;
      const timer = setTimeout(() => { child.kill(); reject(new Error("START_TIMEOUT")); }, 50_000);
      child.on("message", (message: { type?: string }) => {
        if (message?.type === "ready") { clearTimeout(timer); resolve(); }
        if (message?.type === "error") { clearTimeout(timer); reject(new Error("START_FAILED")); }
      });
      child.once("exit", () => {
        clearTimeout(timer);
        if (backend === child) backend = undefined;
        reject(new Error("BACKEND_EXIT"));
        if (studio && !quitting && !stopping) {
          void dialog.showMessageBox({ type: "error", message: "Backend berhenti. Tutup lalu buka ulang aplikasi.", detail: "Jangan ulangi generasi sebelum memeriksa hasil di Chrome; pekerjaan mungkin sudah memakai kredit." });
          // No polling/reconnect after an ambiguous backend crash.
          showStartup();
          studio?.destroy(); studio = undefined;
        }
      });
    });
    const page = await fetch(`${origin}/`, { signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!page.ok) throw new Error("STUDIO_UNAVAILABLE");
    const csp = studioCsp(await page.text());
    session.fromPartition("persist:flow-desktop-studio").webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-security-policy") delete headers[key];
      callback({ responseHeaders: { ...headers, "Content-Security-Policy": [csp] } });
    });
    studio = new BrowserWindow({ show: false, width: 1440, height: 940, minWidth: 900, minHeight: 650, title: "Flow MCP Studio", autoHideMenuBar: true,
      webPreferences: { ...desktopPreferences, partition: "persist:flow-desktop-studio" } });
    secureWindow(studio, `${origin}/`);
    studio.on("closed", () => { studio = undefined; });
    await studio.loadURL(`${origin}/`);
    studio.show();
    // Closing the setup window must not invoke the normal backend shutdown path.
    startup?.destroy();
    return {};
  } catch {
    studio?.destroy(); studio = undefined;
    backend?.kill(); backend = undefined;
    return { error: "Studio gagal terhubung ke backend localhost. Port mungkin dipakai aplikasi lain. Periksa FLOW_MCP_PORT, lalu coba lagi. Backend lain tidak dihentikan." };
  } finally { starting = false; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const window = studio ?? startup; if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.on("before-quit", event => { if (!quitting && (backend || starting)) { event.preventDefault(); const window = studio ?? startup; if (window) void stopAndQuit(window); } });
  app.on("window-all-closed", () => { if (!backend) app.quit(); });
  void app.whenReady().then(() => {
    origin = studioOrigin(Number(process.env.FLOW_MCP_PORT ?? 8787));
    // Independent sessions: Studio never receives the startup preload bridge.
    for (const partition of ["flow-desktop-startup", "persist:flow-desktop-studio"]) {
      const ses = session.fromPartition(partition);
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler(() => false);
      ses.on("will-download", event => event.preventDefault());
      ses.webRequest.onBeforeRequest((details, callback) => {
        const startupAsset = [startupUrl, "startup.js", "startup.css"].map(file => new URL(file, startupUrl).href).includes(details.url);
        callback({ cancel: !(partition === "flow-desktop-startup" ? startupAsset : allowedRequest(details.url, origin)) });
      });
    }
    ipcMain.handle("desktop:check", event => { startupSender(event); return checkDependencies(); });
    ipcMain.handle("desktop:start", event => { startupSender(event); return launch(); });
    showStartup();
  }).catch(async () => {
    await dialog.showMessageBox({ type: "error", message: "Konfigurasi desktop tidak valid. FLOW_MCP_PORT harus berupa angka 1–65535." });
    quitting = true; app.quit();
  });
}
