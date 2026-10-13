import type {
  SpaceIdentityDirectory,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceSignalIndex } from "@openmeld/space";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { resolveUserFacingCliEntryCommand } from "../runtime/cli-entry-command";
import { outJsonLine } from "../ui/io";
import { formatTextEvent } from "../ui/output";
import { createCliSpaceApi, type SpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import { toStructuredGatewayFailure } from "./gateway-response";
import { runSpaceReadWithPasswordRetry } from "./password-flow";
import {
  buildFormalDispatchResultReadPayload,
  buildFormalSignalReadPayload,
} from "./read-projection/formal-message-read-output";
import {
  buildIdentityOnlyMembersSnapshotForReadProjection,
  loadSpaceIdentityDirectoryOrNull,
  loadSpaceSignalIndexOrNull,
} from "./read-projection/space-read-projection-context";
import type { fetchSpaceDispatchResult } from "./result-api";
import { emitSpaceDispatchResultHumanOutput } from "./result-output";
import { readSpaceResult } from "./result-read";

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
            Awaited<ReturnType<typeof readSpaceResult>>
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
        await readSpaceResult({
          spaceApi,
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
      baseUrl,
    });
  }
  if (resultRead.status === "cancelled") {
    return;
  }
  const read = resultRead.result;
  const resolvedPassword = resultRead.password;
  const projectionContext = await loadSpaceResultProjectionContext({
    requestContext,
    resolvedPassword,
    spaceApi,
    spaceId: input.space,
  });
  const { identityDirectory, membersSnapshot, signalIndex } = projectionContext;

  if (read.source === "published_message") {
    const message = buildFormalSignalReadPayload({
      signal: read.result.signal,
      identityDirectory,
      membersSnapshot,
      signalIndex,
    });
    const payload = {
      ...read.result,
      messageReadProjection: message.messageReadProjection,
    };
    if (input.json) {
      outJsonLine(payload);
    } else if (runtime.resolvedView === "agent") {
      presenter.data({ code: "space.result.published_message", payload });
    } else {
      presenter.line({
        code: "space.result.published_message",
        text:
          formatTextEvent(read.result.signal, {
            view: "human",
            spaceMembersSnapshot: membersSnapshot,
          }) ?? `${read.result.outcome.status}: ${read.result.signal.id}`,
      });
    }
    return;
  }
  const result = read.result;

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
  baseUrl: string;
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
  const command = `${resolveUserFacingCliEntryCommand()} service trace --space ${quoteCommandArgument(input.space)}${selector} --profile ${quoteCommandArgument(input.profile)} --gateway-url ${quoteCommandArgument(input.baseUrl)} --view agent`;
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
