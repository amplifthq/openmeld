const TRAILING_SLASHES_REGEX = /\/+$/;
const ROOT_PATH_REGEX = /^\/+$/;

export function normalizeApiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (!ROOT_PATH_REGEX.test(url.pathname)) {
    throw new Error("baseUrl must be origin-only (no path prefix)");
  }
  if (url.search || url.hash) {
    throw new Error("baseUrl must be origin-only (no query or hash)");
  }
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(TRAILING_SLASHES_REGEX, "");
}
