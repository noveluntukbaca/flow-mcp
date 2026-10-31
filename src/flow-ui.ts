import type { Locator, Page } from "playwright-core";

export const UI_TIMEOUT = 5000;
export class FlowUiError extends Error {
  constructor(readonly code: string, readonly detail: string, readonly submitted = false) {
    super(`[${code}] ${detail}${submitted ? " Permintaan mungkin sudah diterima Flow dan memakai kredit. Periksa hasil di Chrome sebelum mencoba lagi; aplikasi tidak mengulang otomatis." : " Belum ada permintaan generasi yang dikirim oleh langkah ini."}`);
    this.name = "FlowUiError";
  }
}

export function projectRoot(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return;
    if (!(url.hostname === "flow.google.com" || url.hostname === "labs.google" && url.pathname.startsWith("/fx/"))) return;
    const root = url.pathname.match(/^(.*\/project\/[^/]+)/)?.[1];
    return root ? `${url.origin}${root}` : undefined;
  } catch { return; }
}
export function assertProject(page: Page, expectedRoot?: string): string {
  const root = projectRoot(page.url());
  if (!root || expectedRoot && root !== expectedRoot) {
    throw new FlowUiError("FLOW_PROJECT_REQUIRED", "Buka proyek Google Flow yang benar di Chrome. Halaman login, beranda, akses ditolak, atau proyek berbeda tidak dapat digunakan.");
  }
  return root;
}

export async function uniqueVisible(locator: Locator, label: string): Promise<Locator | undefined> {
  const visible = locator.filter({ visible: true });
  const count = await visible.count();
  if (count > 1) throw new FlowUiError("FLOW_UI_AMBIGUOUS", `Ada lebih dari satu kontrol ${label}. Tutup panel/dialog lain dan periksa tampilan Flow secara manual.`);
  return count === 1 ? visible : undefined;
}

async function until<T>(page: Page, probe: () => Promise<T | undefined>, failure: () => FlowUiError): Promise<T> {
  const root = assertProject(page);
  const deadline = Date.now() + UI_TIMEOUT;
  do {
    assertProject(page, root);
    const result = await probe();
    if (result !== undefined) return result;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  throw failure();
}

const agentControl = (page: Page) => page.getByRole("button", { name: "Agent", exact: true })
  .or(page.getByRole("switch", { name: "Agent", exact: true }));
const standardComposer = (page: Page) => page.locator(".ProseMirror[contenteditable=true]");
export async function setAgentModeCompatible(page: Page, on: boolean): Promise<void> {
  assertProject(page);
  await until(page, async () => {
    const agent = await uniqueVisible(agentControl(page), "Agent");
    if (!agent) {
      // Agent is optional for a known standard composer, never inferred from its absence alone.
      const prompt = await uniqueVisible(standardComposer(page), "prompt");
      const settings = await uniqueVisible(page.getByRole("button", { name: "Settings trigger", exact: true }), "pengaturan generasi");
      const start = await uniqueVisible(page.getByRole("button", { name: "Start generation", exact: true }), "generasi");
      if (!on && prompt && settings && start) return true;
      return;
    }
    const pressed = await agent.getAttribute("aria-pressed", { timeout: UI_TIMEOUT });
    const checked = await agent.getAttribute("aria-checked", { timeout: UI_TIMEOUT });
    const state = pressed ?? checked;
    if (state !== "true" && state !== "false") throw new FlowUiError("FLOW_AGENT_STATE_UNKNOWN", "Status Agent tidak dapat dibaca. Aplikasi tidak akan menebak mode aktif.");
    if ((state === "true") !== on) {
      // A toggle is a navigation/control action, not a generation action. Click once only.
      try { await agent.click({ timeout: UI_TIMEOUT }); }
      catch { throw new FlowUiError("FLOW_AGENT_BLOCKED", "Kontrol Agent tidak dapat diklik. Periksa panel penutup atau status disabled di Chrome."); }
      await until(page, async () => {
        const control = await uniqueVisible(agentControl(page), "Agent");
        if (!control) return;
        const value = await control.getAttribute(pressed !== null ? "aria-pressed" : "aria-checked", { timeout: UI_TIMEOUT });
        return value === String(on) ? true : undefined;
      }, () => new FlowUiError("FLOW_AGENT_NOT_CHANGED", "Mode Agent tidak berubah. Periksa panel atau pembatasan akun di Chrome."));
    }
    if (!on) {
      const prompt = await uniqueVisible(standardComposer(page), "prompt");
      const settings = await uniqueVisible(page.getByRole("button", { name: "Settings trigger", exact: true }), "pengaturan generasi");
      const start = await uniqueVisible(page.getByRole("button", { name: "Start generation", exact: true }), "generasi");
      if (!prompt || !settings || !start) return;
    }
    return true;
  }, () => new FlowUiError(on ? "FLOW_AGENT_UNAVAILABLE" : "FLOW_COMPOSER_UNSUPPORTED", on
    ? "Kontrol Agent tidak tersedia pada antarmuka/proyek ini. Fitur yang membutuhkan Agent tidak dapat dijalankan. Characters tidak membutuhkan Agent."
    : "Composer standar belum dikenali. Kembali ke grid proyek dan periksa kolom prompt, pengaturan, serta tombol generasi. Tidak ada fallback generasi otomatis."));
}

const characterLabel = /^(Characters|Karakter)$/i;
const creationLabel = /^(New character|Create character|Karakter baru|Buat karakter)$/i;
export async function openCharacters(page: Page): Promise<string> {
  const root = assertProject(page);
  const nav = page.getByRole("navigation");
  const controls = nav.getByRole("button", { name: characterLabel }).or(nav.getByRole("link", { name: characterLabel }))
    .or(page.getByRole("tab", { name: characterLabel }))
    .or(page.getByRole("navigation", { name: "Project navigation", exact: true }).locator("button, a").filter({ hasText: /(?:^|\s)(Characters|Karakter)\s*$/i }));
  const control = await until(page, () => uniqueVisible(controls, "Characters"), () => new FlowUiError("FLOW_CHARACTERS_UNAVAILABLE", "Navigasi Characters tidak ditemukan. Tampilkan navigasi proyek di Chrome. Jangan memilih menu Create/generasi lain sebagai pengganti."));
  try { await control.click({ timeout: UI_TIMEOUT }); }
  catch { throw new FlowUiError("FLOW_CHARACTERS_BLOCKED", "Navigasi Characters tidak dapat diklik. Periksa panel yang menutupinya atau pembatasan akun di Chrome."); }
  assertProject(page, root);
  return root;
}

export async function prepareCharacterCreation(page: Page, source: "image" | "asset"): Promise<string> {
  const root = assertProject(page);
  // Never treat an existing character's edit screen as an empty creation form.
  if (/\/characters?\/(?!new\/?$|create\/?$)[^/]+\/?$/.test(new URL(page.url()).pathname)) {
    throw new FlowUiError("FLOW_CHARACTER_EDITOR_OPEN", "Editor karakter masih terbuka. Selesaikan atau batalkan secara manual, lalu kembali ke Characters.");
  }
  const alreadyCreating = /\/characters?\/(?:new|create)\/?$|\/character\/?$/.test(new URL(page.url()).pathname);
  if (!alreadyCreating) await openCharacters(page);
  let opened = alreadyCreating;
  await until(page, async () => {
    assertProject(page, root);
    const heading = await uniqueVisible(page.getByRole("heading", { name: creationLabel }), "judul pembuatan karakter");
    const onCreationRoute = /\/characters?\/(?:new|create)\/?$|\/character\/?$/.test(new URL(page.url()).pathname);
    const upload = await uniqueVisible(page.getByRole("button", { name: /^(Upload|Upload image|Unggah|Unggah gambar)$/i }), "unggah karakter");
    const asset = await uniqueVisible(page.getByRole("button", { name: /^(Add from project|Tambahkan dari proyek)$/i }), "gambar proyek");
    if ((opened || heading || onCreationRoute) && (source === "image" ? upload : asset)) return true;
    // An unrecognised description-only generator is NOT a navigation button.
    const description = await uniqueVisible(page.getByRole("textbox", { name: /^(Description|Character description|Deskripsi|Deskripsi karakter)$/i }), "deskripsi karakter");
    if (description && !upload && !asset) throw new FlowUiError("FLOW_CHARACTER_FORM_UNSUPPORTED", "Characters menampilkan formulir pembuatan yang belum didukung. Aplikasi tidak dapat memastikan biaya atau arti tombol Create. Buat karakter secara manual di Chrome, lalu gunakan Reload.");
    if (!opened) {
      const create = await uniqueVisible(page.getByRole("button", { name: creationLabel }).or(page.getByRole("link", { name: creationLabel })), "karakter baru");
      if (create) {
        // "Create character" can be a submit button in a newly rolled-out native form.
        // Even unnamed inputs/editors must stop us; do not infer a free/native generation path.
        const nativeForm = await create.evaluate(element => {
          const area = element.closest("form, dialog, section, main, [role=main]") ?? document.body;
          return [...area.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=true]")]
            .some(input => (input as HTMLElement).getClientRects().length > 0);
        }, undefined, { timeout: UI_TIMEOUT });
        if (nativeForm) throw new FlowUiError("FLOW_CHARACTER_FORM_UNSUPPORTED", "Tombol Create character berada dalam formulir dengan input/editor. Arti submit dan biayanya belum diverifikasi; lanjutkan secara manual di Chrome.");
        try { await create.click({ timeout: UI_TIMEOUT }); }
        catch { throw new FlowUiError("FLOW_CHARACTER_CREATE_BLOCKED", "Kontrol karakter baru tidak dapat diklik. Periksa status disabled atau dialog di Chrome."); }
        opened = true;
      }
    }
    return;
  }, () => new FlowUiError("FLOW_CHARACTER_CREATION_UNAVAILABLE", "Characters tidak menawarkan kontrol pembuatan berbasis gambar yang dikenali (New/Create character dan Upload/Add from project). Fitur mungkin tidak tersedia untuk akun ini atau UI telah berubah. Gunakan kontrol yang tersedia secara manual di Chrome."));
  return root;
}

export async function characterUploadControl(page: Page): Promise<Locator> {
  const control = await uniqueVisible(page.getByRole("button", { name: /^(Upload|Upload image|Unggah|Unggah gambar)$/i }), "unggah karakter");
  if (!control) throw new FlowUiError("FLOW_CHARACTER_UPLOAD_UNAVAILABLE", "Kontrol unggah karakter berubah atau tidak tersedia.");
  return control;
}
