const PROJECT_SLUG_MAX_CHARS = 80;
const COMBINING_MARK_PATTERN = /\p{M}+/gu;
const NON_ASCII_ALPHANUMERIC_PATTERN = /[^a-z0-9]+/gu;
const SURROUNDING_HYPHEN_PATTERN = /^-+|-+$/gu;
const SCP_REMOTE_PATTERN = /^(?:[^@/\s]+@)?(?<host>[^:/\s]+):(?<path>.+)$/u;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|\\\\)/u;
const FILE_PROTOCOL_PATTERN = /^file:/iu;
const SURROUNDING_SLASH_PATTERN = /^\/+|\/+$/gu;
const GIT_SUFFIX_PATTERN = /\.git$/iu;
const QUERY_OR_FRAGMENT_PATTERN = /[?#]/u;
const NETWORK_PROTOCOLS = new Set(["git:", "http:", "https:", "ssh:"]);
const CASE_INSENSITIVE_REPOSITORY_HOSTS = new Set([
  "bitbucket.org",
  "github.com",
  "gitlab.com",
]);

export function generateProjectSlug(name: string): string;
export function generateProjectSlug(
  name: string,
  sequence: number
): string | null;
export function generateProjectSlug(name: string, sequence = 1): string | null {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 99) {
    return null;
  }
  const base =
    name
      .trim()
      .normalize("NFKD")
      .replace(COMBINING_MARK_PATTERN, "")
      .toLowerCase()
      .replace(NON_ASCII_ALPHANUMERIC_PATTERN, "-")
      .replace(SURROUNDING_HYPHEN_PATTERN, "") || "project";
  const suffix = sequence === 1 ? "" : `-${sequence}`;
  const truncatedBase = base
    .slice(0, PROJECT_SLUG_MAX_CHARS - suffix.length)
    .replace(SURROUNDING_HYPHEN_PATTERN, "");
  return `${truncatedBase || "project"}${suffix}`;
}

export function normalizeRepositoryRemote(value: string): string | null {
  const remote = value.trim();
  if (
    !remote ||
    FILE_PROTOCOL_PATTERN.test(remote) ||
    remote.startsWith("/") ||
    remote.startsWith("\\") ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(remote)
  ) {
    return null;
  }

  if (!remote.includes("://")) {
    const scp = SCP_REMOTE_PATTERN.exec(remote);
    if (!scp?.groups) {
      return null;
    }
    const { host, path } = scp.groups;
    return host && path ? normalizeNetworkRepository(host, path) : null;
  }

  try {
    const url = new URL(remote);
    if (!NETWORK_PROTOCOLS.has(url.protocol)) {
      return null;
    }
    return normalizeNetworkRepository(url.host, decodeURI(url.pathname));
  } catch {
    return null;
  }
}

export async function buildRepositoryFingerprint(
  value: string
): Promise<string | null> {
  const normalized = normalizeRepositoryRemote(value);
  if (!normalized) {
    return null;
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized)
  );
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")}`;
}

export function buildCanonicalRepositoryUrl(value: string): string | null {
  const normalized = normalizeRepositoryRemote(value);
  return normalized ? `https://${normalized}` : null;
}

function normalizeNetworkRepository(
  rawHost: string,
  rawPath: string
): string | null {
  const host = rawHost.trim().toLowerCase();
  const hostname = host.startsWith("[")
    ? host.slice(0, host.indexOf("]") + 1)
    : host.split(":", 1)[0];
  let path = (rawPath.split(QUERY_OR_FRAGMENT_PATTERN, 1)[0] ?? "")
    .trim()
    .replace(SURROUNDING_SLASH_PATTERN, "")
    .replace(GIT_SUFFIX_PATTERN, "")
    .normalize("NFC");
  if (hostname && CASE_INSENSITIVE_REPOSITORY_HOSTS.has(hostname)) {
    path = path.toLowerCase();
  }
  return host && path ? `${host}/${path}` : null;
}
