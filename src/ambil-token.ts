#!/usr/bin/env node
/**
 * `npm run ambil-token`: cadangan bila halaman "Kunci keamanan" tidak menampilkan token.
 * Meminta username & password DI TERMINAL KAMU SENDIRI, mengirimnya sekali ke
 * <MOODLE_BASE_URL>/login/token.php lewat HTTPS, lalu mencetak token.
 * Username/password tidak disimpan di mana pun, dan token tidak ditulis ke file.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const baseUrl = (process.env.MOODLE_BASE_URL || "https://elearning.ut.ac.id").replace(/\/+$/, "");
const service = process.env.MOODLE_SERVICE || "moodle_mobile_app";

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

async function main() {
  if (!baseUrl.startsWith("https://")) throw new Error("MOODLE_BASE_URL harus https://");
  console.log(`Minta token layanan "${service}" dari ${baseUrl}. Password tidak disimpan.`);
  const username = await ask("Username (NIM): ");
  const password = await ask("Password: ", true);
  const body = new URLSearchParams({ username, password, service });
  const res = await fetch(`${baseUrl}/login/token.php`, { method: "POST", body });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string; errorcode?: string };
  if (!data.token) {
    throw new Error(`${data.error ?? `HTTP ${res.status}`} (${data.errorcode ?? "?"}). Kemungkinan layanan aplikasi seluler dinonaktifkan UT atau login memakai SSO.`);
  }
  console.log("\nToken kamu (salin ke MOODLE_TOKEN, jangan dibagikan):\n");
  console.log(data.token);
}

main().catch((err) => {
  console.error(`GAGAL: ${(err as Error).message}`);
  process.exit(1);
});
