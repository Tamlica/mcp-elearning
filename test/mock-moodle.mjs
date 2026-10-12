// Server Moodle tiruan untuk pengujian. Data fiktif, bukan data elearning UT asli.
import http from "node:http";

const now = Math.floor(Date.now() / 1000);
const day = 86400;
export const TOKEN = "mock-token-123";

const fixtures = {
  core_webservice_get_site_info: () => ({
    sitename: "Elearning UT (MOCK)", username: "056254994", fullname: "TAMLICA MUHAIMIN", userid: 42,
    siteurl: "http://localhost", release: "4.1.9 (Build: 20240212)",
    functions: [
      "core_webservice_get_site_info", "core_enrol_get_users_courses", "core_course_get_contents",
      "core_calendar_get_action_events_by_timesort", "mod_quiz_get_quizzes_by_courses", "mod_quiz_get_user_attempts",
      "mod_quiz_get_user_best_grade", "mod_assign_get_assignments", "mod_assign_get_submission_status",
      "mod_page_get_pages_by_courses", "mod_forum_get_forums_by_courses",
    ].map((name) => ({ name, version: "1" })),
  }),
  core_enrol_get_users_courses: (p) => {
    if (p.userid !== "42") throw { errorcode: "invaliduser", message: "bad user" };
    return [
      { id: 101, shortname: "STSI4208.8", fullname: "Analisis dan Perancangan Sistem", visible: 1, startdate: now - 30 * day, enddate: now + 60 * day, progress: 25 },
      { id: 102, shortname: "STSI4206.22", fullname: "Proses Bisnis", visible: 1, startdate: now - 30 * day, enddate: 0, progress: null },
      { id: 90, shortname: "STMA4113.11", fullname: "Aljabar Linear", visible: 1, startdate: now - 200 * day, enddate: now - 100 * day },
    ];
  },
  core_course_get_contents: (p) => [
    { id: 1, section: 0, name: "Umum", summary: "<p>Selamat datang di tuton &amp; semangat!</p>", modules: [
      { id: 500, name: "Forum Berita", modname: "forum", visible: 1, url: "http://localhost/mod/forum/view.php?id=500" },
    ]},
    { id: 2, section: 1, name: "Sesi 1", summary: "<p>Konsep dasar sistem</p>", modules: [
      { id: 510, name: "Inisiasi 1", modname: "page", visible: 1, description: "<p>Baca inisiasi</p>", completiondata: { state: 1 } },
      { id: 511, name: "BMP Modul 1", modname: "resource", visible: 1, contents: [
        { type: "file", filename: "modul1.pdf", fileurl: "http://localhost/webservice/pluginfile.php/1/mod_resource/content/0/modul1.pdf?forcedownload=1&token=SECRET" },
      ]},
      { id: 512, name: "Diskusi 1", modname: "forum", visible: 1, dates: [{ label: "Tenggat:", timestamp: now + 5 * day }] },
      { id: 513, name: "Label", modname: "label", visible: 1, description: "<p>Kerjakan sebelum <b>Minggu</b></p>" },
    ]},
    { id: 3, section: 3, name: "Sesi 3", summary: "", uservisible: false, availabilityinfo: "<div>Tersedia mulai 20 Oktober</div>", modules: [
      { id: 530, name: "Tugas 1", modname: "assign", visible: 1, uservisible: false },
    ]},
  ].map((s) => (p.courseid === "101" ? s : { ...s, name: `${s.name} (${p.courseid})` })),
  mod_quiz_get_quizzes_by_courses: (p) => ({
    quizzes: [
      { id: 7, coursemodule: 520, course: 101, name: "Kuis Sesi 2", intro: "<p>10 soal pilihan ganda</p>", timeopen: now - day, timeclose: now + 3 * day, timelimit: 1800, attempts: 1, grade: 10 },
      { id: 8, coursemodule: 521, course: 102, name: "Kuis Sesi 1 PB", timeopen: now - 10 * day, timeclose: now - 2 * day, timelimit: 0, attempts: 0, grade: 10 },
    ].filter((q) => Object.values(p.courseids).includes(String(q.course))),
  }),
  mod_quiz_get_user_attempts: (p) => ({ attempts: p.quizid === "8" ? [{ id: 1, attempt: 1, state: "finished", timestart: now - 3 * day, timefinish: now - 3 * day + 600 }] : [] }),
  mod_quiz_get_user_best_grade: (p) => (p.quizid === "8" ? { hasgrade: true, grade: 8.5 } : { hasgrade: false }),
  mod_assign_get_assignments: (p) => ({
    courses: [
      { id: 101, fullname: "Analisis dan Perancangan Sistem", assignments: [
        { id: 30, cmid: 530, course: 101, name: "Tugas 1", intro: "<p>Buatlah <strong>DFD level 0</strong> untuk sistem perpustakaan.</p><ol><li>Identifikasi entitas</li><li>Gambar diagram</li></ol>",
          duedate: now + 10 * day, allowsubmissionsfromdate: now - day, cutoffdate: now + 11 * day, grade: 100,
          introattachments: [{ filename: "soal-tugas1.pdf", fileurl: "http://localhost/webservice/pluginfile.php/9/mod_assign/intro/soal-tugas1.pdf?token=SECRET" }],
          configs: [
            { plugin: "file", subtype: "assignsubmission", name: "enabled", value: "1" },
            { plugin: "file", subtype: "assignsubmission", name: "maxfilesubmissions", value: "1" },
            { plugin: "file", subtype: "assignsubmission", name: "filetypeslist", value: ".pdf,.docx" },
            { plugin: "onlinetext", subtype: "assignsubmission", name: "enabled", value: "0" },
          ] },
      ]},
      { id: 102, fullname: "Proses Bisnis", assignments: [
        { id: 31, cmid: 531, course: 102, name: "Tugas 1 PB", intro: "<p>Analisis proses bisnis</p>", duedate: now - day, grade: 100, configs: [] },
      ]},
    ].filter((c) => Object.values(p.courseids).includes(String(c.id))),
  }),
  mod_assign_get_submission_status: (p) => p.assignid === "31"
    ? { lastattempt: { submission: { status: "submitted", timemodified: now - 2 * day }, gradingstatus: "graded" },
        feedback: { gradefordisplay: "85,00 / 100,00", plugins: [{ type: "comments", editorfields: [{ text: "<p>Bagus, lengkapi referensi.</p>" }] }] } }
    : { lastattempt: { submission: { status: "new" }, gradingstatus: "notgraded" } },
  core_calendar_get_action_events_by_timesort: () => ({
    events: [
      { id: 1, name: "Kuis Sesi 2 ditutup", modulename: "quiz", timestart: now + 3 * day, course: { id: 101, fullname: "Analisis dan Perancangan Sistem" }, url: "http://localhost/mod/quiz/view.php?id=520", action: { name: "Kerjakan kuis", actionable: true } },
      { id: 2, name: "Tugas 1 jatuh tempo", modulename: "assign", timestart: now + 10 * day, course: { id: 101, fullname: "Analisis dan Perancangan Sistem" }, url: "http://localhost/mod/assign/view.php?id=530", action: { name: "Tambah pengiriman", actionable: true } },
    ],
  }),
  mod_page_get_pages_by_courses: () => ({ pages: [{ id: 3, coursemodule: 510, course: 101, name: "Inisiasi 1", intro: "", content: "<h2>Pengantar</h2><p>Sistem adalah kumpulan elemen&nbsp;yang saling berinteraksi.</p>", timemodified: now - 20 * day }] }),
  mod_forum_get_forums_by_courses: () => [{ id: 4, course: 101, cmid: 512, name: "Diskusi 1", intro: "<p>Jawab pertanyaan berikut</p>", numdiscussions: 1, duedate: now + 5 * day }],
  // mod_forum_get_forum_discussions sengaja tidak ada di daftar fungsi site_info -> diuji sebagai accessexception
};

export const calls = [];

export function startMock() {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const raw = new URLSearchParams(body);
      const p = {};
      for (const [k, v] of raw) {
        const m = k.match(/^(\w+)\[(\d+)\]$/);
        if (m) (p[m[1]] ??= {})[m[2]] = v; else p[k] = v;
      }
      calls.push(p.wsfunction);
      res.setHeader("Content-Type", "application/json");
      if (req.url !== "/webservice/rest/server.php") { res.statusCode = 404; return res.end("{}"); }
      if (p.wstoken !== TOKEN) return res.end(JSON.stringify({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token - token not found" }));
      const fx = fixtures[p.wsfunction];
      if (!fx) return res.end(JSON.stringify({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" }));
      try { res.end(JSON.stringify(fx(p))); }
      catch (e) { res.end(JSON.stringify({ exception: "moodle_exception", ...e })); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
