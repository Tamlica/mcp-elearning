/**
 * Klien Moodle Web Services (REST) yang HANYA bisa memanggil fungsi baca.
 *
 * Pengaman utama ada di ALLOWED_FUNCTIONS: fungsi apa pun di luar daftar ini
 * ditolak sebelum request dikirim, jadi server ini tidak mungkin mengirim
 * tugas, memulai/menyimpan percobaan kuis, menulis forum, dsb.
 */

export const ALLOWED_FUNCTIONS = new Set<string>([
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_course_get_contents",
  "core_calendar_get_action_events_by_timesort",
  "mod_quiz_get_quizzes_by_courses",
  "mod_quiz_get_user_attempts",
  "mod_quiz_get_user_best_grade",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "mod_page_get_pages_by_courses",
  "mod_forum_get_forums_by_courses",
  "mod_forum_get_forum_discussions",
]);

/** Pola nama fungsi yang menulis/mengubah data. Lapisan pengaman kedua. */
const WRITE_PATTERN =
  /(save|submit|start|process|update|create|add|delete|remove|set|view_|launch|mark|upload|send|lock|reveal|copy|prepare)/i;

export class MoodleError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly wsfunction?: string,
  ) {
    super(message);
    this.name = "MoodleError";
  }
}

type Scalar = string | number | boolean;
export type Params = { [key: string]: Scalar | Scalar[] | Params | Params[] | undefined };

/** Ubah objek bersarang ke format form Moodle: courseids[0]=1, options[0][name]=x */
export function flattenParams(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item !== null && typeof item === "object") flattenParams(item as Params, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (value !== null && typeof value === "object") {
      flattenParams(value as Params, name, out);
    } else {
      out.append(name, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
  }
  return out;
}

export interface MoodleClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class MoodleClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private siteInfoCache?: SiteInfo;

  constructor(opts: MoodleClientOptions) {
    const url = new URL(opts.baseUrl);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !isLocal) {
      throw new MoodleError("MOODLE_BASE_URL harus memakai https:// agar token tidak bocor.");
    }
    this.baseUrl = url.toString().replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async call<T = unknown>(wsfunction: string, params: Params = {}): Promise<T> {
    if (!ALLOWED_FUNCTIONS.has(wsfunction) || (WRITE_PATTERN.test(wsfunction) && !wsfunction.includes("_get_"))) {
      throw new MoodleError(`Fungsi ${wsfunction} diblokir: server ini read-only.`, "blocked", wsfunction);
    }
    const body = flattenParams(params);
    body.set("wstoken", this.token);
    body.set("wsfunction", wsfunction);
    body.set("moodlewsrestformat", "json");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/webservice/rest/server.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: ctrl.signal,
      });
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? `timeout setelah ${this.timeoutMs} ms` : (err as Error).message;
      throw new MoodleError(`Gagal menghubungi ${this.baseUrl}: ${msg}`, "network", wsfunction);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    if (!res.ok) {
      throw new MoodleError(`HTTP ${res.status} dari ${wsfunction}`, `http_${res.status}`, wsfunction);
    }
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new MoodleError(
        `Respons ${wsfunction} bukan JSON (mungkin halaman login/maintenance). Awal respons: ${text.slice(0, 120)}`,
        "not_json",
        wsfunction,
      );
    }
    if (data && typeof data === "object" && "exception" in data) {
      const e = data as { message?: string; errorcode?: string };
      throw new MoodleError(explainError(e.errorcode, e.message, wsfunction), e.errorcode, wsfunction);
    }
    return data as T;
  }

  async siteInfo(): Promise<SiteInfo> {
    if (!this.siteInfoCache) {
      this.siteInfoCache = await this.call<SiteInfo>("core_webservice_get_site_info");
    }
    return this.siteInfoCache;
  }
}

function explainError(code: string | undefined, message: string | undefined, fn: string): string {
  const base = `${fn}: ${message ?? "error tanpa pesan"} (${code ?? "?"})`;
  switch (code) {
    case "invalidtoken":
      return `${base}. Token salah atau kedaluwarsa; buat ulang di halaman Kunci keamanan.`;
    case "accessexception":
    case "webservicenotavailable":
      return `${base}. Fungsi ini tidak diizinkan untuk token/layanan kamu di elearning UT.`;
    case "servicerequireslogin":
    case "requireloginerror":
      return `${base}. Sesi/token tidak valid untuk mata kuliah ini.`;
    default:
      return base;
  }
}

// --- Tipe minimal respons Moodle yang dipakai ---

export interface SiteInfo {
  sitename: string;
  username: string;
  fullname: string;
  userid: number;
  siteurl: string;
  release?: string;
  version?: string;
  functions?: { name: string; version: string }[];
}

export interface Course {
  id: number;
  shortname: string;
  fullname: string;
  idnumber?: string;
  visible?: number;
  startdate?: number;
  enddate?: number;
  progress?: number | null;
  completed?: boolean;
  lastaccess?: number | null;
}

export interface ModuleDate {
  label: string;
  timestamp: number;
  dataid?: string;
}

export interface CourseModule {
  id: number;
  name: string;
  modname: string;
  instance?: number;
  url?: string;
  description?: string;
  visible?: number;
  uservisible?: boolean;
  availabilityinfo?: string;
  dates?: ModuleDate[];
  completiondata?: { state: number; timecompleted?: number };
  contents?: { type: string; filename: string; fileurl?: string; mimetype?: string; filesize?: number; timemodified?: number }[];
}

export interface Section {
  id: number;
  name: string;
  section: number;
  summary?: string;
  visible?: number;
  uservisible?: boolean;
  availabilityinfo?: string;
  modules: CourseModule[];
}

export interface Quiz {
  id: number;
  coursemodule: number;
  course: number;
  name: string;
  intro?: string;
  timeopen?: number;
  timeclose?: number;
  timelimit?: number;
  attempts?: number;
  grade?: number;
  sumgrades?: number;
}

export interface QuizAttempt {
  id: number;
  attempt: number;
  state: string;
  timestart?: number;
  timefinish?: number;
  sumgrades?: number | null;
}

export interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  intro?: string;
  duedate?: number;
  allowsubmissionsfromdate?: number;
  cutoffdate?: number;
  gradingduedate?: number;
  grade?: number;
  introattachments?: { filename: string; fileurl: string; mimetype?: string }[];
  configs?: { plugin: string; subtype: string; name: string; value: string }[];
}

export interface SubmissionStatus {
  lastattempt?: {
    submission?: { status: string; timemodified?: number };
    teamsubmission?: { status: string; timemodified?: number };
    submissionsenabled?: boolean;
    locked?: boolean;
    graded?: boolean;
    canedit?: boolean;
    gradingstatus?: string;
    extensionduedate?: number | null;
  };
  feedback?: {
    gradefordisplay?: string;
    gradeddate?: number;
    plugins?: { type: string; editorfields?: { text: string }[] }[];
  };
}

export interface ActionEvent {
  id: number;
  name: string;
  modulename?: string;
  instance?: number;
  timestart: number;
  course?: { id: number; fullname: string; shortname?: string };
  url?: string;
  action?: { name: string; actionable: boolean } | null;
  overdue?: boolean;
}

export interface Page {
  id: number;
  coursemodule: number;
  course: number;
  name: string;
  intro?: string;
  content?: string;
  timemodified?: number;
}

export interface Forum {
  id: number;
  course: number;
  cmid: number;
  name: string;
  intro?: string;
  type?: string;
  duedate?: number;
  cutoffdate?: number;
  numdiscussions?: number;
}

export interface Discussion {
  id: number;
  discussion: number;
  name: string;
  subject?: string;
  message?: string;
  userfullname?: string;
  created?: number;
  timemodified?: number;
  numreplies?: number;
  pinned?: boolean;
}
