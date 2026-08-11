import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  MAX_PROFILE_WORKING_DIRECTORY_LENGTH,
  normalizeOptionalWorkingDirectory,
} from "@openmeld/schemas";
import type { OpenClawAgentSummary } from "./official-cli";

export type OpenClawAuthStatus = "copied" | "present" | "source_missing";

export const OPENCLAW_AUTH_PROFILE_FILENAME = "auth-profiles.json";

export function resolveOpenClawProviderRuntimeWorkingDirectory(
  value: string | undefined
): string {
  if (value === undefined) {
    throw new Error(
      "invalid OpenClaw providerRuntimeWorkingDirectory: expected an explicit runtime working directory"
    );
  }
  const workingDirectory = normalizeOptionalWorkingDirectory(value);
  if (workingDirectory) {
    return workingDirectory;
  }
  throw new Error(
    `invalid OpenClaw providerRuntimeWorkingDirectory: expected a string with length 1-${String(MAX_PROFILE_WORKING_DIRECTORY_LENGTH)}`
  );
}

export function findOpenClawAgentById(input: {
  agentId: string;
  agents: OpenClawAgentSummary[];
}): OpenClawAgentSummary | null {
  const normalizedAgentId = normalizeOptionalText(input.agentId);
  if (!normalizedAgentId) {
    return null;
  }
  return (
    input.agents.find((agent) => agent.agentId === normalizedAgentId) ?? null
  );
}

export function findOpenClawAgentsByWorkspace(input: {
  agents: OpenClawAgentSummary[];
  workspace: string;
}): OpenClawAgentSummary[] {
  return input.agents.filter((agent) =>
    matchesExpectedWorkspace({
      actualWorkspace: agent.workspace,
      expectedWorkspace: input.workspace,
    })
  );
}

export function matchesExpectedWorkspace(input: {
  actualWorkspace: string | null | undefined;
  expectedWorkspace: string;
}): boolean {
  const actualWorkspace = normalizeOptionalText(input.actualWorkspace);
  if (!actualWorkspace) {
    return false;
  }
  return resolve(actualWorkspace) === resolve(input.expectedWorkspace);
}

export function resolveDefaultOpenClawAgent(
  agents: OpenClawAgentSummary[]
): OpenClawAgentSummary | null {
  return (
    agents.find((agent) => agent.isDefault) ??
    agents.find((agent) => agent.agentId === "main") ??
    null
  );
}

export async function resolveOpenClawAuthStatus(input: {
  agents: OpenClawAgentSummary[];
  targetAgent: OpenClawAgentSummary | null;
}): Promise<OpenClawAuthStatus> {
  const targetAgent = input.targetAgent;
  const targetAuthPath = targetAgent
    ? join(targetAgent.agentDir, OPENCLAW_AUTH_PROFILE_FILENAME)
    : null;
  if (targetAuthPath && (await pathExists(targetAuthPath))) {
    return "present";
  }

  const defaultAgent = resolveDefaultOpenClawAgent(input.agents);
  if (!defaultAgent) {
    return "source_missing";
  }
  const sourceAuthPath = join(
    defaultAgent.agentDir,
    OPENCLAW_AUTH_PROFILE_FILENAME
  );
  return (await pathExists(sourceAuthPath)) ? "copied" : "source_missing";
}

export function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

async function pathExists(path: string): Promise<boolean> {
  return await access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}
