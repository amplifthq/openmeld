import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildCliLaunchInvocation,
  buildExecutableLaunchContract,
} from "@openmeld/adapter-core";
import { resolveOpenClawBinCandidates } from "@openmeld/adapter-openclaw";
import { OPENCLAW_CLI_TIMEOUT_MS as STRATEGY_OPENCLAW_CLI_TIMEOUT_MS } from "../../strategy-constants";

const execFileAsync = promisify(execFile);
export const OPENCLAW_CLI_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
export const OPENCLAW_CLI_TIMEOUT_MS = STRATEGY_OPENCLAW_CLI_TIMEOUT_MS;

export type OpenClawAgentSummary = {
  agentDir: string;
  agentId: string;
  isDefault: boolean;
  name: string | null;
  workspace: string | null;
};

export type OpenClawGatewayAgentSummary = {
  agentId: string;
  identityName: string | null;
  name: string | null;
};

export async function fetchOpenClawGatewayHealth(
  input: { cwd?: string; openClawBin?: string } = {}
): Promise<unknown> {
  return await runOpenClawJsonCommand({
    args: ["health", "--json"],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
}

export async function listOpenClawAgents(
  input: { cwd?: string; openClawBin?: string } = {}
): Promise<OpenClawAgentSummary[]> {
  const stdout = await runOpenClawJsonCommand({
    args: ["agents", "list", "--json"],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
  if (!Array.isArray(stdout)) {
    throw new Error("openclaw agents list returned a non-array JSON payload");
  }
  return stdout
    .map((entry) => parseOpenClawAgentSummary(entry))
    .filter((entry): entry is OpenClawAgentSummary => entry !== null)
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
}

export async function createOpenClawAgent(input: {
  agentId: string;
  cwd?: string;
  openClawBin?: string;
  workspace: string;
}): Promise<void> {
  await runOpenClawCommand({
    args: [
      "agents",
      "add",
      input.agentId,
      "--non-interactive",
      "--workspace",
      input.workspace,
      "--json",
    ],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
}

export async function listOpenClawGatewayAgents(
  input: { cwd?: string; openClawBin?: string } = {}
): Promise<OpenClawGatewayAgentSummary[]> {
  const stdout = await runOpenClawJsonCommand({
    args: ["gateway", "call", "agents.list", "--json"],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
  if (!(stdout && typeof stdout === "object")) {
    throw new Error(
      "openclaw gateway call agents.list returned a non-object JSON payload"
    );
  }
  const agents = (stdout as { agents?: unknown }).agents;
  if (!Array.isArray(agents)) {
    throw new Error(
      "openclaw gateway call agents.list returned a payload without an agents array"
    );
  }
  return agents
    .map((entry) => parseOpenClawGatewayAgentSummary(entry))
    .filter((entry): entry is OpenClawGatewayAgentSummary => entry !== null)
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
}

export async function restartOpenClawGateway(
  input: { cwd?: string; openClawBin?: string } = {}
): Promise<void> {
  await runOpenClawCommand({
    args: ["gateway", "restart", "--json"],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
}

export async function setOpenClawAgentIdentity(input: {
  agentId: string;
  cwd?: string;
  identityName: string;
  openClawBin?: string;
}): Promise<void> {
  await runOpenClawCommand({
    args: [
      "agents",
      "set-identity",
      "--agent",
      input.agentId,
      "--name",
      input.identityName,
      "--json",
    ],
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
}

async function runOpenClawJsonCommand(input: {
  args: string[];
  cwd?: string;
  openClawBin?: string;
}): Promise<unknown> {
  const stdout = await runOpenClawCommand(input);
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `openclaw JSON output could not be parsed: ${toErrorMessage(error)}`
    );
  }
}

async function runOpenClawCommand(input: {
  args: string[];
  cwd?: string;
  openClawBin?: string;
}): Promise<string> {
  const openClawBins = resolveOpenClawCommandCandidates(input.openClawBin);
  let lastError: unknown = null;
  for (const openClawBin of openClawBins) {
    try {
      const invocation = buildCliLaunchInvocation({
        args: input.args,
        launchContract: buildExecutableLaunchContract({
          commandPath: openClawBin,
        }),
      });
      const result = await execFileAsync(invocation.bin, invocation.args, {
        cwd: input.cwd,
        env: process.env,
        encoding: "utf8",
        maxBuffer: OPENCLAW_CLI_MAX_BUFFER_BYTES,
        shell: invocation.shell ?? false,
        timeout: OPENCLAW_CLI_TIMEOUT_MS,
      });
      return result.stdout.trim();
    } catch (error) {
      lastError = error;
      if (!isBinaryNotFoundError(error)) {
        throw new Error(
          resolveOpenClawCliErrorMessage(error, OPENCLAW_CLI_TIMEOUT_MS)
        );
      }
    }
  }

  throw new Error(
    resolveOpenClawCliErrorMessage(lastError, OPENCLAW_CLI_TIMEOUT_MS)
  );
}

function resolveOpenClawCommandCandidates(
  explicitOpenClawBin?: string
): string[] {
  return resolveOpenClawBinCandidates(explicitOpenClawBin);
}

function isBinaryNotFoundError(error: unknown): boolean {
  return (
    error !== null &&
    error !== undefined &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isExecFileTimeoutError(error: object): boolean {
  const record = error as { killed?: unknown; signal?: unknown };
  return record.killed === true && record.signal === "SIGTERM";
}

function resolveOpenClawCliErrorMessage(
  error: unknown,
  timeoutMs?: number
): string {
  if (!error || typeof error !== "object") {
    return `openclaw command failed: ${String(error)}`;
  }
  if ("code" in error && (error as { code?: string }).code === "ENOENT") {
    return "openclaw command failed: openclaw is not installed or not on PATH";
  }
  const stdout = normalizeOptionalText((error as { stdout?: unknown }).stdout);
  const stderr = normalizeOptionalText((error as { stderr?: unknown }).stderr);
  const cliMessage = stderr ?? stdout;
  if (timeoutMs !== undefined && isExecFileTimeoutError(error)) {
    return cliMessage
      ? `openclaw command timed out after ${String(timeoutMs)}ms: ${cliMessage}`
      : `openclaw command timed out after ${String(timeoutMs)}ms`;
  }
  if (cliMessage) {
    return cliMessage;
  }
  return `openclaw command failed: ${toErrorMessage(error)}`;
}

function parseOpenClawAgentSummary(
  value: unknown
): OpenClawAgentSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    agentDir?: unknown;
    id?: unknown;
    isDefault?: unknown;
    name?: unknown;
    workspace?: unknown;
  };
  const agentId = normalizeOptionalText(record.id);
  const agentDir = normalizeOptionalText(record.agentDir);
  if (!(agentId && agentDir)) {
    return null;
  }
  return {
    agentDir,
    agentId,
    isDefault: record.isDefault === true,
    name: normalizeOptionalText(record.name),
    workspace: normalizeOptionalText(record.workspace),
  };
}

function parseOpenClawGatewayAgentSummary(
  value: unknown
): OpenClawGatewayAgentSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    id?: unknown;
    identity?: { name?: unknown } | unknown;
    name?: unknown;
  };
  const agentId = normalizeOptionalText(record.id);
  if (!agentId) {
    return null;
  }
  const identityRecord =
    record.identity && typeof record.identity === "object"
      ? (record.identity as { name?: unknown })
      : null;
  return {
    agentId,
    identityName: normalizeOptionalText(identityRecord?.name),
    name: normalizeOptionalText(record.name),
  };
}
