import { constants } from "node:fs";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { OpenMeldProfile } from "../../config/openmeld-profiles-api";
import { resolveOpenMeldEnvPreset } from "../../config/paths";
import { withOpenClawBootstrapLock } from "./bootstrap-lock";
import {
  type OpenClawLocalBootstrapState,
  OpenClawLocalBootstrapStoreError,
  readOpenClawLocalBootstrapState,
  resolveOpenClawLocalBootstrapPaths,
  writeOpenClawLocalBootstrapState,
} from "./local-bootstrap-store";
import {
  findOpenClawAgentById,
  findOpenClawAgentsByWorkspace,
  matchesExpectedWorkspace,
  normalizeOptionalText,
  OPENCLAW_AUTH_PROFILE_FILENAME,
  type OpenClawAuthStatus,
  resolveDefaultOpenClawAgent,
  resolveOpenClawAuthStatus,
  resolveOpenClawProviderRuntimeWorkingDirectory,
} from "./local-state";
import {
  buildOpenClawBootstrapAgentId,
  buildOpenClawBootstrapIdentityName,
  buildOpenClawLegacyBootstrapAgentId,
} from "./naming";
import {
  createOpenClawAgent,
  listOpenClawAgents,
  listOpenClawGatewayAgents,
  type OpenClawAgentSummary,
  restartOpenClawGateway,
  setOpenClawAgentIdentity,
} from "./official-cli";

export const OPENCLAW_LOCAL_BOOTSTRAP_VERSION = 1;
const OPENCLAW_GATEWAY_VISIBILITY_POLL_ATTEMPTS = 5;
const OPENCLAW_GATEWAY_VISIBILITY_POLL_DELAY_MS = 400;

export class OpenClawLocalBootstrapError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.code = input.code;
    this.name = "OpenClawLocalBootstrapError";
  }
}

export type OpenClawGatewayVisibilityStatus =
  | "missing_after_restart"
  | "missing_before_restart"
  | "visible"
  | "visible_after_restart";

export type OpenClawGatewayVisibilityResult = {
  agentId: string;
  gatewayRestartAttempted: boolean;
  gatewayVisibility: OpenClawGatewayVisibilityStatus;
};

export class OpenClawGatewayVisibilityError extends Error {
  readonly code: string;
  readonly diagnostics: OpenClawGatewayVisibilityResult;

  constructor(input: {
    code: string;
    diagnostics: OpenClawGatewayVisibilityResult;
    message: string;
  }) {
    super(input.message);
    this.code = input.code;
    this.diagnostics = input.diagnostics;
    this.name = "OpenClawGatewayVisibilityError";
  }
}

export type OpenClawLocalBootstrapResult = {
  agentId: string;
  authStatus: OpenClawAuthStatus;
  bootstrapVersion: number;
  created: boolean;
  resolution: "adopted" | "created" | "recreated" | "reused";
};

type OpenClawLocalBootstrapDeps = {
  createAgent: typeof createOpenClawAgent;
  copyAuthFile: typeof copyAuthFile;
  listAgents: typeof listOpenClawAgents;
  readBootstrapState: typeof readOpenClawLocalBootstrapState;
  setIdentity: typeof setOpenClawAgentIdentity;
  writeBootstrapState: typeof writeOpenClawLocalBootstrapState;
};

type OpenClawGatewayVisibilityDeps = {
  listGatewayAgents: typeof listOpenClawGatewayAgents;
  restartGateway: typeof restartOpenClawGateway;
};

type OpenClawBootstrapContext = {
  openMeldProfileId: string;
  bootstrapPaths: ReturnType<typeof resolveOpenClawLocalBootstrapPaths>;
  bootstrapRead: Awaited<ReturnType<typeof readOpenClawBootstrapState>>;
  providerRuntimeWorkingDirectory: string;
  deps: OpenClawLocalBootstrapDeps;
  expectedAgentId: string;
  identityName: string;
  laneKey: string;
  legacyAgentId: string;
  listedAgents: OpenClawAgentSummary[];
  openClawBin?: string;
  profileName: string;
  workspaceAgents: OpenClawAgentSummary[];
};

const DEFAULT_OPENCLAW_LOCAL_BOOTSTRAP_DEPS: OpenClawLocalBootstrapDeps &
  OpenClawGatewayVisibilityDeps = {
  createAgent: createOpenClawAgent,
  copyAuthFile,
  listGatewayAgents: listOpenClawGatewayAgents,
  listAgents: listOpenClawAgents,
  readBootstrapState: readOpenClawLocalBootstrapState,
  restartGateway: restartOpenClawGateway,
  setIdentity: setOpenClawAgentIdentity,
  writeBootstrapState: writeOpenClawLocalBootstrapState,
};

export async function ensureOpenClawLocalBootstrap(
  input: {
    providerRuntimeWorkingDirectory?: string;
    openClawBin?: string;
    profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
  },
  deps: OpenClawLocalBootstrapDeps = DEFAULT_OPENCLAW_LOCAL_BOOTSTRAP_DEPS
): Promise<OpenClawLocalBootstrapResult> {
  return await withOpenClawBootstrapLock({
    openMeldProfileId: input.profile.openMeldProfileId,
    run: async () => {
      const context = await buildOpenClawBootstrapContext(input, deps);
      return await resolveOpenClawBootstrapResult(context);
    },
  });
}

async function buildOpenClawBootstrapContext(
  input: {
    providerRuntimeWorkingDirectory?: string;
    openClawBin?: string;
    profile: Pick<OpenMeldProfile, "openMeldProfileId" | "profileName">;
  },
  deps: OpenClawLocalBootstrapDeps
): Promise<OpenClawBootstrapContext> {
  const providerRuntimeWorkingDirectory =
    resolveProviderRuntimeWorkingDirectory(
      input.providerRuntimeWorkingDirectory
    );
  const laneKey = resolveOpenMeldEnvPreset();
  const bootstrapPaths = resolveOpenClawLocalBootstrapPaths({
    openMeldProfileId: input.profile.openMeldProfileId,
  });
  const bootstrapRead = await readOpenClawBootstrapState({
    openMeldProfileId: input.profile.openMeldProfileId,
    readBootstrapState: deps.readBootstrapState,
  });
  const listedAgents = await deps.listAgents({
    cwd: providerRuntimeWorkingDirectory,
    openClawBin: input.openClawBin,
  });

  return {
    openMeldProfileId: input.profile.openMeldProfileId,
    bootstrapPaths,
    bootstrapRead,
    deps,
    expectedAgentId: buildOpenClawBootstrapAgentId({
      openMeldProfileId: input.profile.openMeldProfileId,
      laneKey,
      profileName: input.profile.profileName,
    }),
    identityName: buildOpenClawBootstrapIdentityName(input.profile.profileName),
    laneKey,
    legacyAgentId: buildOpenClawLegacyBootstrapAgentId({
      openMeldProfileId: input.profile.openMeldProfileId,
      profileName: input.profile.profileName,
    }),
    listedAgents,
    openClawBin: input.openClawBin,
    profileName: input.profile.profileName,
    providerRuntimeWorkingDirectory,
    workspaceAgents: findOpenClawAgentsByWorkspace({
      agents: listedAgents,
      workspace: providerRuntimeWorkingDirectory,
    }),
  };
}

async function resolveOpenClawBootstrapResult(
  context: OpenClawBootstrapContext
): Promise<OpenClawLocalBootstrapResult> {
  switch (context.bootstrapRead.kind) {
    case "existing":
      return await finalizeExistingOpenClawBootstrap({
        context,
        existingBinding: context.bootstrapRead.state,
      });
    case "invalid":
      return await finalizeInvalidOpenClawBootstrap({
        context,
        invalidReadError: context.bootstrapRead.error,
      });
    case "missing":
      return await finalizeMissingOpenClawBootstrap(context);
    default: {
      const unexpectedState: never = context.bootstrapRead;
      throw new OpenClawLocalBootstrapError({
        code: "openclaw.bootstrap.unknown_state",
        message: `OpenClaw bootstrap entered an unknown state: ${String(unexpectedState)}`,
      });
    }
  }
}

async function finalizeExistingOpenClawBootstrap(input: {
  context: OpenClawBootstrapContext;
  existingBinding: OpenClawLocalBootstrapState;
}): Promise<OpenClawLocalBootstrapResult> {
  const { context, existingBinding } = input;
  if (
    existingBinding.agentId === context.legacyAgentId &&
    context.expectedAgentId !== context.legacyAgentId
  ) {
    return await finalizeLegacyOpenClawBootstrap({
      context,
      existingBinding,
    });
  }
  const boundAgent = findOpenClawAgentById({
    agentId: existingBinding.agentId,
    agents: context.listedAgents,
  });

  if (!boundAgent) {
    assertUnambiguousWorkspace({
      workspace: context.providerRuntimeWorkingDirectory,
      workspaceAgents: context.workspaceAgents,
    });
    const occupyingAgent = context.workspaceAgents[0];
    if (occupyingAgent) {
      throw new OpenClawLocalBootstrapError({
        code: "openclaw.bootstrap.binding_conflict",
        message: `local OpenClaw bootstrap metadata points to missing agent '${existingBinding.agentId}', but workspace '${context.providerRuntimeWorkingDirectory}' is occupied by '${occupyingAgent.agentId}'`,
      });
    }
    const recreated = await createAndResolveOpenClawAgent({
      agentId: existingBinding.agentId,
      createAgent: context.deps.createAgent,
      cwd: context.providerRuntimeWorkingDirectory,
      listAgents: context.deps.listAgents,
      openClawBin: context.openClawBin,
      workspaceDir: context.providerRuntimeWorkingDirectory,
    });
    return await finalizeOpenClawBootstrap({
      agent: recreated.agent,
      agentId: existingBinding.agentId,
      agents: recreated.agents,
      bootstrapVersion: existingBinding.bootstrapVersion,
      copyAuthFile: context.deps.copyAuthFile,
      created: recreated.created,
      cwd: context.providerRuntimeWorkingDirectory,
      identityName: context.identityName,
      openClawBin: context.openClawBin,
      resolution: recreated.created ? "recreated" : "reused",
      setIdentity: context.deps.setIdentity,
    });
  }

  assertOpenClawWorkspaceMatch({
    actualWorkspace: boundAgent.workspace,
    agentId: existingBinding.agentId,
    expectedWorkspace: context.providerRuntimeWorkingDirectory,
  });
  return await finalizeOpenClawBootstrap({
    agent: boundAgent,
    agentId: existingBinding.agentId,
    agents: context.listedAgents,
    bootstrapVersion: existingBinding.bootstrapVersion,
    copyAuthFile: context.deps.copyAuthFile,
    created: false,
    cwd: context.providerRuntimeWorkingDirectory,
    identityName: context.identityName,
    openClawBin: context.openClawBin,
    resolution: "reused",
    setIdentity: context.deps.setIdentity,
  });
}

async function finalizeInvalidOpenClawBootstrap(input: {
  context: OpenClawBootstrapContext;
  invalidReadError: OpenClawLocalBootstrapError;
}): Promise<OpenClawLocalBootstrapResult> {
  const adoptedAgent =
    input.context.workspaceAgents.length === 1
      ? input.context.workspaceAgents[0]
      : null;
  if (!adoptedAgent) {
    throw input.invalidReadError;
  }

  await persistOpenClawBootstrapState({
    agentId: adoptedAgent.agentId,
    openMeldProfileId: input.context.openMeldProfileId,
    writeBootstrapState: input.context.deps.writeBootstrapState,
  });
  return await finalizeOpenClawBootstrap({
    agent: adoptedAgent,
    agentId: adoptedAgent.agentId,
    agents: input.context.listedAgents,
    bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
    copyAuthFile: input.context.deps.copyAuthFile,
    created: false,
    cwd: input.context.providerRuntimeWorkingDirectory,
    identityName: input.context.identityName,
    openClawBin: input.context.openClawBin,
    resolution: "adopted",
    setIdentity: input.context.deps.setIdentity,
  });
}

async function finalizeMissingOpenClawBootstrap(
  context: OpenClawBootstrapContext
): Promise<OpenClawLocalBootstrapResult> {
  const adoptedAgent = requireUniqueWorkspaceAgent(context.workspaceAgents);
  if (adoptedAgent) {
    await persistOpenClawBootstrapState({
      agentId: adoptedAgent.agentId,
      openMeldProfileId: context.openMeldProfileId,
      writeBootstrapState: context.deps.writeBootstrapState,
    });
    return await finalizeOpenClawBootstrap({
      agent: adoptedAgent,
      agentId: adoptedAgent.agentId,
      agents: context.listedAgents,
      bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
      copyAuthFile: context.deps.copyAuthFile,
      created: false,
      cwd: context.providerRuntimeWorkingDirectory,
      identityName: context.identityName,
      openClawBin: context.openClawBin,
      resolution: "adopted",
      setIdentity: context.deps.setIdentity,
    });
  }

  const agentId = context.expectedAgentId;
  const createdAgent = await createAndResolveOpenClawAgent({
    agentId,
    createAgent: context.deps.createAgent,
    cwd: context.providerRuntimeWorkingDirectory,
    listAgents: context.deps.listAgents,
    openClawBin: context.openClawBin,
    workspaceDir: context.providerRuntimeWorkingDirectory,
  });
  await persistOpenClawBootstrapState({
    agentId,
    openMeldProfileId: context.openMeldProfileId,
    writeBootstrapState: context.deps.writeBootstrapState,
  });
  return await finalizeOpenClawBootstrap({
    agent: createdAgent.agent,
    agentId,
    agents: createdAgent.agents,
    bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
    copyAuthFile: context.deps.copyAuthFile,
    created: createdAgent.created,
    cwd: context.providerRuntimeWorkingDirectory,
    identityName: context.identityName,
    openClawBin: context.openClawBin,
    resolution: createdAgent.created ? "created" : "adopted",
    setIdentity: context.deps.setIdentity,
  });
}

async function finalizeLegacyOpenClawBootstrap(input: {
  context: OpenClawBootstrapContext;
  existingBinding: OpenClawLocalBootstrapState;
}): Promise<OpenClawLocalBootstrapResult> {
  const reboundAgent = findOpenClawAgentById({
    agentId: input.context.expectedAgentId,
    agents: input.context.listedAgents,
  });
  if (reboundAgent) {
    assertOpenClawWorkspaceMatch({
      actualWorkspace: reboundAgent.workspace,
      agentId: reboundAgent.agentId,
      expectedWorkspace: input.context.providerRuntimeWorkingDirectory,
    });
    await persistOpenClawBootstrapState({
      agentId: reboundAgent.agentId,
      openMeldProfileId: input.context.openMeldProfileId,
      writeBootstrapState: input.context.deps.writeBootstrapState,
    });
    return await finalizeOpenClawBootstrap({
      agent: reboundAgent,
      agentId: reboundAgent.agentId,
      agents: input.context.listedAgents,
      bootstrapVersion: input.existingBinding.bootstrapVersion,
      copyAuthFile: input.context.deps.copyAuthFile,
      created: false,
      cwd: input.context.providerRuntimeWorkingDirectory,
      identityName: input.context.identityName,
      openClawBin: input.context.openClawBin,
      resolution: "adopted",
      setIdentity: input.context.deps.setIdentity,
    });
  }

  const legacyAgent = findOpenClawAgentById({
    agentId: input.existingBinding.agentId,
    agents: input.context.listedAgents,
  });
  if (
    legacyAgent &&
    matchesExpectedWorkspace({
      actualWorkspace: legacyAgent.workspace,
      expectedWorkspace: input.context.providerRuntimeWorkingDirectory,
    })
  ) {
    await persistOpenClawBootstrapState({
      agentId: legacyAgent.agentId,
      openMeldProfileId: input.context.openMeldProfileId,
      writeBootstrapState: input.context.deps.writeBootstrapState,
    });
    return await finalizeOpenClawBootstrap({
      agent: legacyAgent,
      agentId: legacyAgent.agentId,
      agents: input.context.listedAgents,
      bootstrapVersion: input.existingBinding.bootstrapVersion,
      copyAuthFile: input.context.deps.copyAuthFile,
      created: false,
      cwd: input.context.providerRuntimeWorkingDirectory,
      identityName: input.context.identityName,
      openClawBin: input.context.openClawBin,
      resolution: "reused",
      setIdentity: input.context.deps.setIdentity,
    });
  }

  const createdAgent = await createAndResolveOpenClawAgent({
    agentId: input.context.expectedAgentId,
    createAgent: input.context.deps.createAgent,
    cwd: input.context.providerRuntimeWorkingDirectory,
    listAgents: input.context.deps.listAgents,
    openClawBin: input.context.openClawBin,
    workspaceDir: input.context.providerRuntimeWorkingDirectory,
  });
  await persistOpenClawBootstrapState({
    agentId: input.context.expectedAgentId,
    openMeldProfileId: input.context.openMeldProfileId,
    writeBootstrapState: input.context.deps.writeBootstrapState,
  });
  return await finalizeOpenClawBootstrap({
    agent: createdAgent.agent,
    agentId: input.context.expectedAgentId,
    agents: createdAgent.agents,
    bootstrapVersion: input.existingBinding.bootstrapVersion,
    copyAuthFile: input.context.deps.copyAuthFile,
    created: createdAgent.created,
    cwd: input.context.providerRuntimeWorkingDirectory,
    identityName: input.context.identityName,
    openClawBin: input.context.openClawBin,
    resolution: createdAgent.created ? "recreated" : "adopted",
    setIdentity: input.context.deps.setIdentity,
  });
}

export async function ensureOpenClawGatewayAgentVisible(
  input: {
    agentId: string;
    providerRuntimeWorkingDirectory?: string;
    openClawBin?: string;
  },
  deps: OpenClawGatewayVisibilityDeps = DEFAULT_OPENCLAW_LOCAL_BOOTSTRAP_DEPS
): Promise<OpenClawGatewayVisibilityResult> {
  const providerRuntimeWorkingDirectory =
    resolveProviderRuntimeWorkingDirectory(
      input.providerRuntimeWorkingDirectory
    );
  const agentId = normalizeOptionalText(input.agentId);
  if (!agentId) {
    throw new OpenClawGatewayVisibilityError({
      code: "openclaw.gateway.invalid_agent_id",
      diagnostics: {
        agentId: "unknown",
        gatewayRestartAttempted: false,
        gatewayVisibility: "missing_before_restart",
      },
      message: "OpenClaw gateway visibility check requires a valid agentId",
    });
  }

  try {
    if (
      await isOpenClawGatewayAgentVisible({
        agentId,
        cwd: providerRuntimeWorkingDirectory,
        listGatewayAgents: deps.listGatewayAgents,
        openClawBin: input.openClawBin,
      })
    ) {
      return {
        agentId,
        gatewayRestartAttempted: false,
        gatewayVisibility: "visible",
      };
    }
  } catch {
    // Fall through to one official restart attempt so OpenMeld can recover from a stale
    // or stopped gateway without inventing a provider-specific reload path.
  }

  try {
    await deps.restartGateway({
      cwd: providerRuntimeWorkingDirectory,
      openClawBin: input.openClawBin,
    });
  } catch (error) {
    throw new OpenClawGatewayVisibilityError({
      code: "openclaw.gateway.restart_failed",
      diagnostics: {
        agentId,
        gatewayRestartAttempted: true,
        gatewayVisibility: "missing_before_restart",
      },
      message: `OpenClaw gateway restart failed while making agent '${agentId}' visible: ${toErrorMessage(error)}`,
    });
  }

  let lastVisibilityError: unknown = null;
  for (
    let attemptIndex = 0;
    attemptIndex < OPENCLAW_GATEWAY_VISIBILITY_POLL_ATTEMPTS;
    attemptIndex += 1
  ) {
    try {
      if (
        await isOpenClawGatewayAgentVisible({
          agentId,
          cwd: providerRuntimeWorkingDirectory,
          listGatewayAgents: deps.listGatewayAgents,
          openClawBin: input.openClawBin,
        })
      ) {
        return {
          agentId,
          gatewayRestartAttempted: true,
          gatewayVisibility: "visible_after_restart",
        };
      }
      lastVisibilityError = null;
    } catch (error) {
      lastVisibilityError = error;
    }
    if (attemptIndex < OPENCLAW_GATEWAY_VISIBILITY_POLL_ATTEMPTS - 1) {
      await delay(OPENCLAW_GATEWAY_VISIBILITY_POLL_DELAY_MS);
    }
  }

  throw new OpenClawGatewayVisibilityError({
    code: "openclaw.gateway.agent_not_visible",
    diagnostics: {
      agentId,
      gatewayRestartAttempted: true,
      gatewayVisibility: "missing_after_restart",
    },
    message:
      lastVisibilityError === null
        ? `OpenClaw gateway is running but agent '${agentId}' is still not visible after a gateway restart`
        : `OpenClaw gateway still cannot confirm agent '${agentId}' after a gateway restart: ${toErrorMessage(lastVisibilityError)}`,
  });
}

async function maybeCopyOpenClawAuth(input: {
  agents: OpenClawAgentSummary[];
  copyAuthFile: typeof copyAuthFile;
  targetAgent: OpenClawAgentSummary;
}): Promise<OpenClawAuthStatus> {
  const destinationPath = join(
    input.targetAgent.agentDir,
    OPENCLAW_AUTH_PROFILE_FILENAME
  );
  if (await pathExists(destinationPath)) {
    return "present";
  }

  const authStatus = await resolveOpenClawAuthStatus({
    agents: input.agents,
    targetAgent: input.targetAgent,
  });
  if (authStatus === "source_missing") {
    return authStatus;
  }

  const defaultAgent = resolveDefaultOpenClawAgent(input.agents);
  if (!defaultAgent) {
    return "source_missing";
  }
  const sourcePath = join(
    defaultAgent.agentDir,
    OPENCLAW_AUTH_PROFILE_FILENAME
  );
  await ensureParentDirectory(destinationPath);
  try {
    await input.copyAuthFile(sourcePath, destinationPath);
  } catch (error) {
    if (isFileExistsError(error)) {
      return "present";
    }
    throw error;
  }
  return "copied";
}

async function isOpenClawGatewayAgentVisible(input: {
  agentId: string;
  cwd: string;
  listGatewayAgents: typeof listOpenClawGatewayAgents;
  openClawBin?: string;
}): Promise<boolean> {
  const agents = await input.listGatewayAgents({
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
  return agents.some((agent) => agent.agentId === input.agentId);
}

async function copyAuthFile(
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
}

function isFileExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof (error as NodeJS.ErrnoException).code === "string" &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

async function ensureParentDirectory(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

async function pathExists(path: string): Promise<boolean> {
  return await access(path, constants.F_OK)
    .then(() => true)
    .catch(() => false);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeBootstrapReadError(
  error: unknown
): OpenClawLocalBootstrapError | never {
  if (error instanceof OpenClawLocalBootstrapStoreError) {
    return new OpenClawLocalBootstrapError({
      code: error.code,
      message: error.message,
    });
  }
  throw error;
}

async function readOpenClawBootstrapState(input: {
  openMeldProfileId: string;
  readBootstrapState: typeof readOpenClawLocalBootstrapState;
}): Promise<
  | {
      kind: "existing";
      state: OpenClawLocalBootstrapState;
    }
  | {
      kind: "invalid";
      error: OpenClawLocalBootstrapError;
    }
  | {
      kind: "missing";
    }
> {
  try {
    const state = await input.readBootstrapState({
      openMeldProfileId: input.openMeldProfileId,
    });
    if (!state) {
      return { kind: "missing" };
    }
    return { kind: "existing", state };
  } catch (error) {
    return {
      kind: "invalid",
      error: normalizeBootstrapReadError(error),
    };
  }
}

async function createAndResolveOpenClawAgent(input: {
  agentId: string;
  createAgent: typeof createOpenClawAgent;
  cwd: string;
  listAgents: typeof listOpenClawAgents;
  openClawBin?: string;
  workspaceDir: string;
}): Promise<{
  agent: OpenClawAgentSummary;
  agents: OpenClawAgentSummary[];
  created: boolean;
}> {
  await mkdir(input.workspaceDir, { recursive: true });
  let created = true;
  try {
    await input.createAgent({
      agentId: input.agentId,
      cwd: input.cwd,
      openClawBin: input.openClawBin,
      workspace: input.workspaceDir,
    });
  } catch (error) {
    if (!isOpenClawAgentAlreadyExistsError(error)) {
      throw error;
    }
    created = false;
  }

  const refreshedAgents = await input.listAgents({
    cwd: input.cwd,
    openClawBin: input.openClawBin,
  });
  const createdAgent = findOpenClawAgentById({
    agentId: input.agentId,
    agents: refreshedAgents,
  });
  if (!createdAgent) {
    throw new OpenClawLocalBootstrapError({
      code: "openclaw.bootstrap.agent_missing_after_create",
      message: `OpenClaw agent '${input.agentId}' was created but could not be listed afterwards`,
    });
  }
  if (
    !matchesExpectedWorkspace({
      actualWorkspace: createdAgent.workspace,
      expectedWorkspace: input.workspaceDir,
    })
  ) {
    throw new OpenClawLocalBootstrapError({
      code: "openclaw.bootstrap.workspace_mismatch",
      message: `OpenClaw agent '${input.agentId}' was created with workspace '${createdAgent.workspace ?? "unknown"}', expected '${input.workspaceDir}'`,
    });
  }
  return {
    agent: createdAgent,
    agents: refreshedAgents,
    created,
  };
}

async function persistOpenClawBootstrapState(input: {
  agentId: string;
  openMeldProfileId: string;
  writeBootstrapState: typeof writeOpenClawLocalBootstrapState;
}): Promise<void> {
  await input.writeBootstrapState({
    openMeldProfileId: input.openMeldProfileId,
    state: {
      agentId: input.agentId,
      bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
    },
  });
}

async function finalizeOpenClawBootstrap(input: {
  agent: OpenClawAgentSummary;
  agentId: string;
  agents: OpenClawAgentSummary[];
  bootstrapVersion: number;
  copyAuthFile: typeof copyAuthFile;
  created: boolean;
  cwd: string;
  identityName: string;
  openClawBin?: string;
  resolution: OpenClawLocalBootstrapResult["resolution"];
  setIdentity: typeof setOpenClawAgentIdentity;
}): Promise<OpenClawLocalBootstrapResult> {
  const authStatus = await maybeCopyOpenClawAuth({
    agents: input.agents,
    copyAuthFile: input.copyAuthFile,
    targetAgent: input.agent,
  });
  await input.setIdentity({
    agentId: input.agentId,
    cwd: input.cwd,
    identityName: input.identityName,
    openClawBin: input.openClawBin,
  });
  return {
    agentId: input.agentId,
    authStatus,
    bootstrapVersion: input.bootstrapVersion,
    created: input.created,
    resolution: input.resolution,
  };
}

function requireUniqueWorkspaceAgent(
  workspaceAgents: OpenClawAgentSummary[]
): OpenClawAgentSummary | null {
  if (workspaceAgents.length > 1) {
    const workspace =
      normalizeOptionalText(workspaceAgents[0]?.workspace) ?? "unknown";
    assertUnambiguousWorkspace({
      workspace,
      workspaceAgents,
    });
  }
  return workspaceAgents[0] ?? null;
}

function assertUnambiguousWorkspace(input: {
  workspace: string;
  workspaceAgents: OpenClawAgentSummary[];
}): void {
  if (input.workspaceAgents.length <= 1) {
    return;
  }
  const matchingAgentIds = input.workspaceAgents.map(
    (agent) => `'${agent.agentId}'`
  );
  throw new OpenClawLocalBootstrapError({
    code: "openclaw.bootstrap.workspace_ambiguous",
    message: `local OpenClaw bootstrap workspace '${input.workspace}' matches multiple agents: ${matchingAgentIds.join(", ")}`,
  });
}

function assertOpenClawWorkspaceMatch(input: {
  actualWorkspace: string | null | undefined;
  agentId: string;
  expectedWorkspace: string;
}): void {
  if (
    matchesExpectedWorkspace({
      actualWorkspace: input.actualWorkspace,
      expectedWorkspace: input.expectedWorkspace,
    })
  ) {
    return;
  }
  throw new OpenClawLocalBootstrapError({
    code: "openclaw.bootstrap.workspace_mismatch",
    message: `local OpenClaw bootstrap metadata points to agent '${input.agentId}' with workspace '${input.actualWorkspace ?? "unknown"}', expected '${input.expectedWorkspace}'`,
  });
}

function isOpenClawAgentAlreadyExistsError(error: unknown): boolean {
  const normalizedMessage = toErrorMessage(error).toLowerCase();
  return (
    normalizedMessage.includes("agent") &&
    normalizedMessage.includes("already exists")
  );
}

function resolveProviderRuntimeWorkingDirectory(
  value: string | undefined
): string {
  try {
    return resolveOpenClawProviderRuntimeWorkingDirectory(value);
  } catch (error) {
    throw new OpenClawLocalBootstrapError({
      code: "openclaw.bootstrap.invalid_working_directory",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
