import { SPACE_UPDATES_MAX_LIMIT } from "@openmeld/schemas";
import type {
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  buildSpaceRoundReadProjection,
  type SpaceSignalIndex,
} from "@openmeld/space";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { fetchSpaceDispatchLookup } from "../config/space-dispatch-lookup-api";
import { outJsonLine } from "../ui/io";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertFullSignalIdArgument,
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  type StructuredGatewayFailure,
  toStructuredGatewayFailure,
} from "./gateway-response";
import { runSpaceReadWithPasswordRetry } from "./password-flow";
import {
  buildSignalDispatchExecutionEvidence,
  type DispatchExecutionEvidence,
} from "./read-projection/dispatch-execution-evidence";
import { buildFormalSignalReadPayload } from "./read-projection/formal-message-read-output";
import {
  buildIdentityOnlyMembersSnapshotForReadProjection,
  loadSpaceIdentityDirectoryOrNull,
  loadSpaceSignalIndexOrNull,
} from "./read-projection/space-read-projection-context";
import { fetchSpaceUpdates } from "./updates-api";
import { emitSpaceUpdatesHumanOutput } from "./updates-output";

type SpaceUpdatesDispatchExecutionJsonLine = {
  kind: "space.dispatch_execution";
  dispatchExecution: DispatchExecutionEvidence;
};

type SpaceUpdatesDispatchExecutionUnavailableJsonLine = {
  kind: "space.dispatch_execution_unavailable";
  code: string | null;
  message: string;
  requestId: string | null;
  sourceSignalId: string;
};

type SpaceUpdatesRoundReadProjectionJsonLine = {
  kind: "space.round_read_projection";
  roundReadProjection: ReturnType<typeof buildSpaceRoundReadProjection>;
};

type SpaceUpdatesDispatchExecutionLookupState =
  | {
      status: "available";
      dispatchExecution: DispatchExecutionEvidence;
    }
  | {
      status: "not_found";
    }
  | {
      status: "unavailable";
      failure: StructuredGatewayFailure;
    };

type SpaceUpdatesProjectionContext = {
  dispatchExecution: DispatchExecutionEvidence | null;
  dispatchExecutionUnavailable: StructuredGatewayFailure | null;
  identityDirectory: SpaceIdentityDirectory | null;
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
};

function emitSpaceUpdatesJsonOutput(input: {
  dispatchExecution: DispatchExecutionEvidence | null;
  dispatchExecutionUnavailable: StructuredGatewayFailure | null;
  identityDirectory: SpaceIdentityDirectory | null;
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
  signals: Awaited<ReturnType<typeof fetchSpaceUpdates>>["signals"];
  sourceSignalId: string;
}): void {
  if (input.dispatchExecution) {
    outJsonLine({
      kind: "space.dispatch_execution",
      dispatchExecution: input.dispatchExecution,
    } satisfies SpaceUpdatesDispatchExecutionJsonLine);
  } else if (input.dispatchExecutionUnavailable) {
    outJsonLine({
      kind: "space.dispatch_execution_unavailable",
      code: input.dispatchExecutionUnavailable.code,
      message: input.dispatchExecutionUnavailable.message,
      requestId: input.dispatchExecutionUnavailable.requestId,
      sourceSignalId: input.sourceSignalId,
    } satisfies SpaceUpdatesDispatchExecutionUnavailableJsonLine);
  }

  outJsonLine({
    kind: "space.round_read_projection",
    roundReadProjection: buildSpaceRoundReadProjection({
      sourceSignalId: input.sourceSignalId,
      sourceSignal: input.signalIndex?.get(input.sourceSignalId) ?? null,
      dispatchExecution: input.dispatchExecution,
      identityDirectory: input.identityDirectory,
      membersSnapshot: input.membersSnapshot,
      signalIndex: input.signalIndex,
      signals: input.signals,
    }),
  } satisfies SpaceUpdatesRoundReadProjectionJsonLine);

  for (const signal of input.signals) {
    outJsonLine(
      buildFormalSignalReadPayload({
        signal,
        identityDirectory: input.identityDirectory,
        membersSnapshot: input.membersSnapshot,
        signalIndex: input.signalIndex,
      })
    );
  }
}

async function loadAnchorDispatchExecutionEvidence(input: {
  afterSignalId: string;
  baseUrl: string;
  membersSnapshot: SpaceMembersSnapshot | null;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  resolvedPassword: string | undefined;
  signalIndex: SpaceSignalIndex | null;
  space: string;
}): Promise<SpaceUpdatesDispatchExecutionLookupState> {
  try {
    const lookup = await fetchSpaceDispatchLookup({
      requestContext: input.requestContext,
      baseUrl: input.baseUrl,
      space: input.space,
      sourceSignalId: input.afterSignalId,
      password: input.resolvedPassword,
    });
    const dispatchExecution = buildSignalDispatchExecutionEvidence({
      lookup,
      membersSnapshot: input.membersSnapshot,
      signalIndex: input.signalIndex,
      sourceSignal: input.signalIndex?.get(input.afterSignalId) ?? null,
    });
    if (!dispatchExecution) {
      return { status: "not_found" };
    }

    return {
      status: "available",
      dispatchExecution,
    };
  } catch (error) {
    return {
      status: "unavailable",
      failure: toStructuredGatewayFailure(error),
    };
  }
}

async function loadSpaceUpdatesProjectionContext(input: {
  afterSignalId: string;
  baseUrl: string;
  requestContext: ReturnType<typeof buildOpenMeldRequestContextFromProfile>;
  resolvedPassword: string | undefined;
  space: string;
  spaceApi: ReturnType<typeof createCliSpaceApi>;
}): Promise<SpaceUpdatesProjectionContext> {
  const [identityDirectory, signalIndex] = await Promise.all([
    loadSpaceIdentityDirectoryOrNull({
      spaceApi: input.spaceApi,
      spaceId: input.space,
      requestContext: input.requestContext,
      resolvedPassword: input.resolvedPassword,
    }),
    loadSpaceSignalIndexOrNull({
      spaceApi: input.spaceApi,
      spaceId: input.space,
      requestContext: input.requestContext,
      resolvedPassword: input.resolvedPassword,
    }),
  ]);
  const membersSnapshot =
    buildIdentityOnlyMembersSnapshotForReadProjection(identityDirectory);
  const dispatchExecutionState = await loadAnchorDispatchExecutionEvidence({
    afterSignalId: input.afterSignalId,
    baseUrl: input.baseUrl,
    membersSnapshot,
    requestContext: input.requestContext,
    resolvedPassword: input.resolvedPassword,
    signalIndex,
    space: input.space,
  });

  return {
    dispatchExecution:
      dispatchExecutionState.status === "available"
        ? dispatchExecutionState.dispatchExecution
        : null,
    dispatchExecutionUnavailable:
      dispatchExecutionState.status === "unavailable"
        ? dispatchExecutionState.failure
        : null,
    identityDirectory,
    membersSnapshot,
    signalIndex,
  };
}

export async function runSpaceUpdates(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  afterSignalId: string;
  limit: number;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const afterSignalId = String(input.afterSignalId ?? "").trim();
  if (afterSignalId.length === 0) {
    throw new Error("missing required --after-signal value");
  }
  if (!Number.isInteger(input.limit) || input.limit < 1) {
    throw new Error("limit must be a positive integer");
  }
  if (input.limit > SPACE_UPDATES_MAX_LIMIT) {
    throw new Error(
      `limit must be less than or equal to ${String(SPACE_UPDATES_MAX_LIMIT)}`
    );
  }

  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading space updates"
    ),
    entryChecksHandled: input.entryChecksHandled,
  });
  if (context.status === "cancelled") {
    return;
  }

  const { runtime, presenter, interactive, baseUrl } = context;
  assertValidSpaceIdTarget({
    space: input.space,
    resolvedView: runtime.resolvedView,
  });
  assertFullSignalIdArgument({
    value: afterSignalId,
    flag: "--after-signal",
    resolvedView: runtime.resolvedView,
  });
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const spaceApi = createCliSpaceApi(baseUrl);
  const updatesRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human" && !input.json,
    presenter,
    execute: async (password) =>
      await fetchSpaceUpdates({
        requestContext,
        baseUrl,
        space: input.space,
        afterSignalId,
        limit: input.limit,
        password,
      }),
  });
  if (updatesRead.status === "cancelled") {
    return;
  }
  const updates = updatesRead.result;
  const resolvedPassword = updatesRead.password;
  const projectionContext = await loadSpaceUpdatesProjectionContext({
    afterSignalId,
    baseUrl,
    requestContext,
    resolvedPassword,
    space: input.space,
    spaceApi,
  });
  const {
    dispatchExecution,
    dispatchExecutionUnavailable,
    identityDirectory,
    membersSnapshot,
    signalIndex,
  } = projectionContext;

  if (input.json) {
    emitSpaceUpdatesJsonOutput({
      dispatchExecution,
      dispatchExecutionUnavailable,
      identityDirectory,
      membersSnapshot,
      signalIndex,
      sourceSignalId: afterSignalId,
      signals: updates.signals,
    });
    return;
  }

  emitSpaceUpdatesHumanOutput({
    openMeldProfile,
    presenter,
    dispatchExecution,
    dispatchExecutionUnavailable,
    membersSnapshot,
    signals: updates.signals,
    signalIndex,
    afterSignalId,
    limit: input.limit,
  });
}
