import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ALLOWED_FUNCTIONS,
  MoodleClient,
  MoodleError,
  type ActionEvent,
  type Assignment,
  type Course,
  type CourseModule,
  type Discussion,
  type Forum,
  type Page,
  type Quiz,
  type QuizAttempt,
  type Section,
  type SubmissionStatus,
} from "./moodle.js";
import { compact, fmtTime, htmlToText, relativeDue, stripToken } from "./format.js";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;

const SUBMISSION_STATUS: Record<string, string> = {
  new: "belum dikirim",
  draft: "draf (belum dikirim untuk dinilai)",
  submitted: "sudah dikirim",
  reopened: "dibuka ulang",
};
const QUIZ_STATE: Record<string, string> = {
  inprogress: "sedang dikerjakan",
  overdue: "lewat waktu, belum dikirim",
  finished: "selesai",
  abandoned: "tidak pernah dikirim",
};

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(err: unknown) {
  const msg = err instanceof MoodleError ? err.message : `Error: ${(err as Error).message ?? String(err)}`;
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** URL file webservice butuh token; ubah ke pluginfile biasa agar dibuka lewat browser yang sudah login. */
function browserFileUrl(url: string | undefined): string | undefined {
  return stripToken(url)?.replace("/webservice/pluginfile.php", "/pluginfile.php");
}

export function isCurrentCourse(c: Course, now = Date.now() / 1000): boolean {
  if (c.visible === 0) return false;
  if (c.enddate && c.enddate < now) return false;
  return true;
}

export function registerTools(server: McpServer, client: MoodleClient): void {
  async function myCourses(onlyCurrent = true): Promise<Course[]> {
    const info = await client.siteInfo();
    const courses = await client.call<Course[]>("core_enrol_get_users_courses", { userid: info.userid });
    return onlyCurrent ? courses.filter((c) => isCurrentCourse(c)) : courses;
  }
  async function resolveCourseIds(courseId?: number): Promise<{ ids: number[]; names: Map<number, string> }> {
    const courses = await myCourses(courseId === undefined);
    const names = new Map(courses.map((c) => [c.id, c.fullname]));
    return { ids: courseId !== undefined ? [courseId] : courses.map((c) => c.id), names };
  }

  // 1. Profil & diagnosis token
  server.registerTool(
    "ut_profil",
    {
      title: "Profil akun elearning",
      description:
        "Cek koneksi ke elearning UT: nama pengguna, situs, versi Moodle, dan fungsi read-only mana yang diizinkan untuk token ini. Pakai pertama kali untuk memastikan token bekerja.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const info = await client.siteInfo();
        const available = new Set((info.functions ?? []).map((f) => f.name));
        const needed = [...ALLOWED_FUNCTIONS];
        return ok(
          compact({
            situs: info.sitename,
            url: info.siteurl,
            nama: info.fullname,
            username: info.username,
            userid: info.userid,
            versi_moodle: info.release,
            fungsi_tersedia: info.functions ? needed.filter((f) => available.has(f)) : undefined,
            fungsi_tidak_tersedia: info.functions ? needed.filter((f) => !available.has(f)) : undefined,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 2. Daftar mata kuliah
  server.registerTool(
    "ut_daftar_mata_kuliah",
    {
      title: "Daftar mata kuliah",
      description: "Daftar mata kuliah (kelas tuton) yang diikuti di elearning UT, dengan id untuk dipakai tool lain.",
      inputSchema: {
        hanya_aktif: z
          .boolean()
          .default(true)
          .describe("true = hanya mata kuliah yang masih berjalan; false = termasuk semester lalu"),
      },
      annotations: READ_ONLY,
    },
    async ({ hanya_aktif }) => {
      try {
        const courses = await myCourses(hanya_aktif);
        return ok(
          courses.map((c) =>
            compact({
              course_id: c.id,
              nama: c.fullname,
              kode: c.shortname,
              mulai: fmtTime(c.startdate),
              selesai: fmtTime(c.enddate),
              progres_persen: typeof c.progress === "number" ? Math.round(c.progress) : undefined,
              terakhir_diakses: fmtTime(c.lastaccess),
            }),
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 3. Isi mata kuliah per sesi
  server.registerTool(
    "ut_isi_mata_kuliah",
    {
      title: "Materi per sesi",
      description:
        "Isi mata kuliah per sesi (section): materi, file, tautan, kuis, tugas, dan diskusi, termasuk tanggal buka/tenggat dan status selesai. Gunakan parameter sesi untuk satu sesi saja.",
      inputSchema: {
        course_id: z.number().int().describe("id dari ut_daftar_mata_kuliah"),
        sesi: z.number().int().min(0).optional().describe("nomor section/sesi (0 = bagian umum). Kosongkan untuk semua."),
        sertakan_deskripsi: z.boolean().default(true).describe("sertakan teks deskripsi tiap aktivitas"),
      },
      annotations: READ_ONLY,
    },
    async ({ course_id, sesi, sertakan_deskripsi }) => {
      try {
        const sections = await client.call<Section[]>("core_course_get_contents", { courseid: course_id });
        const picked = sesi === undefined ? sections : sections.filter((s) => s.section === sesi);
        if (picked.length === 0) return fail(new Error(`Sesi ${sesi} tidak ditemukan di mata kuliah ${course_id}.`));
        return ok(
          picked.map((s) =>
            compact({
              sesi: s.section,
              judul: s.name,
              ringkasan: htmlToText(s.summary, 1500),
              terkunci: s.uservisible === false ? htmlToText(s.availabilityinfo) || "ya" : undefined,
              aktivitas: s.modules.filter((m) => m.visible !== 0).map((m) => describeModule(m, sertakan_deskripsi)),
            }),
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 4. Kuis
  server.registerTool(
    "ut_daftar_kuis",
    {
      title: "Daftar kuis",
      description:
        "Informasi kuis (judul, waktu buka/tutup, batas waktu, jumlah percobaan, status & nilai terbaik). Hanya membaca; tidak bisa memulai atau mengerjakan kuis.",
      inputSchema: {
        course_id: z.number().int().optional().describe("kosongkan untuk semua mata kuliah aktif"),
        sertakan_status: z.boolean().default(true).describe("ambil status percobaan & nilai (1-2 request tambahan per kuis)"),
      },
      annotations: READ_ONLY,
    },
    async ({ course_id, sertakan_status }) => {
      try {
        const { ids, names } = await resolveCourseIds(course_id);
        if (ids.length === 0) return ok([]);
        const res = await client.call<{ quizzes: Quiz[] }>("mod_quiz_get_quizzes_by_courses", { courseids: ids });
        const rows = await mapLimit(res.quizzes, 4, async (q) => {
          const base = compact({
            quiz_id: q.id,
            cmid: q.coursemodule,
            mata_kuliah: names.get(q.course) ?? q.course,
            judul: q.name,
            deskripsi: htmlToText(q.intro, 1500),
            dibuka: fmtTime(q.timeopen),
            ditutup: fmtTime(q.timeclose),
            sisa_waktu: relativeDue(q.timeclose),
            batas_waktu_menit: q.timelimit ? Math.round(q.timelimit / 60) : undefined,
            maks_percobaan: q.attempts === 0 ? "tidak terbatas" : q.attempts,
            nilai_maks: q.grade,
            url: `${client.baseUrl}/mod/quiz/view.php?id=${q.coursemodule}`,
          });
          if (!sertakan_status) return base;
          return { ...base, ...(await quizStatus(q)) };
        });
        return ok(rows);
      } catch (err) {
        return fail(err);
      }
    },
  );

  async function quizStatus(q: Quiz): Promise<Record<string, unknown>> {
    try {
      const [attempts, best] = await Promise.all([
        client.call<{ attempts: QuizAttempt[] }>("mod_quiz_get_user_attempts", { quizid: q.id, status: "all", includepreviews: false }),
        client
          .call<{ hasgrade: boolean; grade?: number }>("mod_quiz_get_user_best_grade", { quizid: q.id })
          .catch(() => ({ hasgrade: false }) as { hasgrade: boolean; grade?: number }),
      ]);
      const list = attempts.attempts ?? [];
      const last = list[list.length - 1];
      return compact({
        status: list.length === 0 ? "belum dikerjakan" : (QUIZ_STATE[last.state] ?? last.state),
        jumlah_percobaan: list.length,
        selesai_pada: last ? fmtTime(last.timefinish) : undefined,
        nilai_terbaik: best.hasgrade ? best.grade : undefined,
      });
    } catch (err) {
      return { status: `tidak bisa dibaca (${(err as Error).message})` };
    }
  }

  // 5. Tugas
  server.registerTool(
    "ut_daftar_tugas",
    {
      title: "Daftar tugas",
      description:
        "Daftar tugas (assignment): judul, tenggat, batas akhir, status pengiriman & penilaian. Hanya membaca; pengumpulan tetap manual.",
      inputSchema: {
        course_id: z.number().int().optional().describe("kosongkan untuk semua mata kuliah aktif"),
        sertakan_status: z.boolean().default(true).describe("ambil status pengiriman (1 request tambahan per tugas)"),
      },
      annotations: READ_ONLY,
    },
    async ({ course_id, sertakan_status }) => {
      try {
        const assignments = await fetchAssignments(course_id);
        const rows = await mapLimit(assignments, 4, async ({ a, courseName }) => {
          const base = compact({
            assign_id: a.id,
            cmid: a.cmid,
            mata_kuliah: courseName,
            judul: a.name,
            dibuka: fmtTime(a.allowsubmissionsfromdate),
            tenggat: fmtTime(a.duedate),
            sisa_waktu: relativeDue(a.duedate),
            batas_akhir: fmtTime(a.cutoffdate),
            url: `${client.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
          });
          if (!sertakan_status) return base;
          return { ...base, ...summarizeStatus(await submissionStatus(a.id)) };
        });
        return ok(rows);
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 6. Detail tugas
  server.registerTool(
    "ut_detail_tugas",
    {
      title: "Detail tugas",
      description:
        "Instruksi lengkap satu tugas: soal/deskripsi, lampiran, tipe pengiriman yang diterima, tenggat, status, dan umpan balik tutor bila sudah dinilai.",
      inputSchema: {
        assign_id: z.number().int().optional().describe("assign_id dari ut_daftar_tugas"),
        cmid: z.number().int().optional().describe("atau cmid (angka id= di URL mod/assign/view.php)"),
        course_id: z.number().int().optional().describe("opsional, mempercepat pencarian"),
      },
      annotations: READ_ONLY,
    },
    async ({ assign_id, cmid, course_id }) => {
      try {
        if (assign_id === undefined && cmid === undefined) throw new Error("Isi assign_id atau cmid.");
        const all = await fetchAssignments(course_id);
        const hit = all.find(({ a }) => a.id === assign_id || a.cmid === cmid);
        if (!hit) throw new Error("Tugas tidak ditemukan di mata kuliah aktif. Coba isi course_id.");
        const { a, courseName } = hit;
        const status = await submissionStatus(a.id);
        const cfg = (plugin: string, name: string) =>
          a.configs?.find((c) => c.subtype === "assignsubmission" && c.plugin === plugin && c.name === name)?.value;
        const accepts = [
          cfg("onlinetext", "enabled") === "1" ? "teks online" : null,
          cfg("file", "enabled") === "1"
            ? `file (maks ${cfg("file", "maxfilesubmissions") ?? "?"} file${cfg("file", "filetypeslist") ? `, tipe: ${cfg("file", "filetypeslist")}` : ""})`
            : null,
        ].filter(Boolean);
        const wordLimit = cfg("onlinetext", "wordlimitenabled") === "1" ? cfg("onlinetext", "wordlimit") : undefined;
        const feedbackText = status?.feedback?.plugins
          ?.flatMap((p) => p.editorfields ?? [])
          .map((f) => htmlToText(f.text, 3000))
          .filter(Boolean)
          .join("\n\n");
        return ok(
          compact({
            assign_id: a.id,
            cmid: a.cmid,
            mata_kuliah: courseName,
            judul: a.name,
            instruksi: htmlToText(a.intro, 12000),
            lampiran: (a.introattachments ?? []).map((f) => ({ nama: f.filename, url: browserFileUrl(f.fileurl) })),
            dibuka: fmtTime(a.allowsubmissionsfromdate),
            tenggat: fmtTime(a.duedate),
            sisa_waktu: relativeDue(a.duedate),
            batas_akhir: fmtTime(a.cutoffdate),
            nilai_maks: a.grade && a.grade > 0 ? a.grade : undefined,
            bentuk_pengiriman: accepts,
            batas_kata: wordLimit,
            ...summarizeStatus(status),
            nilai: status?.feedback?.gradefordisplay ? htmlToText(status.feedback.gradefordisplay) : undefined,
            umpan_balik_tutor: feedbackText,
            url: `${client.baseUrl}/mod/assign/view.php?id=${a.cmid}`,
            catatan: "Pengumpulan dilakukan manual oleh mahasiswa lewat URL di atas.",
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  async function fetchAssignments(courseId?: number): Promise<{ a: Assignment; courseName: string }[]> {
    const { ids, names } = await resolveCourseIds(courseId);
    if (ids.length === 0) return [];
    const res = await client.call<{ courses: { id: number; fullname: string; assignments: Assignment[] }[] }>(
      "mod_assign_get_assignments",
      { courseids: ids },
    );
    return res.courses.flatMap((c) => c.assignments.map((a) => ({ a, courseName: names.get(c.id) ?? c.fullname })));
  }

  async function submissionStatus(assignId: number): Promise<SubmissionStatus | undefined> {
    try {
      return await client.call<SubmissionStatus>("mod_assign_get_submission_status", { assignid: assignId });
    } catch {
      return undefined;
    }
  }

  // 7. Tenggat mendatang
  server.registerTool(
    "ut_tenggat_mendatang",
    {
      title: "Tenggat mendatang",
      description: "Semua tenggat (tugas, kuis, diskusi) dalam N hari ke depan dari kalender elearning, urut dari yang terdekat.",
      inputSchema: {
        hari: z.number().int().min(1).max(120).default(14).describe("rentang hari ke depan"),
        sertakan_terlewat: z.boolean().default(false).describe("sertakan yang sudah lewat 7 hari terakhir"),
      },
      annotations: READ_ONLY,
    },
    async ({ hari, sertakan_terlewat }) => {
      try {
        const now = Math.floor(Date.now() / 1000);
        const res = await client.call<{ events: ActionEvent[] }>("core_calendar_get_action_events_by_timesort", {
          timesortfrom: sertakan_terlewat ? now - 7 * 86400 : now,
          timesortto: now + hari * 86400,
          limitnum: 50,
        });
        return ok(
          res.events.map((e) =>
            compact({
              judul: e.name,
              jenis: e.modulename,
              mata_kuliah: e.course?.fullname,
              waktu: fmtTime(e.timestart),
              sisa_waktu: relativeDue(e.timestart),
              terlambat: e.overdue || undefined,
              perlu_tindakan: e.action?.actionable ? e.action.name : undefined,
              url: e.url,
            }),
          ),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 8. Halaman materi (mod_page)
  server.registerTool(
    "ut_baca_halaman",
    {
      title: "Baca halaman materi",
      description: "Baca isi teks aktivitas bertipe Halaman (page), misalnya pengantar sesi atau materi pengayaan.",
      inputSchema: {
        course_id: z.number().int(),
        cmid: z.number().int().describe("id aktivitas page dari ut_isi_mata_kuliah"),
      },
      annotations: READ_ONLY,
    },
    async ({ course_id, cmid }) => {
      try {
        const res = await client.call<{ pages: Page[] }>("mod_page_get_pages_by_courses", { courseids: [course_id] });
        const p = res.pages.find((x) => x.coursemodule === cmid);
        if (!p) throw new Error(`Halaman dengan cmid ${cmid} tidak ditemukan di mata kuliah ${course_id}.`);
        return ok(
          compact({
            judul: p.name,
            pengantar: htmlToText(p.intro, 2000),
            isi: htmlToText(p.content, 20000),
            diperbarui: fmtTime(p.timemodified),
            url: `${client.baseUrl}/mod/page/view.php?id=${p.coursemodule}`,
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );

  // 9. Diskusi (forum) — hanya membaca topik
  server.registerTool(
    "ut_daftar_diskusi",
    {
      title: "Topik diskusi",
      description:
        "Baca forum diskusi mata kuliah dan topik/soal diskusinya (postingan pembuka). Tanpa forum_cmid: daftar forum. Dengan forum_cmid: daftar topik di forum itu. Tidak bisa memposting.",
      inputSchema: {
        course_id: z.number().int(),
        forum_cmid: z.number().int().optional().describe("cmid forum dari daftar forum atau ut_isi_mata_kuliah"),
      },
      annotations: READ_ONLY,
    },
    async ({ course_id, forum_cmid }) => {
      try {
        const forums = await client.call<Forum[]>("mod_forum_get_forums_by_courses", { courseids: [course_id] });
        if (forum_cmid === undefined) {
          return ok(
            forums.map((f) =>
              compact({
                forum_cmid: f.cmid,
                judul: f.name,
                deskripsi: htmlToText(f.intro, 1000),
                jumlah_topik: f.numdiscussions,
                tenggat: fmtTime(f.duedate),
                url: `${client.baseUrl}/mod/forum/view.php?id=${f.cmid}`,
              }),
            ),
          );
        }
        const forum = forums.find((f) => f.cmid === forum_cmid);
        if (!forum) throw new Error(`Forum dengan cmid ${forum_cmid} tidak ditemukan.`);
        const res = await client.call<{ discussions: Discussion[] }>("mod_forum_get_forum_discussions", {
          forumid: forum.id,
          sortorder: -1,
          page: 0,
          perpage: 30,
        });
        return ok(
          compact({
            forum: forum.name,
            deskripsi: htmlToText(forum.intro, 2000),
            tenggat: fmtTime(forum.duedate),
            topik: res.discussions.map((d) =>
              compact({
                judul: d.name,
                oleh: d.userfullname,
                dibuat: fmtTime(d.created),
                balasan: d.numreplies,
                disematkan: d.pinned || undefined,
                isi: htmlToText(d.message, 5000),
                url: `${client.baseUrl}/mod/forum/discuss.php?d=${d.discussion}`,
              }),
            ),
          }),
        );
      } catch (err) {
        return fail(err);
      }
    },
  );
}

function summarizeStatus(s: SubmissionStatus | undefined): Record<string, unknown> {
  if (!s) return { status: "tidak bisa dibaca" };
  const la = s.lastattempt;
  const sub = la?.submission ?? la?.teamsubmission;
  return compact({
    status: sub ? (SUBMISSION_STATUS[sub.status] ?? sub.status) : "belum dikirim",
    terakhir_diubah: fmtTime(sub?.timemodified),
    status_penilaian: la?.gradingstatus === "graded" ? "sudah dinilai" : la?.gradingstatus === "notgraded" ? "belum dinilai" : la?.gradingstatus,
    perpanjangan_tenggat: fmtTime(la?.extensionduedate ?? undefined),
    terkunci: la?.locked || undefined,
  });
}

const MODNAME: Record<string, string> = {
  resource: "file",
  url: "tautan",
  page: "halaman",
  label: "label",
  quiz: "kuis",
  assign: "tugas",
  forum: "diskusi",
  folder: "folder",
  book: "buku",
  attendance: "presensi",
  h5pactivity: "H5P",
  lesson: "pelajaran",
};

function describeModule(m: CourseModule, withDesc: boolean) {
  const dates = (m.dates ?? []).map((d) => `${d.label} ${fmtTime(d.timestamp)}`);
  return compact({
    cmid: m.id,
    jenis: MODNAME[m.modname] ?? m.modname,
    judul: m.modname === "label" ? undefined : m.name,
    deskripsi: withDesc || m.modname === "label" ? htmlToText(m.description, 1500) : undefined,
    tanggal: dates,
    selesai: m.completiondata ? m.completiondata.state > 0 : undefined,
    terkunci: m.uservisible === false ? htmlToText(m.availabilityinfo) || "ya" : undefined,
    url: m.url,
    file: (m.contents ?? [])
      .filter((c) => c.type === "file")
      .slice(0, 10)
      .map((c) => compact({ nama: c.filename, url: browserFileUrl(c.fileurl) })),
    tautan_luar: m.modname === "url" ? m.contents?.find((c) => c.type === "url")?.fileurl : undefined,
  });
}
