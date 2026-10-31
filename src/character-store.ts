import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOME_DIR } from "./chrome.js";
import { safePath } from "./paths.js";
import { FlowUiError } from "./flow-ui.js";

export interface CharacterIdentity {
  project: string; name: string; prompt: string; voice?: string;
  fingerprint: string; state: "attachment" | "submitted" | "ready";
  flow_id?: string; flow_name?: string; url?: string; created: string;
}
const canonical = (name: string) => name.trim().normalize("NFKC").toLowerCase();
export const characterKey = (project: string, name: string) => createHash("sha256").update(JSON.stringify([project, canonical(name)])).digest("hex");

// A durable submit ledger, not a credential store. Corruption fails closed; never discard an uncertain attempt.
export class CharacterStore {
  constructor(private readonly home = HOME_DIR) {}
  private file() { mkdirSync(this.home, { recursive: true }); return safePath(join(this.home, "native-characters.json"), this.home); }
  private read(): Record<string, CharacterIdentity> {
    const path = this.file();
    if (!existsSync(path)) return {};
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (value.version !== 1 || !value.entries || typeof value.entries !== "object" || Array.isArray(value.entries)) throw Error();
      for (const [key, row] of Object.entries(value.entries) as [string, CharacterIdentity][]) {
        if (!row || !["ready", "submitted", "attachment"].includes(row.state) || typeof row.project !== "string" || typeof row.name !== "string" || typeof row.fingerprint !== "string") throw Error();
        if (key !== characterKey(row.project, row.name)) throw Error();
        if (row.state === "ready" && (typeof row.flow_id !== "string" || typeof row.flow_name !== "string" || typeof row.url !== "string" || !row.flow_id || !row.flow_name || !row.url.startsWith(row.project + "/"))) throw Error();
      }
      return value.entries;
    } catch { throw new FlowUiError("FLOW_CHARACTER_STORE", "Catatan karakter lokal tidak dapat dibaca. Pulihkan cadangannya sebelum mengirim karakter baru; aplikasi tidak menghapus catatan submit yang belum pasti."); }
  }
  get(project: string, name: string) { return this.read()[characterKey(project, name)]; }
  list(project: string) { return Object.values(this.read()).filter(row => row.project === project); }
  save(row: CharacterIdentity) {
    const entries = this.read(); entries[characterKey(row.project, row.name)] = row;
    this.write(entries);
  }
  clearAttachment(project: string, name: string, fingerprint: string) {
    const entries = this.read(), key = characterKey(project, name);
    if (entries[key]?.state !== "attachment" || entries[key].fingerprint !== fingerprint) throw new Error("Attachment ledger mismatch");
    delete entries[key]; this.write(entries);
  }
  private write(entries: Record<string, CharacterIdentity>) {
    const path = this.file();
    const temp = safePath(join(this.home, `native-characters-${randomBytes(8).toString("hex")}.tmp`), this.home);
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ version: 1, entries }, null, 2)); fsyncSync(fd); }
    finally { closeSync(fd); }
    renameSync(temp, path);
  }
  resolve(project: string, name: string): string {
    const row = this.get(project, name);
    if (!row) return name;
    if (row.state !== "ready" || !row.flow_name) throw new FlowUiError("FLOW_CHARACTER_UNCERTAIN", "Karakter lokal belum memiliki hasil Flow yang terverifikasi. Periksa hasil di Chrome; jangan mengulang generasi otomatis.", true);
    return row.flow_name;
  }
}
export const characterStore = new CharacterStore();
