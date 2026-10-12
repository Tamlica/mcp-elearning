/** Utilitas format: HTML Moodle -> teks, timestamp -> waktu lokal (WIB). */

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
};

export function htmlToText(html: string | undefined | null, maxLen = 4000): string {
  if (!html) return "";
  let s = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol)>/gi, "\n")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, "").trim();
      return text && text !== href ? `${text} (${href})` : href;
    })
    .replace(/<img\s[^>]*alt="([^"]*)"[^>]*>/gi, (_m, alt: string) => (alt ? `[gambar: ${alt}]` : "[gambar]"))
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e] ?? e)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+- /g, "\n- ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (s.length > maxLen) s = `${s.slice(0, maxLen)}… [dipotong, ${s.length - maxLen} karakter lagi]`;
  return s;
}

let timeZone = process.env.MOODLE_TIMEZONE || "Asia/Jakarta";
export function setTimeZone(tz: string): void {
  timeZone = tz;
}

/** Moodle memakai detik Unix; 0 berarti "tidak diatur". */
export function fmtTime(ts: number | undefined | null): string | null {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  const local = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return `${local} (${timeZone})`;
}

export function relativeDue(ts: number | undefined | null, now = Date.now()): string | null {
  if (!ts) return null;
  const diffH = (ts * 1000 - now) / 3_600_000;
  if (diffH < 0) {
    const h = -diffH;
    return h < 48 ? `lewat ${Math.round(h)} jam lalu` : `lewat ${Math.round(h / 24)} hari lalu`;
  }
  return diffH < 48 ? `${Math.round(diffH)} jam lagi` : `${Math.round(diffH / 24)} hari lagi`;
}

export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Hapus token dari URL file agar tidak ikut tampil di percakapan. */
export function stripToken(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("token");
    u.searchParams.delete("wstoken");
    return u.toString();
  } catch {
    return url;
  }
}
