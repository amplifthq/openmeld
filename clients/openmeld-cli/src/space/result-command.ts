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
      space: input.space,
      dispatchId,
      profile: openMeldProfile.openMeldProfileId,
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
  space: string;
  dispatchId: string;
  profile: string;
}): unknown {
  const failure = toStructuredGatewayFailure(input.error);
  if (
    !isMissingDispatchResultFailure({
      code: failure.code,
      message: failure.message,
    })
  ) {
    return input.error;
  }

  const selector = input.dispatchId
    ? ` --dispatch ${quoteCommandArgument(input.dispatchId)}`
    : " --dispatch <dispatch-id>";
  const command = `openmeld service trace --space ${quoteCommandArgument(input.space)}${selector} --profile ${quoteCommandArgument(input.profile)} --view agent`;
  const error = new Error(
    `No archived dispatch result was found. This does not mean the Wake failed. Hosted replies can exist without a workstation result archive. Run ${command} to read the execution and visible reply evidence. Use the returned Signal ID with space history --around-signal to read the reply.`
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

function quoteCommandArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
