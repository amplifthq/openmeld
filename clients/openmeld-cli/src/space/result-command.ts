import type {
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceSignalIndex } from "@openmeld/space";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { outJsonLine } from "../ui/io";
import { createCliSpaceApi, type SpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { toStructuredGatewayFailure } from "./gateway-response";
import { runSpaceReadWithPasswordRetry } from "./password-flow";
import { buildFormalDispatchResultReadPayload } from "./read-projection/formal-message-read-output";
import {
  buildIdentityOnlyMembersSnapshotForReadProjection,
  loadSpaceIdentityDirectoryOrNull,
  loadSpaceSignalIndexOrNull,
} from "./read-projection/space-read-projection-context";
import { fetchSpaceDispatchResult } from "./result-api";
import { emitSpaceDispatchResultHumanOutput } from "./result-output";

type SpaceReadRequestContext = ReturnType<
  typeof buildOpenMeldRequestContextFromProfile
>;

type SpaceResultProjectionContext = {
  identityDirectory: SpaceIdentityDirectory | null;
  membersSnapshot: SpaceMembersSnapshot | null;
  signalIndex: SpaceSignalIndex | null;
};

type SpaceResultReadError = Error & {
  code?: string;
  requestId?: string | null;
  status?: number | null;
};

async function loadSpaceResultProjectionContext(input: {
  requestContext: SpaceReadRequestContext;
  resolvedPassword: string | undefined;
  result: Awaited<ReturnType<typeof fetchSpaceDispatchResult>>;
  spaceApi: SpaceApi;
  spaceId: string;
}): Promise<SpaceResultProjectionContext> {
  const signalIndex = await loadSpaceSignalIndexOrNull({
    spaceApi: input.spaceApi,
    spaceId: input.spaceId,
    requestContext: input.requestContext,
    resolvedPassword: input.resolvedPassword,
    required: true,
  });
  const identityDirectory = await loadSpaceIdentityDirectoryOrNull({
    spaceApi: input.spaceApi,
    spaceId: input.spaceId,
    requestContext: input.requestContext,
    resolvedPassword: input.resolvedPassword,
  });

  return {
    identityDirectory,
    membersSnapshot:
      buildIdentityOnlyMembersSnapshotForReadProjection(identityDirectory),
    signalIndex,
  };
}

function emitSpaceResultJsonOutput(input: {
  identityDirectory: SpaceIdentityDirectory | null;
  membersSnapshot: SpaceMembersSnapshot | null;
  result: Awaited<ReturnType<typeof fetchSpaceDispatchResult>>;
  signalIndex: SpaceSignalIndex | null;
}): void {
  outJsonLine(
    buildFormalDispatchResultReadPayload({
      result: input.result,
      identityDirectory: input.identityDirectory,
      membersSnapshot: input.membersSnapshot,
      signalIndex: input.signalIndex,
    })
  );
}

export async function runSpaceResult(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  dispatchId?: string;
  resultRef?: string;
  password?: string;
  json: boolean;
  view?: string;
  entryChecksHandled?: boolean;
}) {
  const dispatchId = String(input.dispatchId ?? "").trim();
  const resultRef = String(input.resultRef ?? "").trim();
  const selectorCount =
    Number(dispatchId.length > 0) + Number(resultRef.length > 0);
  if (selectorCount !== 1) {
    throw new Error("exactly one of --dispatch or --result-ref is required");
  }

  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading a space dispatch result"
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
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const spaceApi = createCliSpaceApi(baseUrl);
  let resultRead:
    | Awaited<
        ReturnType<
          typeof runSpaceReadWithPasswordRetry<
            Awaited<ReturnType<typeof fetchSpaceDispatchResult>>
          >
        >
      >
    | undefined;
  try {
    resultRead = await runSpaceReadWithPasswordRetry({
      initialPassword: input.password,
      interactive:
        interactive && runtime.resolvedView === "human" && !input.json,
      presenter,
      execute: async (password) =>
        await fetchSpaceDispatchResult({
          requestContext,
          baseUrl,
          space: input.space,
          ...(dispatchId.length > 0 ? { dispatchId } : {}),
          ...(resultRef.length > 0 ? { resultRef } : {}),
          password,
        }),
    });
  } catch (error) {
    throw decorateSpaceResultReadError({
      error,
      humanView: runtime.resolvedView === "human" && !input.json,
    });
  }
  if (resultRead.status === "cancelled") {
    return;
  }
  const result = resultRead.result;
  const resolvedPassword = resultRead.password;
  const projectionContext = await loadSpaceResultProjectionContext({
    result,
    requestContext,
    resolvedPassword,
    spaceApi,
    spaceId: input.space,
  });
  const { identityDirectory, membersSnapshot, signalIndex } = projectionContext;

  if (input.json) {
    emitSpaceResultJsonOutput({
      identityDirectory,
      membersSnapshot,
      result,
      signalIndex,
    });
    return;
  }
  emitSpaceDispatchResultHumanOutput({
    presenter,
    result,
    membersSnapshot,
    signalIndex,
  });
}

function decorateSpaceResultReadError(input: {
  error: unknown;
  humanView: boolean;
}): unknown {
  const failure = toStructuredGatewayFailure(input.error);
  if (
    !(
      input.humanView &&
      isMissingDispatchResultFailure({
        code: failure.code,
        message: failure.message,
      })
    )
  ) {
    return input.error;
  }

  const error = new Error(
    "No archived dispatch result was found. `space result` reads archived dispatch results only. Use `openmeld service trace` to inspect Wake execution and the final visible Space outcome."
  ) as SpaceResultReadError;
  error.code = failure.code ?? undefined;
  error.requestId = failure.requestId;
  error.status = failure.status;
  return error;
}

function isMissingDispatchResultFailure(input: {
  code: string | null;
  message: string;
}): boolean {
  if (input.code === "space.dispatch_result.not_found") {
    return true;
  }

  return (
    input.code === "upstream_error" &&
    input.message.trim().toLowerCase() === "dispatch result not found"
  );
}
