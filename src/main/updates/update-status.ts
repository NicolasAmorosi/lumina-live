import type { UpdateErrorCode, UpdateStatus, UpdateStep } from "@shared/types/updates";

/** The pure half of `updater.ts`: nothing here imports `electron`. */

/** Chromium's and Node's ways of saying "no network". Checked against the
 *  message before the updater's own codes: `ERR_UPDATER_LATEST_VERSION_NOT_FOUND`
 *  wraps an offline machine too («…please ensure a production release exists:
 *  net::ERR_INTERNET_DISCONNECTED»). */
const OFFLINE =
  /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|CONNECTION_\w+|TIMED_OUT|NETWORK_\w+|ADDRESS_UNREACHABLE|PROXY_\w+)|\bE(NOTFOUND|CONNREFUSED|CONNRESET|TIMEDOUT|AI_AGAIN|NETUNREACH)\b/;

/** The release exists but does not carry what this build asks for — e.g. the
 *  `latest*.yml` of a release published before the app could update itself. */
const NOT_PUBLISHED = new Set([
  "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
  "ERR_UPDATER_LATEST_VERSION_NOT_FOUND",
  "ERR_UPDATER_NO_PUBLISHED_VERSIONS",
  "ERR_UPDATER_RELEASE_NOT_FOUND",
  "ERR_UPDATER_ASSET_NOT_FOUND",
  "ERR_UPDATER_NO_FILES_PROVIDED",
]);

export function updateErrorCode(error: unknown, during: UpdateStep): UpdateErrorCode {
  if (during === "install") return "install";
  const { code, statusCode, message } = (error ?? {}) as { code?: unknown; statusCode?: unknown; message?: unknown };
  if (OFFLINE.test(String(message ?? error))) return "offline";
  if (code === "ERR_CHECKSUM_MISMATCH") return "checksum";
  if ((typeof code === "string" && NOT_PUBLISHED.has(code)) || statusCode === 404) return "notPublished";
  return "unknown";
}

/** A failed launch check is not the operator's business — it goes to
 *  `main.log` only, and the app looks as if it never checked. Everything the
 *  operator asked for (a «Check now», a download, an install) says how it
 *  failed. */
export function statusForError(error: unknown, during: UpdateStep, asked: boolean): UpdateStatus {
  return asked ? { kind: "error", code: updateErrorCode(error, during), during } : { kind: "idle" };
}

export function shouldCheckOnLaunch(autoCheck: boolean, argv: readonly string[]): boolean {
  return autoCheck && !argv.includes("--no-update-check");
}

/** The installer of a release's `latest*.yml` with this extension — the
 *  `.dmg`, which macOS downloads by itself instead of through Squirrel. */
export function installerFile<T extends { url: string }>(files: readonly T[], extension: string): T | null {
  return files.find((file) => file.url.toLowerCase().endsWith(extension)) ?? null;
}

/**
 * `WORSHIP_UPDATE_FEED_URL`, the E2E suite's fake update server — honoured only
 * on this machine's loopback. Whoever can set a variable in the app's
 * environment already runs code as that user, but the hook is still kept from
 * ever pointing a real install at another host.
 */
export function loopbackFeedUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    return loopback && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null;
  } catch {
    return null;
  }
}
