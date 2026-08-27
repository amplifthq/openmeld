import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { daemonRuntimeRootPath } from "../config/daemon-state";
import {
  type OpenMeldPathResolutionInput,
  openMeldManagedBinaryPath,
  resolveOpenMeldEnvPreset,
} from "../config/paths";
import {
  DISPATCH_OWNED_RUNTIME_MODE,
  OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV,
  OPENMELD_DISPATCH_RUNTIME_MODE_ENV,
  OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV,
  OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH_ENV,
  OPENMELD_USER_FACING_CLI_COMMAND_ENV,
} from "./dispatch-runtime-env";
import { OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV } from "./dispatch-space-action-context";
import {
  type OpenMeldDistribution,
  resolveOpenMeldDistribution,
} from "./distribution";

const DISPATCH_OWNED_RUNTIME_CLI_SHIM_DIRNAME = "dispatch-owned-cli";
const DISPATCH_SPACE_ACTION_CLI_SHIM_DIRNAME = "bin";
const OPENMELD_ENV_PRESET_ENV = "OPENMELD_ENV_PRESET";
const DISPATCH_OWNED_RUNTIME_CLI_COMMAND_NAMES = [
  "openmeld",
  "openmeld-dev",
  "openmeld-canary",
] as const;

export type DispatchOwnedRuntimeGuard = {
  active: boolean;
  dispatchId: string | null;
  targetProfileId: string | null;
};

export function buildDispatchOwnedRuntimeEnv(input: {
  dispatchId: string;
  targetProfileId: string;
  distribution?: OpenMeldDistribution;
  env?: Record<string, string | undefined>;
  cliEntryPath?: string;
  spaceActionContextPath?: string | null;
}): Record<string, string | undefined> {
  const currentPath = normalizeOptionalText(
    input.env?.PATH ?? process.env.PATH
  );
  const shimDir = ensureDispatchOwnedRuntimeCliShims({
    cliEntryPath: input.cliEntryPath,
    dispatchId: input.dispatchId,
    distribution: input.distribution,
    env: input.env,
    spaceActionContextPath: input.spaceActionContextPath,
    targetProfileId: input.targetProfileId,
  });
  const actionCommand = resolveDispatchOwnedRuntimeActionCliEntryCommand({
    env: input.env,
  });
  return {
    ...(input.env ?? {}),
    PATH: prependPathEntry({
      currentPath,
      nextEntry: shimDir,
    }),
    [OPENMELD_DISPATCH_RUNTIME_MODE_ENV]: DISPATCH_OWNED_RUNTIME_MODE,
    [OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]: input.dispatchId,
    [OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]: input.targetProfileId,
    [OPENMELD_USER_FACING_CLI_COMMAND_ENV]: actionCommand,
    [OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH_ENV]: join(shimDir, actionCommand),
    [OPENMELD_ENV_PRESET_ENV]: resolveDispatchOwnedRuntimeEnvPreset({
      env: input.env,
    }),
    ...(input.spaceActionContextPath
      ? {
          [OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]:
            input.spaceActionContextPath,
        }
      : {}),
  };
}

export function resolveDispatchOwnedRuntimeActionCliEntryCommand(
  input: OpenMeldPathResolutionInput = {}
): "openmeld" | "openmeld-dev" | "openmeld-canary" {
  const preset = resolveOpenMeldEnvPreset(input);
  if (preset === "dev-local") {
    return "openmeld-dev";
  }
  if (preset === "canary") {
    return "openmeld-canary";
  }
  return "openmeld";
}

export function resolveDispatchOwnedRuntimeCliShimDir(
  input: OpenMeldPathResolutionInput & {
    spaceActionContextPath?: string | null;
  } = {}
): string {
  const spaceActionContextPath = normalizeOptionalText(
    input.spaceActionContextPath
  );
  if (spaceActionContextPath) {
    return join(
      dirname(spaceActionContextPath),
      DISPATCH_SPACE_ACTION_CLI_SHIM_DIRNAME
    );
  }
  return join(
    daemonRuntimeRootPath(input),
    "bin",
    DISPATCH_OWNED_RUNTIME_CLI_SHIM_DIRNAME
  );
}

export function ensureDispatchOwnedRuntimeCliShims(input?: {
  cliEntryPath?: string;
  distribution?: OpenMeldDistribution;
  dispatchId?: string;
  env?: Record<string, string | undefined>;
  spaceActionContextPath?: string | null;
  targetProfileId?: string;
}): string {
  const distribution = input?.distribution ?? resolveOpenMeldDistribution();
  const cliEntryPath =
    distribution === "binary"
      ? resolveDispatchOwnedRuntimeBinaryCliEntryPath({
          cliEntryPath: input?.cliEntryPath,
          env: input?.env,
        })
      : resolveDispatchOwnedRuntimeCliEntryPath(input?.cliEntryPath);
  const shimDir = resolveDispatchOwnedRuntimeCliShimDir({
    env: input?.env,
    spaceActionContextPath: input?.spaceActionContextPath,
  });
  mkdirSync(shimDir, { recursive: true });

  for (const commandName of DISPATCH_OWNED_RUNTIME_CLI_COMMAND_NAMES) {
    const shimPath = join(shimDir, commandName);
    const shimSource = buildDispatchOwnedRuntimeCliShimSource({
      cliEntryPath,
      commandName,
      dispatchId: input?.dispatchId,
      distribution,
      nodePath: process.execPath,
      spaceActionContextPath: input?.spaceActionContextPath,
      targetProfileId: input?.targetProfileId,
    });
    if (existsSync(shimPath)) {
      const currentSource = safeReadTextFile(shimPath);
      if (currentSource === shimSource) {
        chmodSync(shimPath, 0o755);
        continue;
      }
    }
    writeFileSync(shimPath, shimSource, {
      encoding: "utf8",
      mode: 0o755,
    });
    chmodSync(shimPath, 0o755);
  }

  return shimDir;
}

export function readDispatchOwnedRuntimeGuard(
  env: NodeJS.ProcessEnv = process.env
): DispatchOwnedRuntimeGuard {
  const mode = normalizeOptionalText(env[OPENMELD_DISPATCH_RUNTIME_MODE_ENV]);
  if (mode !== DISPATCH_OWNED_RUNTIME_MODE) {
    return {
      active: false,
      dispatchId: null,
      targetProfileId: null,
    };
  }

  return {
    active: true,
    dispatchId: normalizeOptionalText(
      env[OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]
    ),
    targetProfileId: normalizeOptionalText(
      env[OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]
    ),
  };
}

export function assertDispatchOwnedRuntimePublicWriteAllowed(input: {
  commandLabel: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const guard = readDispatchOwnedRuntimeGuard(input.env);
  if (!guard.active) {
    return;
  }

  const dispatchIdSuffix = guard.dispatchId
    ? ` (dispatch ${guard.dispatchId})`
    : "";
  throw new Error(
    `${input.commandLabel} is blocked inside a dispatch-owned runtime${dispatchIdSuffix}. Public space writes must be returned through OpenMeld Space structured actions: post_message, post_status, or stay_silent.`
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveDispatchOwnedRuntimeCliEntryPath(
  cliEntryPath?: string
): string {
  const normalizedCliEntryPath =
    normalizeOptionalText(cliEntryPath) ??
    normalizeOptionalText(process.argv[1]) ??
    null;
  if (!normalizedCliEntryPath) {
    throw new Error(
      "dispatch-owned runtime CLI shim requires a current CLI entry path"
    );
  }
  return resolve(normalizedCliEntryPath);
}

function resolveDispatchOwnedRuntimeBinaryCliEntryPath(input: {
  cliEntryPath?: string;
  env?: Record<string, string | undefined>;
}): string {
  // A background Service may keep running from an executable path that an
  // upgrade later replaces with a launcher. The lane-owned managed CLI is the
  // stable command authority for new Space Action subprocesses.
  const normalizedCliEntryPath =
    normalizeOptionalText(input.cliEntryPath) ??
    normalizeOptionalText(openMeldManagedBinaryPath({ env: input.env })) ??
    null;
  if (!normalizedCliEntryPath) {
    throw new Error(
      "dispatch-owned runtime CLI shim requires a current binary CLI path"
    );
  }
  return resolve(normalizedCliEntryPath);
}

function buildDispatchOwnedRuntimeCliShimSource(input: {
  cliEntryPath: string;
  commandName: (typeof DISPATCH_OWNED_RUNTIME_CLI_COMMAND_NAMES)[number];
  distribution: OpenMeldDistribution;
  dispatchId?: string;
  nodePath: string;
  spaceActionContextPath?: string | null;
  targetProfileId?: string;
}): string {
  const embeddedEnv = {
    [OPENMELD_DISPATCH_RUNTIME_MODE_ENV]: DISPATCH_OWNED_RUNTIME_MODE,
    [OPENMELD_ENV_PRESET_ENV]: resolveEnvPresetForCommandName(
      input.commandName
    ),
    [OPENMELD_USER_FACING_CLI_COMMAND_ENV]: input.commandName,
    ...(normalizeOptionalText(input.dispatchId)
      ? {
          [OPENMELD_DISPATCH_RUNTIME_DISPATCH_ID_ENV]: normalizeOptionalText(
            input.dispatchId
          ) as string,
        }
      : {}),
    ...(normalizeOptionalText(input.targetProfileId)
      ? {
          [OPENMELD_DISPATCH_RUNTIME_TARGET_PROFILE_ID_ENV]:
            normalizeOptionalText(input.targetProfileId) as string,
        }
      : {}),
    ...(normalizeOptionalText(input.spaceActionContextPath)
      ? {
          [OPENMELD_SPACE_ACTION_CONTEXT_PATH_ENV]: normalizeOptionalText(
            input.spaceActionContextPath
          ) as string,
        }
      : {}),
  };
  if (input.distribution === "binary") {
    const exportRows = Object.entries(embeddedEnv).map(
      ([key, value]) => `export ${key}=${quoteShellValue(value)}`
    );
    return `#!/bin/sh
${exportRows.join("\n")}
exec ${quoteShellValue(input.cliEntryPath)} "$@"
`;
  }
  return `#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync(${JSON.stringify(input.nodePath)}, [${JSON.stringify(
    input.cliEntryPath
  )}, ...process.argv.slice(2)], {
  env: { ...process.env, ...${JSON.stringify(embeddedEnv)} },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
`;
}

function resolveDispatchOwnedRuntimeEnvPreset(input: {
  env?: Record<string, string | undefined>;
}): "prod" | "dev-local" | "canary" {
  return resolveEnvPresetForCommandName(
    resolveDispatchOwnedRuntimeActionCliEntryCommand({
      env: input.env,
    })
  );
}

function resolveEnvPresetForCommandName(
  commandName: (typeof DISPATCH_OWNED_RUNTIME_CLI_COMMAND_NAMES)[number]
): "prod" | "dev-local" | "canary" {
  if (commandName === "openmeld-dev") {
    return "dev-local";
  }
  if (commandName === "openmeld-canary") {
    return "canary";
  }
  return "prod";
}

function quoteShellValue(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function safeReadTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function prependPathEntry(input: {
  currentPath: string | null;
  nextEntry: string;
}): string {
  const currentEntries = (input.currentPath ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const dedupedEntries = currentEntries.filter(
    (entry) => entry !== input.nextEntry
  );
  return [input.nextEntry, ...dedupedEntries].join(delimiter);
}
