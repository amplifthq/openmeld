import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { providerDispatchRuntimeContextSchema } from "@openmeld/schemas";
import type { ProviderDispatchRuntimeContext } from "@openmeld/schemas/types";
import { resolveCurrentOpenMeldAccountContext } from "../config/account-context";
import {
  normalizeOpenMeldProfileId,
  type OpenMeldAccountKey,
} from "../config/paths";
import {
  describeProfileWorkspacePathValidationFailure,
  validateCustomProfileWorkspacePath,
} from "./custom-path";
import {
  readProfileWorkspaceConfigForAccount,
  resolveConfiguredProfileWorkspacePathForAccount,
} from "./service";

export type ProfileWorkspaceRuntimeResolution =
  | {
      configPath: string;
      configuredWorkspacePath: string;
      effectiveRuntimeWorkingDirectory: string;
      runtimeContext: ProviderDispatchRuntimeContext;
      status: "ready";
      workspaceMode: "openmeld_managed" | "custom";
    }
  | {
      configPath: string;
      configuredWorkspacePath?: null;
      reasonCode: "workspace.missing";
      reasonText: string;
      status: "missing";
      workspaceMode?: null;
    }
  | {
      configPath: string;
      configuredWorkspacePath?: string | null;
      reasonCode: "workspace.invalid";
      reasonText: string;
      status: "invalid";
      workspaceMode?: "openmeld_managed" | "custom" | null;
    };

export async function resolveProfileWorkspaceRuntime(input: {
  account?: OpenMeldAccountKey;
  openMeldProfileId: string;
  mode: "dispatch" | "inspect";
}): Promise<ProfileWorkspaceRuntimeResolution> {
  const account = await resolveAccountKey(input.account);
  return await resolveProfileWorkspaceRuntimeForAccount({
    account,
    openMeldProfileId: input.openMeldProfileId,
    mode: input.mode,
  });
}

export async function resolveProfileWorkspaceRuntimeForAccount(input: {
  account: OpenMeldAccountKey;
  openMeldProfileId: string;
  mode: "dispatch" | "inspect";
}): Promise<ProfileWorkspaceRuntimeResolution> {
  const openMeldProfileId = normalizeOpenMeldProfileId(input.openMeldProfileId);
  const workspaceConfig = await readProfileWorkspaceConfigForAccount({
    account: input.account,
    openMeldProfileId,
  });
  if (workspaceConfig.status === "missing") {
    return {
      configPath: workspaceConfig.path,
      configuredWorkspacePath: null,
      reasonCode: "workspace.missing",
      reasonText: `Profile workspace config is missing for ${openMeldProfileId} at ${workspaceConfig.path}.`,
      status: "missing",
      workspaceMode: null,
    };
  }
  if (workspaceConfig.status === "invalid") {
    return {
      configPath: workspaceConfig.path,
      configuredWorkspacePath: null,
      reasonCode: "workspace.invalid",
      reasonText: resolveInvalidConfigReasonText({
        openMeldProfileId,
        configPath: workspaceConfig.path,
        reason: workspaceConfig.reason,
      }),
      status: "invalid",
      workspaceMode: null,
    };
  }

  const configuredWorkspacePath =
    resolveConfiguredProfileWorkspacePathForAccount({
      account: input.account,
      openMeldProfileId,
      value: workspaceConfig.value,
    });

  if (workspaceConfig.value.mode === "custom") {
    const validation = await validateCustomProfileWorkspacePath(
      workspaceConfig.value.customWorkspacePath
    );
    if (validation.status === "invalid") {
      return {
        configPath: workspaceConfig.path,
        configuredWorkspacePath,
        reasonCode: "workspace.invalid",
        reasonText: `Profile workspace config for ${openMeldProfileId} points at an invalid custom path. ${describeProfileWorkspacePathValidationFailure(
          validation
        )}`,
        status: "invalid",
        workspaceMode: "custom",
      };
    }
    return buildReadyResolution({
      configPath: workspaceConfig.path,
      configuredWorkspacePath,
      effectiveRuntimeWorkingDirectory: validation.value,
      workspaceMode: "custom",
    });
  }

  if (input.mode === "dispatch") {
    // Dispatch prepares the saved directory; it must not overwrite a newer
    // user preference with the configuration read at the start of this call.
    try {
      await mkdir(configuredWorkspacePath, { recursive: true });
    } catch (error) {
      return {
        configPath: workspaceConfig.path,
        configuredWorkspacePath,
        reasonCode: "workspace.invalid",
        status: "invalid",
        workspaceMode: "openmeld_managed",
        reasonText: `Couldn’t prepare the managed working folder. ${error instanceof Error ? error.message : "Check the folder and its permissions."}`,
      };
    }
  }
  let pathToCheck = configuredWorkspacePath;
  let validation = await validateCustomProfileWorkspacePath(pathToCheck);
  while (
    input.mode === "inspect" &&
    validation.status === "invalid" &&
    validation.reason === "not_found" &&
    dirname(pathToCheck) !== pathToCheck
  ) {
    // Managed directories may be created at dispatch. Check that the existing
    // parent can support that promise without creating anything during inspection.
    pathToCheck = dirname(pathToCheck);
    validation = await validateCustomProfileWorkspacePath(pathToCheck);
  }
  if (validation.status === "invalid") {
    return {
      configPath: workspaceConfig.path,
      configuredWorkspacePath,
      reasonCode: "workspace.invalid",
      reasonText: describeProfileWorkspacePathValidationFailure(validation),
      status: "invalid",
      workspaceMode: "openmeld_managed",
    };
  }

  return buildReadyResolution({
    configPath: workspaceConfig.path,
    configuredWorkspacePath,
    effectiveRuntimeWorkingDirectory: configuredWorkspacePath,
    workspaceMode: "openmeld_managed",
  });
}

function buildReadyResolution(input: {
  configPath: string;
  configuredWorkspacePath: string;
  effectiveRuntimeWorkingDirectory: string;
  workspaceMode: "openmeld_managed" | "custom";
}): ProfileWorkspaceRuntimeResolution {
  const runtimeContext = providerDispatchRuntimeContextSchema.safeParse({
    providerRuntimeWorkingDirectory: input.effectiveRuntimeWorkingDirectory,
  });
  if (!runtimeContext.success) {
    return {
      configPath: input.configPath,
      configuredWorkspacePath: input.configuredWorkspacePath,
      reasonCode: "workspace.invalid",
      reasonText: `Profile workspace runtime context is invalid for ${input.effectiveRuntimeWorkingDirectory}.`,
      status: "invalid",
      workspaceMode: input.workspaceMode,
    };
  }
  return {
    configPath: input.configPath,
    configuredWorkspacePath: input.configuredWorkspacePath,
    effectiveRuntimeWorkingDirectory: input.effectiveRuntimeWorkingDirectory,
    runtimeContext: runtimeContext.data,
    status: "ready",
    workspaceMode: input.workspaceMode,
  };
}

function resolveInvalidConfigReasonText(input: {
  openMeldProfileId: string;
  configPath: string;
  reason: "invalid_json" | "invalid_schema" | "profile_id_mismatch";
}): string {
  switch (input.reason) {
    case "invalid_json":
      return `Profile workspace config for ${input.openMeldProfileId} is not valid JSON at ${input.configPath}.`;
    case "invalid_schema":
      return `Profile workspace config for ${input.openMeldProfileId} is invalid at ${input.configPath}.`;
    case "profile_id_mismatch":
      return `Profile workspace config for ${input.openMeldProfileId} does not match the stored profile id at ${input.configPath}.`;
    default:
      return `Profile workspace config for ${input.openMeldProfileId} is invalid at ${input.configPath}.`;
  }
}

async function resolveAccountKey(
  account: OpenMeldAccountKey | undefined
): Promise<OpenMeldAccountKey> {
  if (account) {
    return account;
  }
  const accountContext = await resolveCurrentOpenMeldAccountContext();
  return accountContext.key;
}
