import {
  getAuthSessionState,
  type StoredAuthSession,
} from "../../config/auth-session";
import { resolveAuthBaseUrl } from "../../config/auth-url";
import { resolveBaseUrlOrNull } from "../../config/base-url";
import {
  type OpenMeldEnvPreset,
  type OpenMeldPathResolutionInput,
  resolveOpenMeldEnvPreset,
} from "../../config/paths";
import { formatInlineOpenMeldCliCommands } from "../../runtime/cli-entry-command";

const DEPENDENCY_PROBE_TIMEOUT_MS = 1200;

export type DaemonServiceDependencyKind = "auth" | "gateway";
export type DaemonServiceDependencyScope = "loopback" | "remote";
export type DaemonServiceDependencyScopePolicy = "loopback_only" | "all";
export type DaemonServiceDependencyIssueStatus =
  | "unhealthy_http"
  | "unreachable";

export type DaemonServiceDependencyIssue = {
  kind: DaemonServiceDependencyKind;
  baseUrl: string;
  probeUrl: string;
  scope: DaemonServiceDependencyScope;
  status: DaemonServiceDependencyIssueStatus;
  httpStatus: number | null;
};

export type DaemonServiceDependencyDiagnostics =
  | {
      applicable: false;
      ready: true;
      lane: OpenMeldEnvPreset;
      scopePolicy: DaemonServiceDependencyScopePolicy;
      issues: [];
      checkedUrls: {
        auth: string | null;
        gateway: string | null;
      };
    }
  | {
      applicable: true;
      ready: true;
      lane: OpenMeldEnvPreset;
      scopePolicy: DaemonServiceDependencyScopePolicy;
      issues: [];
      checkedUrls: {
        auth: string | null;
        gateway: string | null;
      };
    }
  | {
      applicable: true;
      ready: false;
      lane: OpenMeldEnvPreset;
      scopePolicy: DaemonServiceDependencyScopePolicy;
      issues: DaemonServiceDependencyIssue[];
      checkedUrls: {
        auth: string | null;
        gateway: string | null;
      };
    };

type DependencyProbeTarget = {
  kind: DaemonServiceDependencyKind;
  baseUrl: string;
  probeUrl: string;
  scope: DaemonServiceDependencyScope;
};

type DependencyProbeResult =
  | {
      kind: DaemonServiceDependencyKind;
      baseUrl: string;
      probeUrl: string;
      scope: DaemonServiceDependencyScope;
      status: "reachable";
      httpStatus: number;
    }
  | {
      kind: DaemonServiceDependencyKind;
      baseUrl: string;
      probeUrl: string;
      scope: DaemonServiceDependencyScope;
      status: DaemonServiceDependencyIssueStatus;
      httpStatus: number | null;
    };

export async function resolveDaemonServiceDependencyDiagnostics(
  input: {
    authSession?: StoredAuthSession | null;
    authUrl?: string;
    fetchImpl?: typeof fetch;
    gatewayUrl?: string;
    pathInput?: OpenMeldPathResolutionInput;
    scopePolicy?: DaemonServiceDependencyScopePolicy;
  } = {}
): Promise<DaemonServiceDependencyDiagnostics> {
  const lane = resolveOpenMeldEnvPreset(input.pathInput);
  const scopePolicy = input.scopePolicy ?? "all";
  const authSession =
    input.authSession === undefined
      ? ((
          await getAuthSessionState({
            validateRemote: false,
          }).catch(() => null)
        )?.session ?? null)
      : input.authSession;
  const authUrl =
    normalizeOptionalText(input.authUrl) ??
    normalizeOptionalText(authSession?.authBaseUrl) ??
    normalizeOptionalText(resolveAuthBaseUrl()) ??
    null;
  const gatewayUrl =
    normalizeOptionalText(await resolveBaseUrlOrNull(input.gatewayUrl)) ?? null;
  const checkedUrls = {
    auth: authUrl,
    gateway: gatewayUrl,
  };
  const targets = [
    buildDependencyProbeTarget({
      baseUrl: authUrl,
      kind: "auth",
      scopePolicy,
    }),
    buildDependencyProbeTarget({
      baseUrl: gatewayUrl,
      kind: "gateway",
      scopePolicy,
    }),
  ].filter(
    (candidate): candidate is DependencyProbeTarget => candidate !== null
  );

  if (targets.length === 0) {
    return {
      applicable: false,
      ready: true,
      lane,
      scopePolicy,
      issues: [],
      checkedUrls,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const results = await Promise.all(
    targets.map((target) =>
      probeDependencyAvailability({
        fetchImpl,
        target,
      })
    )
  );
  const issues = results
    .filter(
      (
        result
      ): result is Extract<
        DependencyProbeResult,
        { status: DaemonServiceDependencyIssueStatus }
      > => result.status !== "reachable"
    )
    .map((result) => ({
      kind: result.kind,
      baseUrl: result.baseUrl,
      probeUrl: result.probeUrl,
      scope: result.scope,
      status: result.status,
      httpStatus: result.httpStatus,
    }));

  if (issues.length === 0) {
    return {
      applicable: true,
      ready: true,
      lane,
      scopePolicy,
      issues: [],
      checkedUrls,
    };
  }

  return {
    applicable: true,
    ready: false,
    lane,
    scopePolicy,
    issues,
    checkedUrls,
  };
}

export function buildDaemonServiceDependencyTitle(input: {
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): string {
  return shouldUseDevLocalLaneLabel(input)
    ? "OpenMeld Dev-Local Dependencies Unavailable"
    : "OpenMeld Service Dependencies Unavailable";
}

export function buildDaemonServiceDependencySummary(input: {
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): string {
  const [onlyIssue] = input.issues;
  const subject = buildDependencySubject(input);
  if (onlyIssue && input.issues.length === 1) {
    return `${subject} ${formatDependencyLabel(onlyIssue.kind)} is ${formatIssueStatusLabel(onlyIssue)} at \`${onlyIssue.baseUrl}\`.`;
  }

  const authIssue = input.issues.find((issue) => issue.kind === "auth");
  const gatewayIssue = input.issues.find((issue) => issue.kind === "gateway");
  if (authIssue && gatewayIssue) {
    const statusLabel =
      authIssue.status === "unreachable" &&
      gatewayIssue.status === "unreachable"
        ? "unavailable"
        : "not healthy";
    return `${subject} auth and gateway are ${statusLabel} at \`${authIssue.baseUrl}\` and \`${gatewayIssue.baseUrl}\`.`;
  }

  const labels = input.issues.map((issue) => formatDependencyLabel(issue.kind));
  return `${subject} dependencies need attention: ${labels.join(", ")}.`;
}

export function buildDaemonServiceDependencyDetails(input: {
  issues: DaemonServiceDependencyIssue[];
}): string {
  return input.issues
    .map((issue) => {
      const suffix =
        issue.status === "unhealthy_http" && issue.httpStatus !== null
          ? `health probe returned HTTP ${String(issue.httpStatus)}`
          : "health probe was unreachable";
      return `${formatDependencyTitle(issue.kind)}: \`${issue.baseUrl}\` (${suffix})`;
    })
    .join("\n");
}

export function buildDaemonServiceDependencyMeaning(input: {
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): string {
  if (shouldUseDevLocalLaneLabel(input)) {
    return "OpenMeld Service cannot finish starting in the dev-local lane until the local auth and gateway stack responds.";
  }
  return "OpenMeld Service cannot finish starting until the configured OpenMeld auth and gateway dependencies respond.";
}

export function buildDaemonServiceDependencyNextStep(input: {
  command: "start" | "status";
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): string {
  if (shouldUseDevLocalLaneLabel(input)) {
    return formatInlineOpenMeldCliCommands(
      `Start the local OpenMeld dev stack with \`pnpm dev\`, then retry \`openmeld service ${input.command}\`.`
    );
  }
  if (input.command === "start") {
    return formatInlineOpenMeldCliCommands(
      "Check the configured OpenMeld auth and gateway endpoints for this lane, then retry `openmeld service start`."
    );
  }
  return formatInlineOpenMeldCliCommands(
    "Check the configured OpenMeld auth and gateway endpoints for this lane, then retry `openmeld service status`."
  );
}

function buildDependencyProbeTarget(input: {
  baseUrl: string | null;
  kind: DaemonServiceDependencyKind;
  scopePolicy: DaemonServiceDependencyScopePolicy;
}): DependencyProbeTarget | null {
  if (!input.baseUrl) {
    return null;
  }
  try {
    const scope = resolveDependencyScope(input.baseUrl);
    if (input.scopePolicy === "loopback_only" && scope !== "loopback") {
      return null;
    }
    const probeUrl = new URL(input.baseUrl);
    probeUrl.pathname = "/health";
    probeUrl.search = "";
    probeUrl.hash = "";
    return {
      kind: input.kind,
      baseUrl: input.baseUrl,
      probeUrl: probeUrl.toString(),
      scope,
    };
  } catch {
    return null;
  }
}

async function probeDependencyAvailability(input: {
  fetchImpl: typeof fetch;
  target: DependencyProbeTarget;
}): Promise<DependencyProbeResult> {
  try {
    const response = await input.fetchImpl(input.target.probeUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(DEPENDENCY_PROBE_TIMEOUT_MS),
    });
    if (response.ok) {
      return {
        kind: input.target.kind,
        baseUrl: input.target.baseUrl,
        probeUrl: input.target.probeUrl,
        scope: input.target.scope,
        status: "reachable",
        httpStatus: response.status,
      };
    }
    return {
      kind: input.target.kind,
      baseUrl: input.target.baseUrl,
      probeUrl: input.target.probeUrl,
      scope: input.target.scope,
      status: "unhealthy_http",
      httpStatus: response.status,
    };
  } catch {
    return {
      kind: input.target.kind,
      baseUrl: input.target.baseUrl,
      probeUrl: input.target.probeUrl,
      scope: input.target.scope,
      status: "unreachable",
      httpStatus: null,
    };
  }
}

function buildDependencySubject(input: {
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): string {
  return shouldUseDevLocalLaneLabel(input) ? "OpenMeld dev-local" : "OpenMeld";
}

function shouldUseDevLocalLaneLabel(input: {
  lane: OpenMeldEnvPreset;
  issues: DaemonServiceDependencyIssue[];
}): boolean {
  return (
    input.lane === "dev-local" &&
    input.issues.length > 0 &&
    input.issues.every((issue) => issue.scope === "loopback")
  );
}

function resolveDependencyScope(baseUrl: string): DaemonServiceDependencyScope {
  try {
    const url = new URL(baseUrl);
    return isLoopbackHost(url.hostname) ? "loopback" : "remote";
  } catch {
    return "remote";
  }
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function formatDependencyLabel(kind: DaemonServiceDependencyKind): string {
  return kind === "auth" ? "auth" : "gateway";
}

function formatDependencyTitle(kind: DaemonServiceDependencyKind): string {
  return kind === "auth" ? "Auth URL" : "Gateway URL";
}

function formatIssueStatusLabel(issue: DaemonServiceDependencyIssue): string {
  if (issue.status === "unhealthy_http") {
    return "unhealthy";
  }
  return "unavailable";
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
