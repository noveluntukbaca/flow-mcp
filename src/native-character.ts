import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname, isAbsolute } from "node:path";
import type { Locator, Page } from "playwright-core";
import { CharacterStore, characterStore, type CharacterIdentity } from "./character-store.js";
import { assertProject, FlowUiError, openCharacters, UI_TIMEOUT, uniqueVisible } from "./flow-ui.js";

export interface NativeCharacterInput {
  name: string; describe?: string; image?: string; personality?: string; voice?: string;
  aspect_ratio?: string; max_credits?: number; confirmation_token?: string;
}
export type NativeCharacterResult = {
  status: "created" | "already_exists" | "confirmation_required" | "blocked";
  name: string; message?: string; quote?: number; model?: string; confirmation_token?: string;
  url?: string; flow_name?: string; flow_id?: string; voice?: string; use_as?: string;
};
interface Card { id: string; title: string; url: string }
interface Composer { scope: Locator; prompt: Locator; model: string; submit: Locator }
interface Pending { project: string; fingerprint: string; quote: number; model: string; prompt: string; expires: number; attachments: string; baseline: Card[]; needsAttachment?: boolean }
const placeholder = "Describe your character...";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (code: string, message: string) => new FlowUiError(code, message);

export function characterPrompt(input: NativeCharacterInput): string {
  const description = input.describe?.trim() ?? "";
  const personality = input.personality?.trim() ?? "";
  return [description || (input.image ? "Create a character using the attached reference image." : ""), personality ? `Personality: ${personality}` : ""].filter(Boolean).join("\n\n");
}
export function characterFingerprint(input: NativeCharacterInput): string {
  let image = input.image ?? "";
  if (image.startsWith("asset:") && !image.slice(6).trim()) throw fail("FLOW_CHARACTER_IMAGE", "Pilih judul gambar proyek yang tidak kosong.");
  if (image && !image.startsWith("asset:")) {
    if (!isAbsolute(image)) throw fail("FLOW_CHARACTER_IMAGE", "Gunakan path gambar absolut dari pemilih file.");
    let st;
    try { st = statSync(image); } catch { throw fail("FLOW_CHARACTER_IMAGE", "File gambar yang dipilih tidak dapat dibaca."); }
    if (!st.isFile() || st.size > 20 * 1024 * 1024 || !/\.(png|jpe?g|webp|gif)$/i.test(extname(image))) throw fail("FLOW_CHARACTER_IMAGE", "Gunakan file gambar PNG/JPEG/WebP/GIF biasa, maksimal 20 MiB.");
    try { image = digest(readFileSync(image).toString("base64")); }
    catch { throw fail("FLOW_CHARACTER_IMAGE", "Isi gambar yang dipilih tidak dapat dibaca."); }
  }
  // Consent token/credit ceiling are not creative inputs; changing any actual input invalidates consent.
  return digest({ name: input.name.trim(), prompt: characterPrompt(input), image, voice: input.voice?.trim() ?? "", aspect_ratio: input.aspect_ratio ?? "" });
}
export function parseCharacterQuote(text: string): number | undefined {
  const match = text.trim().match(/^(?:(?:Generation cost|Credit cost|Cost|Biaya)\s*:?\s*)?(\d+)\s*(?:credits?|kredit)\s*$/i);
  if (!match) return;
  const value = Number(match[1]); return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
async function visible(locator: Locator, label: string) { return uniqueVisible(locator, label); }
async function composer(page: Page): Promise<Composer> {
  const prompt = await visible(page.getByPlaceholder(placeholder, { exact: true }), "prompt karakter native");
  if (!prompt) throw fail("FLOW_NATIVE_COMPOSER", `Composer native dengan placeholder “${placeholder}” tidak ditemukan. Tidak ada fallback ke generator lain.`);
  // Nearest semantic composer only. Never read an account balance or sample prompt as a price.
  const scope = prompt.locator('xpath=ancestor::*[self::form or self::flow-base-prompt-box or @role="form"][1]');
  if (await scope.count() !== 1) throw fail("FLOW_NATIVE_SCOPE", "Batas composer native belum dikenali. Form ini tidak dapat diautomasi dengan aman.");
  const model = await visible(scope.getByRole("button", { name: /^(Nano Banana 2\.1|Select model family|Model)$/i }).or(scope.getByRole("combobox", { name: /model/i })), "model karakter");
  if (!model) throw fail("FLOW_NATIVE_MODEL", "Pemilih model Nano Banana 2.1 tidak ditemukan.");
  const selected = (await model.innerText({ timeout: UI_TIMEOUT })).trim() || await model.inputValue({ timeout: UI_TIMEOUT }).catch(() => "");
  if (selected !== "Nano Banana 2.1") throw fail("FLOW_NATIVE_MODEL", "Model composer berubah atau tidak didukung. Pilihan model tidak diganti secara otomatis.");
  // Arrow icons alone aren't actionable proof: require an accessible name or a real submit button in this form.
  const submit = await visible(scope.getByRole("button", { name: /^(Generate|Generate character|Create character|Submit|Start generation)(?:\s*\(\d+ credits?\))?$/i })
    .or(scope.locator('button[type="submit"]')), "panah submit karakter");
  if (!submit) throw fail("FLOW_NATIVE_SUBMIT", "Panah submit tidak memiliki identitas yang dapat diverifikasi. Periksa accessible name/tipe tombol, jangan menebak posisi ikon.");
  return { scope, prompt, model: selected, submit };
}
async function quote(view: Composer): Promise<number | undefined> {
  if (await view.scope.getAttribute("aria-busy", { timeout: UI_TIMEOUT }) === "true") return;
  if (await view.scope.locator('[aria-busy="true"]').count()) return;
  const texts = await view.scope.getByRole("status", { name: /^(Generation cost|Credit cost|Biaya)$/i }).filter({ visible: true }).allTextContents();
  texts.push(...await view.scope.getByRole("link", { name: /^\d+ credits?$/i }).filter({ visible: true }).allTextContents());
  const label = await view.submit.getAttribute("aria-label", { timeout: UI_TIMEOUT }) ?? "";
  const inline = label.match(/\((\d+ credits?)\)$/i)?.[1];
  if (inline) texts.push(inline);
  if (!texts.length) return;
  const parsed = texts.map(parseCharacterQuote);
  if (parsed.some(value => value === undefined) || new Set(parsed).size !== 1) return;
  return parsed[0];
}
async function cards(page: Page, project: string, onlyReady = true): Promise<Card[]> {
  assertProject(page, project);
  const found = await page.locator("flow-character-tile").evaluateAll(elements => elements.map(element => {
    const link = element.querySelector<HTMLAnchorElement>('a[href*="/character/"] , a[href*="/characters/"]');
    const linkId = link?.pathname.match(/\/characters?\/([^/]+)\/?$/)?.[1];
    const attributeId = element.getAttribute("data-character-id");
    const id = attributeId && linkId && attributeId !== linkId ? undefined : attributeId ?? linkId;
    const title = (element.getAttribute("data-character-name") ?? element.getAttribute("aria-label") ?? "").trim();
    const image = element.querySelector<HTMLImageElement>("img");
    const ready = Boolean(image?.complete && image.naturalWidth > 0 && element.getAttribute("aria-busy") !== "true" && !element.querySelector('[role=progressbar], [aria-busy="true"]') && !/\b(?:generating|processing|pending)\b|\d+%/i.test(element.textContent ?? ""));
    return { id, title, url: link?.href ?? "", ready };
  }));
  if (!onlyReady && found.some(row => !row.id && !["New character", "Create my avatar"].includes(row.title))) throw fail("FLOW_NATIVE_BASELINE", "Kartu karakter yang sudah ada tidak memiliki ID yang dikenali. Hasil baru tidak dapat dibedakan dengan aman.");
  return found.filter((row): row is Card & { ready: boolean } => Boolean(row.id && (!onlyReady || row.title && row.ready) && !["New character", "Create my avatar"].includes(row.title)))
    .filter(row => !row.url || row.url.startsWith(`${project}/`));
}
async function attachmentSignature(view: Composer): Promise<string> {
  // A removable image chip is required; sample cards/images cannot masquerade as an attachment.
  return digest(await view.scope.getByRole("button", { name: /^(Remove image|Remove reference)(?: .+)?$/i }).filter({ visible: true }).evaluateAll(buttons => buttons.map(button => ({
    label: button.getAttribute("aria-label"), text: button.parentElement?.textContent,
    image: button.parentElement?.querySelector<HTMLImageElement>("img[src]")?.src,
    media: button.parentElement?.querySelector("[data-media-id]")?.getAttribute("data-media-id"),
  }))));
}
async function attachImage(page: Page, view: Composer, image: string, project: string): Promise<void> {
  const originalUrl = page.url();
  if (image.startsWith("asset:")) {
    const title = image.slice(6).trim();
    const add = await visible(view.scope.getByRole("button", { name: "Add from project", exact: true }), "Add from project");
    if (!add) throw fail("FLOW_NATIVE_ASSET", "Kontrol Add from project tidak tersedia.");
    await add.click({ timeout: UI_TIMEOUT });
    const list = page.getByRole("listbox", { name: "Asset list", exact: true });
    await list.waitFor({ state: "visible", timeout: UI_TIMEOUT });
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const option = await visible(list.getByRole("option", { name: new RegExp(`^${escaped}(?: Image)?$`, "i") }), "gambar proyek");
    if (!option) throw fail("FLOW_NATIVE_ASSET", "Gambar proyek yang dipilih tidak ditemukan secara unik.");
    await option.click({ timeout: UI_TIMEOUT });
    const addMedia = await visible(page.getByRole("button", { name: "Add media", exact: true }), "Add media");
    if (!addMedia) throw fail("FLOW_NATIVE_ASSET", "Konfirmasi gambar proyek belum dikenali.");
    await addMedia.click({ timeout: UI_TIMEOUT });
  } else {
    const upload = await visible(view.scope.getByRole("button", { name: "Upload", exact: true }), "Upload");
    if (!upload) throw fail("FLOW_NATIVE_UPLOAD", "Kontrol Upload native tidak tersedia.");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: UI_TIMEOUT }), upload.click({ timeout: UI_TIMEOUT })]);
    await chooser.setFiles(image, { timeout: UI_TIMEOUT });
  }
  assertProject(page, project);
  if (page.url() !== originalUrl) throw fail("FLOW_NATIVE_ATTACHMENT_CHANGED", "Upload mengubah halaman secara tak terduga. Jangan ulangi sebelum memeriksa hasil di Chrome.");
  await view.scope.getByRole("button", { name: /^(Remove image|Remove reference)(?: .+)?$/i }).filter({ visible: true }).waitFor({ timeout: UI_TIMEOUT });
  await composer(page); // Legacy Upload that immediately creates/navigates is NOT this native attachment workflow.
}

export class NativeCharacterEngine {
  private readonly pending = new Map<string, Pending>();
  private running = false;
  constructor(private readonly store = characterStore, private readonly resultTimeout = 180_000, private readonly confirmationTtl = 120_000) {}
  async create(page: Page, input: NativeCharacterInput): Promise<NativeCharacterResult> {
    if (this.running) throw fail("FLOW_NATIVE_BUSY", "Pembuatan karakter lain masih berlangsung.");
    this.running = true;
    try { return await this.run(page, input); } finally { this.running = false; }
  }
  private async run(page: Page, input: NativeCharacterInput): Promise<NativeCharacterResult> {
    const project = assertProject(page);
    if (!input.name.trim() || (!input.describe?.trim() && !input.image)) throw fail("FLOW_NATIVE_INPUT", "Isi nama lokal dan deskripsi atau pilih gambar secara eksplisit.");
    if (input.max_credits !== undefined && (!Number.isSafeInteger(input.max_credits) || input.max_credits < 0)) throw fail("FLOW_NATIVE_CREDIT_LIMIT", "Batas kredit harus bilangan bulat nonnegatif.");
    if (input.aspect_ratio) throw fail("FLOW_NATIVE_ASPECT", "Composer native belum memiliki kontrol aspect ratio yang terverifikasi. Hapus aspect_ratio untuk melanjutkan.");
    const fingerprint = characterFingerprint(input);
    const existing = this.store.get(project, input.name);
    if (existing) {
      if (existing.state === "ready") return { status: "already_exists", name: existing.name, flow_id: existing.flow_id, flow_name: existing.flow_name, url: existing.url, voice: existing.voice, use_as: `asset:${existing.name}`, message: "Nama lokal ini sudah terhubung ke karakter Flow. Tidak ada submit kedua." };
      return { status: "blocked", name: input.name, message: "Nama ini memiliki submit yang hasilnya belum pasti. Periksa Characters di Chrome; aplikasi tidak mengirim ulang, termasuk setelah restart." };
    }
    let view: Composer;
    let baseline: Card[];
    let consent: Pending | undefined;
    let needsAttachment = Boolean(input.image);
    if (input.confirmation_token) {
      consent = this.pending.get(input.confirmation_token);
      this.pending.delete(input.confirmation_token); // Single use, including a failed verification attempt.
      if (!consent || consent.expires < Date.now() || consent.project !== project || consent.fingerprint !== fingerprint) throw fail("FLOW_NATIVE_CONSENT", "Konfirmasi kedaluwarsa atau input/proyek berubah. Periksa ulang kutipan dari aplikasi.");
      view = await composer(page); baseline = consent.baseline;
      needsAttachment = Boolean(consent.needsAttachment);
      if (await view.prompt.inputValue({ timeout: UI_TIMEOUT }) !== consent.prompt || await attachmentSignature(view) !== consent.attachments) throw fail("FLOW_NATIVE_CONSENT", "Prompt atau gambar di Chrome berubah setelah peninjauan. Konfirmasi dibatalkan.");
    } else {
      await openCharacters(page);
      baseline = await cards(page, project, false);
      if (baseline.some(card => card.title.toLowerCase() === input.name.trim().toLowerCase())) return { status: "blocked", name: input.name, message: "Karakter dengan nama ini sudah ada di Flow. Gunakan karakter itu; aplikasi tidak membuat duplikat." };
      const newCharacter = await visible(page.getByRole("button", { name: "New character", exact: true }).or(page.getByRole("link", { name: "New character", exact: true })), "New character");
      if (!newCharacter) throw fail("FLOW_NATIVE_NEW", "Tile New character tidak tersedia. Create my avatar tidak digunakan sebagai pengganti.");
      await newCharacter.click({ timeout: UI_TIMEOUT });
      await page.getByPlaceholder(placeholder, { exact: true }).waitFor({ state: "visible", timeout: UI_TIMEOUT });
      assertProject(page, project);
      view = await composer(page);
      await view.prompt.fill(characterPrompt(input), { timeout: UI_TIMEOUT });
      await page.waitForTimeout(500);
      // Inspect pricing before image attachment as well; never assume Upload is a free legacy creation path.
      if (await quote(view) === undefined) return { status: "blocked", name: input.name, message: "Biaya composer tidak dapat diverifikasi. Tidak ada submit atau upload gambar. Buka kutipan biaya di Flow, lalu periksa ulang dari aplikasi." };
    }
    assertProject(page, project);
    let cost = await quote(view);
    if (cost === undefined) return { status: "blocked", name: input.name, message: "Biaya tidak terbaca atau kutipan bertentangan. Submit diblokir; konfirmasi tidak dapat mengizinkan biaya yang tidak diketahui." };
    const review = (amount: number, attach: boolean): NativeCharacterResult => {
      const token = randomBytes(24).toString("hex");
      for (const [key, row] of this.pending) if (row.expires < Date.now() || row.project === project) this.pending.delete(key);
      // Snapshot is completed below, after all currently attached chips have been inspected.
      this.pending.set(token, { project, fingerprint, quote: amount, model: view.model, prompt: characterPrompt(input), expires: Date.now() + this.confirmationTtl, attachments: attachmentSnapshot, baseline, needsAttachment: attach });
      return { status: "confirmation_required", name: input.name, quote: amount, model: view.model, confirmation_token: token, message: `Flow menampilkan ${amount} kredit. Tinjau dan konfirmasi biaya ini sebelum submit. Suara hanya disimpan lokal.` };
    };
    let attachmentSnapshot = await attachmentSignature(view);
    if (consent && (cost !== consent.quote || view.model !== consent.model)) throw fail("FLOW_NATIVE_PRICE_CHANGED", "Biaya atau model berubah setelah konfirmasi. Periksa kutipan baru sebelum melanjutkan.");
    // Positive-cost image workflows obtain explicit approval BEFORE attempting Upload/Add from project.
    if (cost > 0 && !consent) return review(cost, needsAttachment);
    if (cost > (input.max_credits ?? 0)) throw fail("FLOW_NATIVE_CREDIT_LIMIT", `Kutipan ${cost} kredit melebihi batas ${input.max_credits ?? 0}. Tidak ada upload atau submit.`);
    if (needsAttachment && input.image) {
      const selectedImage = input.image.startsWith("asset:") ? `asset:${this.store.resolve(project, input.image.slice(6).trim())}` : input.image;
      const staged: CharacterIdentity = { project, name: input.name.trim(), prompt: characterPrompt(input), voice: input.voice, fingerprint, state: "attachment", created: new Date().toISOString() };
      this.store.save(staged);
      try {
        await attachImage(page, view, selectedImage, project);
        view = await composer(page);
        if (await view.prompt.inputValue({ timeout: UI_TIMEOUT }) !== characterPrompt(input)) throw fail("FLOW_NATIVE_ATTACHMENT_CHANGED", "Prompt berubah saat menambahkan referensi.");
        this.store.clearAttachment(project, input.name, fingerprint);
      } catch {
        throw new FlowUiError("FLOW_NATIVE_ATTACHMENT_UNCERTAIN", "Referensi tidak dapat diverifikasi; upload mungkin telah diterima. Catatan lokal mencegah pengulangan otomatis.", true);
      }
      const attachedCost = await quote(view);
      if (attachedCost === undefined) return { status: "blocked", name: input.name, message: "Biaya setelah referensi tidak dapat diverifikasi. Tidak ada submit." };
      attachmentSnapshot = await attachmentSignature(view);
      if (attachedCost !== cost || (attachedCost > 0 && !consent)) return review(attachedCost, false);
      cost = attachedCost;
    }
    if (cost > (input.max_credits ?? 0)) throw fail("FLOW_NATIVE_CREDIT_LIMIT", `Kutipan ${cost} kredit melebihi batas ${input.max_credits ?? 0}. Tidak ada submit.`);
    // Re-read immediately before the single submit. A quote/model/DOM change always cancels consent.
    view = await composer(page);
    if (await quote(view) !== cost || await view.prompt.inputValue({ timeout: UI_TIMEOUT }) !== characterPrompt(input) || characterFingerprint(input) !== fingerprint || (await attachmentSignature(view) !== attachmentSnapshot)) throw fail("FLOW_NATIVE_CHANGED", "Composer berubah sebelum submit. Periksa ulang; tidak ada klik submit.");
    if (!await view.submit.isEnabled({ timeout: UI_TIMEOUT })) throw fail("FLOW_NATIVE_DISABLED", "Panah submit masih disabled. Flow belum menerima prompt/gambar.");
    const row: CharacterIdentity = { project, name: input.name.trim(), prompt: characterPrompt(input), voice: input.voice?.trim() || undefined, fingerprint, state: "submitted", created: new Date().toISOString() };
    this.store.save(row); // Must succeed BEFORE the click. A crash/timeout can never cause a silent resend.
    try {
      await view.submit.click({ timeout: UI_TIMEOUT });
      const result = await this.waitResult(page, project, baseline);
      this.store.save({ ...row, state: "ready", flow_id: result.id, flow_name: result.title, url: result.url });
      return { status: "created", name: row.name, flow_name: result.title, flow_id: result.id, url: result.url, voice: row.voice, use_as: `asset:${row.name}`, quote: cost, message: "Karakter Flow berhasil terverifikasi. Nama referensi dan pilihan suara disimpan lokal; suara tidak dikirim ke Flow." };
    } catch {
      throw new FlowUiError("FLOW_NATIVE_RESULT_UNCERTAIN", "Submit dicatat, tetapi hasil karakter belum dapat diverifikasi. Tidak ada retry otomatis; periksa Characters dan kredit di Chrome.", true);
    }
  }
  private async waitResult(page: Page, project: string, before: Card[]): Promise<Card> {
    const known = new Set(before.map(card => card.id));
    const deadline = Date.now() + this.resultTimeout;
    let last = "";
    while (Date.now() < deadline) {
      assertProject(page, project);
      // Only known editor results with a fully loaded generated portrait can be finished automatically.
      if (/\/characters?\/[^/]+\/?$/.test(new URL(page.url()).pathname) && !/\/(new|create)\/?$/.test(new URL(page.url()).pathname)) {
        const portrait = await visible(page.getByRole("img", { name: "Generated character image", exact: true }), "hasil potret karakter");
        if (portrait && await portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0, undefined, { timeout: UI_TIMEOUT })) {
          const done = await visible(page.getByRole("button", { name: /^Done(?: editing)?$/ }), "Done karakter");
          if (done) await done.click({ timeout: UI_TIMEOUT });
          else await openCharacters(page);
        }
      }
      const fresh = (await cards(page, project)).filter(card => !known.has(card.id));
      if (fresh.length > 1) throw fail("FLOW_NATIVE_RESULT_AMBIGUOUS", "Lebih dari satu karakter baru muncul; hasil tidak dapat dipetakan secara aman.");
      if (fresh.length === 1 && fresh[0].url && last === digest(fresh[0])) return fresh[0];
      last = fresh.length === 1 ? digest(fresh[0]) : "";
      await page.waitForTimeout(300);
    }
    throw fail("FLOW_NATIVE_RESULT_TIMEOUT", "Batas waktu hasil karakter terlewati.");
  }
}
export const nativeCharacterEngine = new NativeCharacterEngine();
