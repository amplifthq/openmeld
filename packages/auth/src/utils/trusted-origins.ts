import type { AuthWorkerNodeEnv } from "./config-validator";

const LOCAL_DEV_ORIGINS = [
  "http://localhost:3000",
  "https://localhost:3000",
  "http://127.0.0.1:3000",
  "https://127.0.0.1:3000",
  "http://localhost:8788",
  "https://localhost:8788",
  "http://127.0.0.1:8788",
  "https://127.0.0.1:8788",
] as const;

export type ResolveTrustedOriginsInput = {
  baseAuthUrl: string;
  appUrl: string;
  env: AuthWorkerNodeEnv;
  request?: Request;
};

export function resolveTrustedOrigins(
  input: ResolveTrustedOriginsInput
): string[] {
  const origins = new Set<string>();

  addOrigin(origins, input.baseAuthUrl);
  addOrigin(origins, input.appUrl);

  if (input.env === "development") {
    addConfiguredLoopbackAliases(origins, input.appUrl);
    for (const origin of LOCAL_DEV_ORIGINS) {
      origins.add(origin);
    }

    if (input.request) {
      addOrigin(origins, input.request.headers.get("origin") ?? undefined);
      addOrigin(origins, input.request.headers.get("referer") ?? undefined);
    }
  }

  return Array.from(origins);
}

function addConfiguredLoopbackAliases(
  origins: Set<string>,
  appUrl: string
): void {
  const origin = normalizeToOrigin(appUrl);
  if (!origin) {
    return;
  }
  const url = new URL(origin);
  if (
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "[::1]" &&
    !url.hostname.endsWith(".localhost")
  ) {
    return;
  }
  // Derive aliases from trusted configuration, never from the request's Origin.
  // Preserve its port so another worktree does not gain cookie-write access.
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    url.hostname = hostname;
    origins.add(url.origin);
  }
}

function addOrigin(origins: Set<string>, value: string | undefined): void {
  const origin = normalizeToOrigin(value);
  if (origin) {
    origins.add(origin);
  }
}

function normalizeToOrigin(value: string | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}
