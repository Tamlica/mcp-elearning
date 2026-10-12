#!/usr/bin/env node
/** `npm run cek`: uji token tanpa Claude. Menampilkan profil dan jumlah mata kuliah. */
import { clientFromEnv } from "./config.js";
import { ALLOWED_FUNCTIONS, type Course } from "./moodle.js";

async function main() {
  const client = clientFromEnv();
  const info = await client.siteInfo();
  console.log(`OK: terhubung ke ${info.sitename} sebagai ${info.fullname} (userid ${info.userid}), Moodle ${info.release ?? "?"}`);
  if (info.functions) {
    const have = new Set(info.functions.map((f) => f.name));
    const missing = [...ALLOWED_FUNCTIONS].filter((f) => !have.has(f));
    console.log(missing.length ? `Fungsi yang TIDAK diizinkan token ini: ${missing.join(", ")}` : "Semua fungsi baca yang dibutuhkan tersedia.");
  }
  const courses = await client.call<Course[]>("core_enrol_get_users_courses", { userid: info.userid });
  console.log(`Mata kuliah terdaftar: ${courses.length}`);
  for (const c of courses) console.log(`  - [${c.id}] ${c.fullname}`);
}

main().catch((err) => {
  console.error(`GAGAL: ${(err as Error).message}`);
  process.exit(1);
});
