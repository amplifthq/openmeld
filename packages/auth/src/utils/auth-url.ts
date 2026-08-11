import { DEFAULT_AUTH_BASE_URL } from "../configs/constants";

export function normalizeAuthBaseUrl(
  value: string | undefined,
  fallback = DEFAULT_AUTH_BASE_URL
): string {
  const raw = String(value ?? "").trim() || fallback;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid BETTER_AUTH_URL: ${raw}`);
  }

  if (!(parsed.protocol === "https:" || parsed.protocol === "http:")) {
    throw new Error(`BETTER_AUTH_URL must use http/https: ${raw}`);
  }

  const normalized = parsed.toString();
  return normalized.endsWith("/")
    ? normalized.slice(0, normalized.length - 1)
    : normalized;
}
