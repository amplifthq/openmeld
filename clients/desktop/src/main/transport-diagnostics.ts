import { createHmac, randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DesktopTransportDiagnosticEvent,
  desktopTransportDiagnosticsSchema,
} from "@openmeld/schemas";

type Outcome = Extract<
  DesktopTransportDiagnosticEvent,
  { kind: "request" }
>["outcome"];
export type TransportObservation =
  | {
      kind: "request";
      pathname: string;
      method: string;
      outcome: Outcome;
      status?: number;
      requestId?: string | null;
      elapsedMs: number;
    }
  | {
      kind: "stream";
      spaceId: string;
      event:
        | "connecting"
        | "open"
        | "error"
        | "close"
        | "cancelled"
        | "admission";
      code?: number;
    };

// Only route templates leave the request boundary. Never retain URL queries,
// arbitrary path segments, response bodies, exception text, or socket messages.
const ROUTES = [
  /^\/v1\/inbox(?:\/(summary|items|attention|preferences|feed(?:\/state)?|message-notification-preferences|center-agent\/summary|spaces\/summary))?(?:\/[^/]+)?$/u,
  /^\/v1\/account\/(session|memberships|organizations|profiles|spaces(?:\/active-wake-summary)?)$/u,
  /^\/v1\/profiles\/[^/]+\/(spaces)$/u,
  /^\/v1\/spaces\/[^/]+\/(members|viewer-membership|signals|threads|stream|live|snapshot|conversation|conversations)$/u,
  /^\/v1\/organizations\/[^/]+\/(members|profiles|spaces|conversations)$/u,
  /^\/v1\/(people-computers|agent-profiles)(?:\/[^/]+)?$/u,
];
const REQUEST_ID = /^[a-zA-Z0-9-]{8,80}$/u;
export function diagnosticRoute(pathname: string) {
  for (const pattern of ROUTES) {
    const match = pattern.exec(pathname);
    if (!match) {
      continue;
    }
    if (pathname.startsWith("/v1/spaces/")) {
      return `/v1/spaces/:space/${match[1]}`;
    }
    if (pathname.startsWith("/v1/organizations/")) {
      return `/v1/organizations/:organization/${match[1]}`;
    }
    if (pathname.startsWith("/v1/inbox")) {
      return `/v1/inbox${match[1] ? `/${match[1]}` : ""}`;
    }
    if (pathname.startsWith("/v1/account/")) {
      return `/v1/account/${match[1]}`;
    }
    if (pathname.startsWith("/v1/profiles/")) {
      return "/v1/profiles/:profile/spaces";
    }
    return `/v1/${match[1]}/:id`;
  }
  return "unclassified";
}

/** Main-owned, bounded local evidence. Recording cannot change request behavior. */
export function createTransportDiagnostics(input: {
  directory: string;
  version: string;
  webBuild: string;
}) {
  const salt = randomBytes(32);
  const events: Record<string, unknown>[] = [];
  let writing: Promise<void> | undefined;
  let dirty = false;
  let warned = false;
  const flush = (): Promise<void> => {
    writing ??= (async () => {
      try {
        await mkdir(input.directory, { recursive: true, mode: 0o700 });
        while (dirty) {
          dirty = false;
          const path = join(input.directory, "transport.json");
          const record = desktopTransportDiagnosticsSchema.safeParse({
            format: 1,
            version: input.version,
            webBuild: input.webBuild,
            events,
          });
          if (!record.success) {
            throw new Error("Invalid transport diagnostic record.");
          }
          await writeFile(`${path}.tmp`, JSON.stringify(record.data), {
            mode: 0o600,
          });
          await rename(`${path}.tmp`, path);
        }
      } catch {
        if (!warned) {
          console.warn("Desktop transport diagnostics could not be saved.");
        }
        warned = true;
      }
    })().finally(() => {
      writing = undefined;
    });
    return writing;
  };
  return {
    record(observation: TransportObservation) {
      const common = { at: new Date().toISOString(), kind: observation.kind };
      if (observation.kind === "request") {
        events.push({
          ...common,
          route: diagnosticRoute(observation.pathname),
          method: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(
            observation.method
          )
            ? observation.method
            : "other",
          outcome: observation.outcome,
          status: observation.status,
          requestId:
            observation.requestId && REQUEST_ID.test(observation.requestId)
              ? observation.requestId
              : undefined,
          elapsedMs: Math.max(0, Math.round(observation.elapsedMs)),
        });
      } else {
        events.push({
          ...common,
          event: observation.event,
          code: observation.code,
          // Correlates reconnects within this app run without retaining Space IDs.
          stream: createHmac("sha256", salt)
            .update(observation.spaceId)
            .digest("hex")
            .slice(0, 16),
        });
      }
      events.splice(0, Math.max(0, events.length - 200));
      dirty = true;
      flush();
    },
    flush,
  };
}
