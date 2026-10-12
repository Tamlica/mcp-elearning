import { MoodleClient } from "./moodle.js";
import { setTimeZone } from "./format.js";

/** Baca konfigurasi dari environment. Token tidak pernah ditulis ke disk atau log. */
export function clientFromEnv(): MoodleClient {
  const baseUrl = process.env.MOODLE_BASE_URL || "https://elearning.ut.ac.id";
  const token = process.env.MOODLE_TOKEN;
  if (!token) {
    throw new Error(
      "MOODLE_TOKEN belum diisi. Ambil token di elearning (Profil > Preferensi > Kunci keamanan) lalu isi di konfigurasi MCP.",
    );
  }
  if (process.env.MOODLE_TIMEZONE) setTimeZone(process.env.MOODLE_TIMEZONE);
  const timeoutMs = Number(process.env.MOODLE_TIMEOUT_MS) || 20000;
  return new MoodleClient({ baseUrl, token, timeoutMs });
}
