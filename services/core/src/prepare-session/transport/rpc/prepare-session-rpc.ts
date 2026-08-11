import {
  createPrepareSessionRequestSchema,
  openMeldRequestContextSchema,
  prepareOpaqueTokenSchema,
  prepareSetupBootstrapWriteSchema,
  terminalLocalAgentCatalogWriteSchema,
  terminalStepWriteSchema,
  webAgentSelectionWriteSchema,
} from "@openmeld/schemas";
import type {
  CreatePrepareSessionRequest,
  OpenMeldRequestContext,
  PrepareDiagnosticResponse,
  PrepareOpaqueToken,
  PrepareSessionResponse,
  PrepareSessionWithTokenResponse,
  PrepareSetupBootstrapWrite,
  TerminalLocalAgentCatalogWrite,
  TerminalStepWrite,
  WebAgentSelectionWrite,
} from "@openmeld/schemas/types";
import { type CoreBindings, localStateDb } from "../../../lib/bindings";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import type { CoreRpcContextInput } from "../../../rpc/methods";
import { readConnectedComputerIdentityRecord } from "../../../start/infrastructure/d1/connected-computer-repo";
import {
  createPrepareSessionUseCase,
  mintPrepareSessionReconnectTokenUseCase,
  PrepareSessionNavigationActionAlreadyStartedError,
  PrepareSessionNotFoundError,
  PrepareSessionRevisionConflictError,
  PrepareSessionSetupBootstrapNotReadyError,
  PrepareSessionTerminalConnectionStaleError,
  PrepareSessionTokenInvalidError,
  readPrepareDiagnosticUseCase,
  readPrepareSessionSnapshotUseCase,
  resolvePrepareSessionTokenUseCase,
  writeSetupBootstrapResultUseCase,
  writeTerminalLocalAgentCatalogUseCase,
  writeTerminalStepUseCase,
  writeWebAgentSelectionUseCase,
} from "../../application/prepare-session-service";

export type CreatePrepareSessionInput = CreatePrepareSessionRequest & {
  context?: CoreRpcContextInput;
};

export type GetPrepareSessionInput = {
  prepareSessionId: string;
  context?: CoreRpcContextInput;
};

export type MintPrepareSessionReconnectTokenInput = {
  prepareSessionId: string;
  context?: CoreRpcContextInput;
};

export type ResolvePrepareSessionTokenInput = {
  opaqueToken: PrepareOpaqueToken;
};

export type WritePrepareAgentSelectionInput = WebAgentSelectionWrite & {
  context?: CoreRpcContextInput;
};

export type WritePrepareSetupBootstrapInput = PrepareSetupBootstrapWrite & {
  context?: CoreRpcContextInput;
};

export type WritePrepareTerminalStepInput = TerminalStepWrite;
export type WritePrepareTerminalLocalAgentCatalogInput =
  TerminalLocalAgentCatalogWrite;

export async function rpcCreatePrepareSession(
  env: CoreBindings,
  input: CreatePrepareSessionInput
): Promise<PrepareSessionWithTokenResponse> {
  const context = requireRpcContext(input.context);
  const parsed = createPrepareSessionRequestSchema.safeParse({
    connectedComputerId: input.connectedComputerId,
    humanProfileId: input.humanProfileId,
    deviceId: input.deviceId,
    runtimeLane: input.runtimeLane,
    targetSpaceId: input.targetSpaceId,
    selectedLocalAgentIds: input.selectedLocalAgentIds,
    sourceNavigationAction: input.sourceNavigationAction,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ?? "invalid prepare session payload",
      code: "invalid_payload",
    });
  }
  const db = requirePrepareSessionDb(env);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  if (parsed.data.connectedComputerId) {
    const connectedComputer = await readConnectedComputerIdentityRecord({
      connectedComputerId: parsed.data.connectedComputerId,
      db,
      userId: ownerUserId,
    });
    if (connectedComputer === null) {
      throw createCoreRpcHttpError({
        status: 409,
        reason:
          "This computer is no longer connected to this OpenMeld account.",
        code: "connected_computer.reconnect_target_invalid",
      });
    }
  }
  const result = await mapPrepareSessionErrors(async () => {
    return await createPrepareSessionUseCase({
      db,
      ownerUserId,
      request: parsed.data,
    });
  });
  return {
    snapshot: result.snapshot,
    opaqueToken: result.opaqueToken,
    opaqueTokenExpiresAt: result.opaqueTokenExpiresAt,
  };
}

export async function rpcGetPrepareSession(
  env: CoreBindings,
  input: GetPrepareSessionInput
): Promise<PrepareSessionResponse> {
  const context = requireRpcContext(input.context);
  const snapshot = await readPrepareSessionSnapshot(env, {
    prepareSessionId: input.prepareSessionId,
    ownerUserId: requireAuthenticatedOwnerUserId(context),
  });
  return { snapshot };
}

export async function rpcMintPrepareSessionReconnectToken(
  env: CoreBindings,
  input: MintPrepareSessionReconnectTokenInput
): Promise<PrepareSessionWithTokenResponse> {
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  const token = await mapPrepareSessionErrors(async () => {
    return await mintPrepareSessionReconnectTokenUseCase({
      db: requirePrepareSessionDb(env),
      prepareSessionId: normalizePrepareSessionId(input.prepareSessionId),
      ownerUserId,
    });
  });
  const snapshot = await readPrepareSessionSnapshot(env, {
    prepareSessionId: input.prepareSessionId,
    ownerUserId,
  });
  return {
    snapshot,
    opaqueToken: token.opaqueToken,
    opaqueTokenExpiresAt: token.opaqueTokenExpiresAt,
  };
}

export async function rpcResolvePrepareSessionToken(
  env: CoreBindings,
  input: ResolvePrepareSessionTokenInput
): Promise<PrepareSessionResponse> {
  const parsed = prepareOpaqueTokenSchema.safeParse(input.opaqueToken);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "invalid prepare session token",
      code: "prepare.session.token_invalid",
    });
  }
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await resolvePrepareSessionTokenUseCase({
      db: requirePrepareSessionDb(env),
      opaqueToken: parsed.data,
    });
  });
  return { snapshot };
}

export async function rpcWritePrepareAgentSelection(
  env: CoreBindings,
  input: WritePrepareAgentSelectionInput
): Promise<PrepareSessionResponse> {
  const context = requireRpcContext(input.context);
  const parsed = webAgentSelectionWriteSchema.safeParse({
    prepareSessionId: input.prepareSessionId,
    expectedRevision: input.expectedRevision,
    localAgentIds: input.localAgentIds,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ?? "invalid prepare agent selection",
      code: "invalid_payload",
    });
  }
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  const current = await readPrepareSessionSnapshot(env, {
    prepareSessionId: parsed.data.prepareSessionId,
    ownerUserId,
  });
  if (current.sessionRevision !== parsed.data.expectedRevision) {
    throw createCoreRpcHttpError({
      status: 409,
      reason: "prepare session revision conflict",
      code: "prepare.session.revision_conflict",
    });
  }
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await writeWebAgentSelectionUseCase({
      db: requirePrepareSessionDb(env),
      write: parsed.data,
    });
  });
  return { snapshot };
}

export async function rpcWritePrepareSetupBootstrap(
  env: CoreBindings,
  input: WritePrepareSetupBootstrapInput
): Promise<PrepareSessionResponse> {
  const context = requireRpcContext(input.context);
  const parsed = prepareSetupBootstrapWriteSchema.safeParse({
    prepareSessionId: input.prepareSessionId,
    setupBootstrap: input.setupBootstrap,
  });
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid prepare setup bootstrap result",
      code: "invalid_payload",
    });
  }
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await writeSetupBootstrapResultUseCase({
      db: requirePrepareSessionDb(env),
      ownerUserId: requireAuthenticatedOwnerUserId(context),
      write: parsed.data,
    });
  });
  return { snapshot };
}

export async function rpcWritePrepareTerminalStep(
  env: CoreBindings,
  input: WritePrepareTerminalStepInput
): Promise<PrepareSessionResponse> {
  const parsed = terminalStepWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ?? "invalid prepare terminal step",
      code: "invalid_payload",
    });
  }
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await writeTerminalStepUseCase({
      db: requirePrepareSessionDb(env),
      write: parsed.data,
    });
  });
  return { snapshot };
}

export async function rpcWritePrepareTerminalLocalAgentCatalog(
  env: CoreBindings,
  input: WritePrepareTerminalLocalAgentCatalogInput
): Promise<PrepareSessionResponse> {
  const parsed = terminalLocalAgentCatalogWriteSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 400,
      reason:
        parsed.error.issues[0]?.message ??
        "invalid prepare terminal local agent catalog",
      code: "invalid_payload",
    });
  }
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await writeTerminalLocalAgentCatalogUseCase({
      db: requirePrepareSessionDb(env),
      write: parsed.data,
    });
  });
  return { snapshot };
}

export async function rpcGetPrepareDiagnostic(
  env: CoreBindings,
  input: GetPrepareSessionInput
): Promise<PrepareDiagnosticResponse> {
  const context = requireRpcContext(input.context);
  const ownerUserId = requireAuthenticatedOwnerUserId(context);
  await readPrepareSessionSnapshot(env, {
    prepareSessionId: input.prepareSessionId,
    ownerUserId,
  });
  return await mapPrepareSessionErrors(async () => {
    return await readPrepareDiagnosticUseCase({
      db: requirePrepareSessionDb(env),
      prepareSessionId: normalizePrepareSessionId(input.prepareSessionId),
    });
  });
}

async function readPrepareSessionSnapshot(
  env: CoreBindings,
  input: {
    prepareSessionId: string;
    ownerUserId: string;
  }
) {
  const snapshot = await mapPrepareSessionErrors(async () => {
    return await readPrepareSessionSnapshotUseCase({
      db: requirePrepareSessionDb(env),
      prepareSessionId: normalizePrepareSessionId(input.prepareSessionId),
    });
  });
  if (snapshot.ownerUserId !== input.ownerUserId) {
    throw new PrepareSessionNotFoundError();
  }
  return snapshot;
}

function requirePrepareSessionDb(env: CoreBindings): D1Database {
  const db = localStateDb(env);
  if (!db) {
    throw createCoreRpcHttpError({
      status: 503,
      reason: "prepare session store unavailable",
      code: "prepare.session.store_unavailable",
    });
  }
  return db;
}

function requireRpcContext(
  context?: CoreRpcContextInput
): OpenMeldRequestContext {
  const parsed = openMeldRequestContextSchema.safeParse(context);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "authentication required",
      code: "auth.unauthenticated",
    });
  }
  return parsed.data;
}

function requireAuthenticatedOwnerUserId(
  context: OpenMeldRequestContext
): string {
  const ownerUserId = String(context.actorContext.ownerUserId ?? "").trim();
  if (!ownerUserId) {
    throw createCoreRpcHttpError({
      status: 401,
      reason: "authentication required",
      code: "auth.unauthenticated",
    });
  }
  return ownerUserId;
}

function normalizePrepareSessionId(value: unknown): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw createCoreRpcHttpError({
      status: 400,
      reason: "invalid prepare session id",
      code: "invalid_payload",
    });
  }
  return normalized;
}

async function mapPrepareSessionErrors<T>(
  execute: () => Promise<T>
): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof PrepareSessionNavigationActionAlreadyStartedError) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: "prepare.session.navigation_action_already_started",
      });
    }
    if (error instanceof PrepareSessionNotFoundError) {
      throw createCoreRpcHttpError({
        status: 404,
        reason: error.message,
        code: "prepare.session.not_found",
      });
    }
    if (error instanceof PrepareSessionTokenInvalidError) {
      throw createCoreRpcHttpError({
        status: 404,
        reason: error.message,
        code: "prepare.session.token_invalid",
      });
    }
    if (error instanceof PrepareSessionRevisionConflictError) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: "prepare.session.revision_conflict",
      });
    }
    if (error instanceof PrepareSessionTerminalConnectionStaleError) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: "prepare.session.terminal_stale",
      });
    }
    if (error instanceof PrepareSessionSetupBootstrapNotReadyError) {
      throw createCoreRpcHttpError({
        status: 409,
        reason: error.message,
        code: "prepare.session.not_ready",
      });
    }
    throw error;
  }
}
