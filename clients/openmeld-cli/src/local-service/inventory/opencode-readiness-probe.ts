import { type ChildProcessByStdio, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, loadavg } from "node:os";
import type { Readable } from "node:stream";
import {
  createOpencodeClient,
  type ProviderListResponse,
} from "@opencode-ai/sdk/v2";
import {
  buildCliLaunchInvocation,
  createProviderOriginalError,
  createUnavailableProviderUsageLimits,
  createUnsupportedProviderUsageLimits,
  type RuntimeAgentControllerLaunchContract,
} from "@openmeld/adapter-core";
import {
  parseOpenCodeGoUsageResponse,
  parseOpenRouterUsageResponse,
  readOpenCode2Inventory,
} from "@openmeld/adapter-opencode";
import { AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT } from "@openmeld/schemas";
import type {
  AgentControllerInterfaceAuthSnapshot,
  AgentControllerInterfaceModel,
  AgentControllerInterfaceStatus,
  AgentControllerUsageLimits,
} from "@openmeld/schemas/types";
import { resolveOpenCodeAuthPath } from "../../agent-activity/opencode-storage";

const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const SDK_READ_TIMEOUT_MS = 4000;
const PROBE_OUTPUT_LIMIT = 32_000;
const OPENCODE_MODEL_ID_RE = /^[A-Za-z0-9_.-]+\/[^\s/]+(?:\/[^\s/]+)*$/u;
const OPENCODE_PROBE_HOSTNAME = "127.0.0.1";
const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
const OPENCODE_SERVER_URL_RE = /on\s+(https?:\/\/[^\s]+)/u;
const ANSI_ESCAPE = String.fromCharCode(27);
const OPENCODE_GO_PROVIDER_ID = "opencode-go";
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
const TRAILING_SLASH_RE = /\/$/u;

export type OpenCodeReadinessProbeResult = {
  auth: AgentControllerInterfaceAuthSnapshot;
  message: string | null;
  models: AgentControllerInterfaceModel[];
  // True when the probe reached OpenCode and read a real answer (including a
  // proven not-signed-in answer). False when the check itself failed — server
  // start timeout, spawn error, hung reads — which is load evidence, not
  // controller truth.
  probeCompleted: boolean;
  status: AgentControllerInterfaceStatus;
  usageLimits?: AgentControllerUsageLimits;
};

export async function probeOpenCodeReadiness(input: {
  workingDirectory: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs?: number;
}): Promise<OpenCodeReadinessProbeResult> {
  let server: OpenCodeProbeServer | null = null;
  try {
    server = await startOpenCodeProbeServer({
      workingDirectory: input.workingDirectory,
      launchContract: input.launchContract,
      timeoutMs: input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    });
    if (server.apiMajor === 2) {
      const models = await readOpenCode2Inventory({
        baseUrl: server.url,
        password: server.password,
        directory: input.workingDirectory,
        timeoutMs: SDK_READ_TIMEOUT_MS,
      });
      return {
        auth: { status: "unknown" },
        message: models.length
          ? null
          : "OpenCode has no enabled models. Connect a provider in OpenCode.",
        models,
        probeCompleted: true,
        status: models.length ? "ready" : "unavailable",
        usageLimits: createUnsupportedProviderUsageLimits(
          new Date().toISOString()
        ),
      };
    }
    const client = createOpencodeClient({
      baseUrl: server.url,
      directory: input.workingDirectory,
      throwOnError: true,
    });
    // The SDK reads have no timeout of their own; without this bound a hung
    // OpenCode server would wedge the whole controller report sync forever.
    const providerListResult = await rejectAfterTimeout(
      client.provider.list(),
      SDK_READ_TIMEOUT_MS,
      `Timed out while reading OpenCode provider status after ${SDK_READ_TIMEOUT_MS}ms.`
    );
    const readiness = resolveOpenCodeReadinessFromProviderList(
      providerListResult.data
    );
    const usageLimits = providerListResult.data
      ? await readOpenCodeProviderUsageLimits({
          observedAt: new Date().toISOString(),
          providerList: providerListResult.data,
        })
      : undefined;
    return { ...readiness, ...(usageLimits ? { usageLimits } : {}) };
  } catch (error: unknown) {
    const auth = resolveOpenCodeAuthSnapshotFromProbeError(error);
    return {
      auth,
      message: `OpenCode is installed, but OpenMeld could not confirm a connected OpenCode provider: ${toErrorMessage(error)}`,
      models: [],
      // A 401/403 is a real answer from a live server: the provider account
      // is proven not signed in. Anything else here means the check died.
      probeCompleted: auth.status === "unauthenticated",
      status: auth.status === "unauthenticated" ? "unavailable" : "unknown",
    };
  } finally {
    if (server) {
      await stopOpenCodeProbeServer(server.child);
    }
  }
}

export async function readOpenCodeProviderUsageLimits(input: {
  authContent?: string | null;
  environment?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  observedAt: string;
  providerList: ProviderListResponse;
  readAuthFile?: (path: string) => Promise<string>;
}): Promise<AgentControllerUsageLimits> {
  const providersById = new Map<string, { displayName: string; id: string }>();
  for (const connectedProviderId of input.providerList.connected) {
    const id = normalizeOptionalText(connectedProviderId);
    if (!(id && id.length <= 256) || providersById.has(id)) {
      continue;
    }
    const displayName = (
      normalizeOptionalText(
        input.providerList.all.find((provider) => provider.id === id)?.name
      ) ?? id
    ).slice(0, 256);
    providersById.set(id, { displayName, id });
  }
  const providers = [...providersById.values()];

  const usageLimits = await Promise.all(
    providers.map(async (provider) => {
      if (
        provider.id !== OPENCODE_GO_PROVIDER_ID &&
        provider.id !== "openrouter"
      ) {
        return createUnsupportedProviderUsageLimits(input.observedAt, provider);
      }
      const config = input.providerList.all.find(
        (item) => item.id === provider.id
      );
      const defaultBaseUrl =
        provider.id === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : "https://opencode.ai/zen/go/v1";
      if (
        typeof config?.options.baseURL === "string" &&
        config.options.baseURL.replace(TRAILING_SLASH_RE, "") !== defaultBaseUrl
      ) {
        return createUnavailableProviderUsageLimits(
          input.observedAt,
          provider,
          { reason: "not_applicable" }
        );
      }
      const apiKey =
        normalizeOptionalText(config?.key) ??
        (await resolveOpenCodeProviderApiKey({
          authContent: input.authContent,
          environment: input.environment,
          providerId: provider.id,
          readAuthFile: input.readAuthFile,
        }));
      if (!apiKey) {
        return createUnavailableProviderUsageLimits(
          input.observedAt,
          provider,
          { reason: "not_authenticated" }
        );
      }
      try {
        const response = await (input.fetchFn ?? fetch)(
          provider.id === "openrouter"
            ? "https://openrouter.ai/api/v1/key"
            : OPENCODE_GO_USAGE_URL,
          {
            redirect: "error",
            headers: { authorization: `Bearer ${apiKey}` },
            signal: AbortSignal.timeout(SDK_READ_TIMEOUT_MS),
          }
        );
        if (!response.ok) {
          return createUnavailableProviderUsageLimits(
            input.observedAt,
            provider,
            {
              reason: usageRequestFailureReason(response.status),
            }
          );
        }
        return (
          provider.id === "openrouter"
            ? parseOpenRouterUsageResponse
            : parseOpenCodeGoUsageResponse
        )({
          observedAt: input.observedAt,
          value: await response.json(),
        });
      } catch {
        return createUnavailableProviderUsageLimits(
          input.observedAt,
          provider,
          { reason: "refresh_failed" }
        );
      }
    })
  );
  return usageLimits.flat().slice(0, 32);
}

function usageRequestFailureReason(
  status: number
): "not_applicable" | "not_authenticated" | "refresh_failed" {
  if (status === 403) {
    return "not_applicable";
  }
  return status === 401 ? "not_authenticated" : "refresh_failed";
}

async function resolveOpenCodeProviderApiKey(input: {
  authContent?: string | null;
  environment?: NodeJS.ProcessEnv;
  providerId: string;
  readAuthFile?: (path: string) => Promise<string>;
}): Promise<string | null> {
  const environment = input.environment ?? process.env;
  let authContent = input.authContent ?? environment.OPENCODE_AUTH_CONTENT;
  if (!authContent) {
    try {
      const authPath = resolveOpenCodeAuthPath({
        homeDir: homedir(),
        xdgDataHome: environment.XDG_DATA_HOME,
      });
      authContent = input.readAuthFile
        ? await input.readAuthFile(authPath)
        : await readFile(authPath, "utf8");
    } catch {
      authContent = "{}";
    }
  }
  try {
    const providerAuth = toRecord(JSON.parse(authContent)?.[input.providerId]);
    if (providerAuth?.type === "api") {
      return normalizeOptionalText(providerAuth.key);
    }
    // Stored OAuth or another auth mode is not the environment API key account.
    if (providerAuth) {
      return null;
    }
    return normalizeOptionalText(
      environment[
        input.providerId === OPENCODE_GO_PROVIDER_ID
          ? "OPENCODE_API_KEY"
          : "OPENROUTER_API_KEY"
      ]
    );
  } catch {
    return null;
  }
}

type OpenCodeProbeServer = {
  child: OpenCodeProbeChild;
  url: string;
  apiMajor: 1 | 2;
  password: string;
};

type OpenCodeProbeChild = ChildProcessByStdio<null, Readable, Readable>;

async function startOpenCodeProbeServer(input: {
  workingDirectory: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  timeoutMs: number;
}): Promise<OpenCodeProbeServer> {
  const port = await findAvailableLocalPort();
  const password = randomUUID();
  const safeOutput = (value: string) =>
    createProviderOriginalError(value.replaceAll(password, "[redacted]"));
  const invocation = buildCliLaunchInvocation({
    args: ["serve", `--hostname=${OPENCODE_PROBE_HOSTNAME}`, `--port=${port}`],
    launchContract: input.launchContract,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.bin, invocation.args, {
      cwd: input.workingDirectory,
      detached: process.platform !== "win32",
      env: { ...process.env, OPENCODE_PASSWORD: password },
      shell: invocation.shell ?? false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const spawnedAtMs = Date.now();
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (
      result: { error: Error } | { server: OpenCodeProbeServer }
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if ("server" in result) {
        resolve(result.server);
        return;
      }
      stopOpenCodeProbeServer(child).finally(() => {
        reject(result.error);
      });
    };
    const timeout = setTimeout(() => {
      finish({
        error: new Error(
          [
            `Timed out waiting for OpenCode server start after ${input.timeoutMs}ms.`,
            `Startup evidence: pid=${child.pid ?? "unknown"}, elapsedMs=${Date.now() - spawnedAtMs}, stdoutBytes=${stdoutBytes}, stderrBytes=${stderrBytes}, load1m=${loadavg()[0]?.toFixed(2) ?? "unavailable"}.`,
            safeOutput(stderr) || safeOutput(stdout),
          ]
            .filter(Boolean)
            .join(" ")
        ),
      });
    }, input.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk);
      stdout = appendProbeOutput(stdout, chunk);
      const url = parseOpenCodeServerUrlFromOutput(stdout);
      if (url) {
        const apiMajor = stripAnsi(stdout)
          .split("\n")
          .some((line) => line.startsWith("server listening on "))
          ? 2
          : 1;
        finish({ server: { child, url, apiMajor, password } });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
      stderr = appendProbeOutput(stderr, chunk);
    });
    child.on("error", (error) => {
      finish({
        error: new Error(`OpenCode server could not start: ${error.message}`),
      });
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      finish({
        error: new Error(
          [
            `OpenCode server exited before startup completed (code: ${
              typeof code === "number" ? code : "unknown"
            }).`,
            stdout.trim() ? `stdout: ${safeOutput(stdout)}` : null,
            stderr.trim() ? `stderr: ${safeOutput(stderr)}` : null,
          ]
            .filter(Boolean)
            .join(" ")
        ),
      });
    });
  });
}

function stopOpenCodeProbeServer(child: OpenCodeProbeChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(resolveTimer);
      child.off("close", finish);
      resolve();
    };
    const forceKillTimer = setTimeout(() => {
      killOpenCodeProbeProcess(child, "SIGKILL");
    }, 1000);
    const resolveTimer = setTimeout(finish, 1500);
    child.once("close", finish);
    killOpenCodeProbeProcess(child, "SIGTERM");
  });
}

function killOpenCodeProbeProcess(
  child: OpenCodeProbeChild,
  signal: NodeJS.Signals
): void {
  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    // The probe server may already be gone; cleanup is best-effort here.
  }
}

function rejectAfterTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function findAvailableLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, OPENCODE_PROBE_HOSTNAME, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Could not allocate a local OpenCode probe port."));
        });
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function parseOpenCodeServerUrlFromOutput(output: string): string | null {
  for (const line of stripAnsi(output).split("\n")) {
    if (
      !(
        line.startsWith(OPENCODE_SERVER_READY_PREFIX) ||
        line.startsWith("server listening on ")
      )
    ) {
      continue;
    }
    const match = line.match(OPENCODE_SERVER_URL_RE);
    return match?.[1] ?? null;
  }
  return null;
}

function resolveOpenCodeReadinessFromProviderList(
  providerList: ProviderListResponse | undefined
): OpenCodeReadinessProbeResult {
  if (!providerList) {
    return {
      auth: { status: "unknown" },
      message: "OpenCode is installed, but its provider list was empty.",
      models: [],
      probeCompleted: true,
      status: "error",
    };
  }

  const connectedProviders = new Set(
    providerList.connected
      .map((providerId) => normalizeOptionalText(providerId))
      .filter((providerId): providerId is string => Boolean(providerId))
  );
  if (connectedProviders.size === 0) {
    return {
      auth: { status: "unauthenticated", type: "opencode" },
      message:
        "OpenCode is installed, but no connected provider was reported. Open OpenCode and sign in to a provider before OpenMeld can launch it.",
      models: [],
      probeCompleted: true,
      status: "unavailable",
    };
  }

  const models = parseOpenCodeProviderModels({
    connectedProviders,
    providerList,
  });
  if (models.length === 0) {
    return {
      auth: {
        label: formatConnectedOpenCodeProviderCount(connectedProviders.size),
        status: "authenticated",
        type: "opencode",
      },
      message:
        "OpenCode is installed and has a connected provider, but it did not report any models OpenMeld can use.",
      models: [],
      probeCompleted: true,
      status: "error",
    };
  }

  return {
    auth: {
      label: formatConnectedOpenCodeProviderCount(connectedProviders.size),
      status: "authenticated",
      type: "opencode",
    },
    message: null,
    models,
    probeCompleted: true,
    status: "ready",
  };
}

function parseOpenCodeProviderModels(input: {
  connectedProviders: ReadonlySet<string>;
  providerList: ProviderListResponse;
}): AgentControllerInterfaceModel[] {
  const seen = new Set<string>();
  const models: AgentControllerInterfaceModel[] = [];
  for (const provider of input.providerList.all) {
    if (!input.connectedProviders.has(provider.id)) {
      continue;
    }
    for (const model of Object.values(provider.models)) {
      const modelId = normalizeOptionalText(model.id);
      const providerId =
        normalizeOptionalText(model.providerID) ??
        normalizeOptionalText(provider.id);
      if (!(modelId && providerId)) {
        continue;
      }
      const id = `${providerId}/${modelId}`;
      if (seen.has(id) || !OPENCODE_MODEL_ID_RE.test(id)) {
        continue;
      }
      seen.add(id);
      models.push({
        displayName: normalizeOptionalText(model.name) ?? id,
        id,
      });
      if (models.length >= AGENT_CONTROLLER_MODEL_INVENTORY_LIMIT) {
        return models;
      }
    }
  }
  return models;
}

function formatConnectedOpenCodeProviderCount(providerCount: number): string {
  return providerCount === 1
    ? "1 provider connected"
    : `${providerCount} providers connected`;
}

function resolveOpenCodeAuthSnapshotFromProbeError(
  error: unknown
): AgentControllerInterfaceAuthSnapshot {
  const record = toRecord(error);
  const response = toRecord(record?.response);
  const status = response?.status;
  if (status === 401 || status === 403) {
    return {
      status: "unauthenticated",
      type: "opencode",
    };
  }
  return { status: "unknown" };
}

function appendProbeOutput(existing: string, chunk: unknown): string {
  return `${existing}${String(chunk)}`.slice(0, PROBE_OUTPUT_LIMIT);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function stripAnsi(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] === ANSI_ESCAPE && value[index + 1] === "[") {
      index += 2;
      while (index < value.length && value[index] !== "m") {
        index += 1;
      }
      index += 1;
      continue;
    }
    output += value[index] ?? "";
    index += 1;
  }
  return output;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}
