// Uji end-to-end: jalankan server MCP asli (dist/index.js) lewat stdio terhadap Moodle tiruan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock, TOKEN, calls } from "./mock-moodle.mjs";
import { MoodleClient, flattenParams } from "../dist/moodle.js";
import { htmlToText } from "../dist/format.js";

let mock, client, base;

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
}

before(async () => {
  mock = await startMock();
  base = `http://127.0.0.1:${mock.address().port}`;
  client = new Client({ name: "test", version: "0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: ["dist/index.js"],
    env: { ...process.env, MOODLE_BASE_URL: base, MOODLE_TOKEN: TOKEN },
  }));
});
after(async () => { await client?.close(); mock?.close(); });

test("semua tool terdaftar dan bertanda readOnly", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "ut_baca_halaman", "ut_daftar_diskusi", "ut_daftar_kuis", "ut_daftar_mata_kuliah", "ut_daftar_tugas",
    "ut_detail_tugas", "ut_isi_mata_kuliah", "ut_profil", "ut_tenggat_mendatang",
  ]);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
});

test("ut_profil melaporkan fungsi yang tidak tersedia", async () => {
  const { data } = await call("ut_profil");
  assert.equal(data.nama, "TAMLICA MUHAIMIN");
  assert.deepEqual(data.fungsi_tidak_tersedia, ["mod_forum_get_forum_discussions"]);
});

test("ut_daftar_mata_kuliah menyaring mata kuliah yang sudah selesai", async () => {
  const aktif = (await call("ut_daftar_mata_kuliah")).data;
  assert.deepEqual(aktif.map((c) => c.kode), ["STSI4208.8", "STSI4206.22"]);
  const semua = (await call("ut_daftar_mata_kuliah", { hanya_aktif: false })).data;
  assert.equal(semua.length, 3);
});

test("ut_isi_mata_kuliah: per sesi, URL file tanpa token, sesi terkunci", async () => {
  const all = (await call("ut_isi_mata_kuliah", { course_id: 101 })).data;
  assert.equal(all.length, 3);
  const s1 = (await call("ut_isi_mata_kuliah", { course_id: 101, sesi: 1 })).data[0];
  const file = s1.aktivitas.find((a) => a.jenis === "file").file[0];
  assert.equal(file.url, "http://localhost/pluginfile.php/1/mod_resource/content/0/modul1.pdf?forcedownload=1");
  assert.ok(!JSON.stringify(s1).includes("SECRET"));
  assert.equal(s1.aktivitas.find((a) => a.jenis === "label").deskripsi, "Kerjakan sebelum Minggu");
  assert.match(all[2].terkunci, /20 Oktober/);
  assert.ok((await call("ut_isi_mata_kuliah", { course_id: 101, sesi: 9 })).isError);
});

test("ut_daftar_kuis: status & nilai", async () => {
  const kuis = (await call("ut_daftar_kuis")).data;
  assert.equal(kuis.length, 2);
  const a = kuis.find((q) => q.quiz_id === 7), b = kuis.find((q) => q.quiz_id === 8);
  assert.equal(a.status, "belum dikerjakan");
  assert.equal(a.batas_waktu_menit, 30);
  assert.equal(b.status, "selesai");
  assert.equal(b.nilai_terbaik, 8.5);
  assert.equal(b.maks_percobaan, "tidak terbatas");
});

test("ut_daftar_tugas & ut_detail_tugas", async () => {
  const tugas = (await call("ut_daftar_tugas")).data;
  assert.deepEqual(tugas.map((t) => t.status), ["belum dikirim", "sudah dikirim"]);
  const d = (await call("ut_detail_tugas", { cmid: 530 })).data;
  assert.match(d.instruksi, /DFD level 0/);
  assert.match(d.instruksi, /- Identifikasi entitas/);
  assert.deepEqual(d.bentuk_pengiriman, ["file (maks 1 file, tipe: .pdf,.docx)"]);
  assert.ok(!JSON.stringify(d).includes("SECRET"));
  const g = (await call("ut_detail_tugas", { assign_id: 31 })).data;
  assert.equal(g.status_penilaian, "sudah dinilai");
  assert.equal(g.umpan_balik_tutor, "Bagus, lengkapi referensi.");
});

test("ut_tenggat_mendatang dan ut_baca_halaman", async () => {
  const t = (await call("ut_tenggat_mendatang", { hari: 30 })).data;
  assert.equal(t.length, 2);
  assert.equal(t[0].perlu_tindakan, "Kerjakan kuis");
  const h = (await call("ut_baca_halaman", { course_id: 101, cmid: 510 })).data;
  assert.match(h.isi, /kumpulan elemen yang saling/);
});

test("ut_daftar_diskusi: daftar forum ok, fungsi yang ditolak situs jadi pesan jelas", async () => {
  const forums = (await call("ut_daftar_diskusi", { course_id: 101 })).data;
  assert.equal(forums[0].forum_cmid, 512);
  const r = await call("ut_daftar_diskusi", { course_id: 101, forum_cmid: 512 });
  assert.ok(r.isError);
  assert.match(r.text, /tidak diizinkan/);
});

test("tidak ada fungsi tulis yang pernah dipanggil", () => {
  for (const fn of calls) assert.match(fn, /_get_/, fn);
});

test("klien memblokir fungsi tulis sebelum request dikirim", async () => {
  let sent = false;
  const c = new MoodleClient({ baseUrl: base, token: TOKEN, fetchImpl: async () => { sent = true; throw new Error("x"); } });
  for (const fn of ["mod_assign_save_submission", "mod_assign_submit_for_grading", "mod_quiz_start_attempt", "mod_quiz_process_attempt", "mod_forum_add_discussion_post"]) {
    await assert.rejects(c.call(fn), /diblokir/);
  }
  assert.equal(sent, false);
});

test("token salah dan http non-https", async () => {
  const c = new MoodleClient({ baseUrl: base, token: "salah" });
  await assert.rejects(c.call("core_webservice_get_site_info"), /Token salah/);
  assert.throws(() => new MoodleClient({ baseUrl: "http://elearning.ut.ac.id", token: "x" }), /https/);
});

test("util", () => {
  assert.equal(flattenParams({ courseids: [1, 2], a: true }).toString(), "courseids%5B0%5D=1&courseids%5B1%5D=2&a=1");
  assert.equal(htmlToText('<p>A&amp;B <a href="https://x.id">link</a></p>'), "A&B link (https://x.id)");
});
