import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
  GetActiveSpaceWakeProgressResponse,
  GetSpaceWakeProgressResponse,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  WakeProgressItem,
} from "@openmeld/schemas/types";
import { buildCommandAuthenticationPromptMessage } from "../auth/command-auth";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { renderInfoCard } from "../ui/info-card";
import { createCliSpaceApi } from "./cli-space-api";
import {
  assertValidSpaceIdTarget,
  prepareAuthenticatedSpaceCommandContext,
  resolveOpenMeldProfileForSpaceCommand,
} from "./command-context";
import {
  runSpaceReadWithPasswordRetry,
  runSpaceWriteWithPasswordRetry,
} from "./password-flow";

type WakeProgressMode = "active" | "client_message";
type WakeProgressPollState = "active" | "idle" | "not_observed" | "terminal";

type WakeProgressPayload = {
  mode: WakeProgressMode;
  pollState: WakeProgressPollState;
  activeCount: number;
  terminalCount: number;
  query:
    | GetActiveSpaceWakeProgressResponse["query"]
    | GetSpaceWakeProgressResponse["query"];
  items: WakeProgressItem[];
};

export async function runSpaceWakeProgress(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  clientMessageId?: string;
  targetProfileId?: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage(
      "reading live Wake progress"
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
  const mode: WakeProgressMode = input.clientMessageId
    ? "client_message"
    : "active";
  const progressRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human",
    presenter,
    execute: async (password) => {
      const common = {
        includeWakeStopEligibility: true,
        requestContext,
        spaceId: input.space,
        ...(input.targetProfileId
          ? { targetProfileId: input.targetProfileId }
          : {}),
        ...(password === undefined ? {} : { spacePassword: password }),
      };
      return input.clientMessageId
        ? await spaceApi.getWakeProgress({
            ...common,
            clientMessageId: input.clientMessageId,
          })
        : await spaceApi.getActiveWakeProgress(common);
    },
  }).catch((error: unknown) => {
    emitWakeControlError({
      error,
      operation: "space.wake_progress",
      presenter,
    });
    return null;
  });
  if (!progressRead) {
    return;
  }
  if (progressRead.status === "cancelled") {
    return;
  }

  const payload = buildWakeProgressPayload({
    mode,
    response: progressRead.result,
  });
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "space.wake_progress",
      payload,
    });
    return;
  }

  renderWakeProgressHumanOutput({ presenter, payload });
}

export async function runSpaceWakeStop(input: {
  profile?: string;
  baseUrl?: string;
  space: string;
  clientMessageId?: string;
  sourceSignalId?: string;
  targetProfileId: string;
  reason?: string;
  password?: string;
  view?: string;
  entryChecksHandled?: boolean;
}): Promise<void> {
  const context = await prepareAuthenticatedSpaceCommandContext({
    profile: input.profile,
    baseUrl: input.baseUrl,
    view: input.view,
    promptMessage: buildCommandAuthenticationPromptMessage("stopping a Wake"),
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
  let target: PostSpaceWakeStopBody["target"];
  try {
    target = buildWakeStopTarget(input);
  } catch (error) {
    emitWakeControlError({
      error,
      operation: "space.wake_stop",
      presenter,
    });
    return;
  }
  const openMeldProfile = await resolveOpenMeldProfileForSpaceCommand({
    openMeldProfileId: input.profile,
    resolvedView: runtime.resolvedView,
    interactive,
  });
  const requestContext = buildOpenMeldRequestContextFromProfile({
    openMeldProfile,
  });
  const spaceApi = createCliSpaceApi(baseUrl);
  const progressRead = await runSpaceReadWithPasswordRetry({
    initialPassword: input.password,
    interactive: interactive && runtime.resolvedView === "human",
    presenter,
    execute: async (password) => {
      const common = {
        includeWakeStopEligibility: true,
        requestContext,
        spaceId: input.space,
        targetProfileId: target.targetProfileId,
        ...(password === undefined ? {} : { spacePassword: password }),
      };
      return target.by === "client_message"
        ? await spaceApi.getWakeProgress({
            ...common,
            clientMessageId: target.clientMessageId,
          })
        : await spaceApi.getActiveWakeProgress(common);
    },
  }).catch((error: unknown) => {
    emitWakeControlError({
      error,
      operation: "space.wake_stop",
      presenter,
    });
    return null;
  });
  if (!progressRead) {
    return;
  }
  if (progressRead.status === "cancelled") {
    return;
  }
  try {
    assertWakeStopEligible({
      items: progressRead.result.items,
      target,
    });
  } catch (error) {
    emitWakeControlError({
      error,
      operation: "space.wake_stop",
      presenter,
    });
    return;
  }

  const stopRead = await runSpaceWriteWithPasswordRetry({
    initialPassword: progressRead.password,
    interactive: interactive && runtime.resolvedView === "human",
    presenter,
    execute: async (password) =>
      await spaceApi.postWakeStop({
        body: {
          ...(input.reason ? { reason: input.reason } : {}),
          target,
        },
        requestContext,
        spaceId: input.space,
        ...(password === undefined ? {} : { spacePassword: password }),
      }),
  }).catch((error: unknown) => {
    emitWakeControlError({
      error,
      operation: "space.wake_stop",
      presenter,
    });
    return null;
  });
  if (!stopRead) {
    return;
  }
  if (stopRead.status === "cancelled") {
    return;
  }

  const payload = buildWakeStopPayload({
    response: stopRead.result,
    target,
  });
  applyWakeStopExitCode(stopRead.result);
  if (runtime.resolvedView === "agent") {
    presenter.data({
      code: "space.wake_stop",
      payload,
    });
    return;
  }
  renderWakeStopHumanOutput({
    presenter,
    payload,
  });
}

function buildWakeStopTarget(input: {
  clientMessageId?: string;
  sourceSignalId?: string;
  targetProfileId: string;
}): PostSpaceWakeStopBody["target"] {
  const clientMessageId = String(input.clientMessageId ?? "").trim();
  const sourceSignalId = String(input.sourceSignalId ?? "").trim();
  const targetProfileId = String(input.targetProfileId ?? "").trim();
  const selectorCount =
    Number(clientMessageId.length > 0) + Number(sourceSignalId.length > 0);
  if (selectorCount !== 1) {
    throw createWakeControlCommandError(
      "space.wake_stop.selector_invalid",
      "Exactly one of --client-message or --source-signal is required."
    );
  }
  if (!targetProfileId) {
    throw createWakeControlCommandError(
      "space.wake_stop.target_profile_required",
      "--target-profile is required."
    );
  }
  return clientMessageId
    ? {
        by: "client_message",
        clientMessageId,
        targetProfileId,
      }
    : {
        by: "source_signal",
        sourceSignalId,
        targetProfileId,
      };
}

function assertWakeStopEligible(input: {
  items: readonly WakeProgressItem[];
  target: PostSpaceWakeStopBody["target"];
}): void {
  const item = input.items.find((candidate) => {
    if (candidate.targetProfileId !== input.target.targetProfileId) {
      return false;
    }
    return input.target.by === "client_message"
      ? candidate.clientMessageId === input.target.clientMessageId
      : candidate.sourceSignalId === input.target.sourceSignalId;
  });
  if (!item) {
    throw createWakeControlCommandError(
      "space.wake_stop.not_observed",
      "The selected Wake is not active or its progress is not available. No Stop request was sent."
    );
  }
  if (item.terminal) {
    throw createWakeControlCommandError(
      "space.wake_stop.terminal",
      "The selected Wake is already terminal. No Stop request was sent."
    );
  }
  if (item.wakeStopEligibility?.status !== "eligible") {
    const reasonCode =
      item.wakeStopEligibility?.reasonCode ?? "wake_stop_eligibility_missing";
    throw createWakeControlCommandError(
      "space.wake_stop.not_eligible",
      `The selected Wake is not eligible for Stop (${reasonCode}). No Stop request was sent.`
    );
  }
}

function createWakeControlCommandError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function buildWakeStopPayload(input: {
  response: PostSpaceWakeStopResponse;
  target: PostSpaceWakeStopBody["target"];
}) {
  const confirmed =
    input.response.ok &&
    (input.response.status === "cancelled" ||
      input.response.status === "already_cancelled");
  return {
    confirmed,
    terminal: confirmed,
    target: input.target,
    response: input.response,
  };
}

function applyWakeStopExitCode(response: PostSpaceWakeStopResponse): void {
  if (!response.ok) {
    process.exitCode = 1;
    return;
  }
  if (response.status === "cancellation_requested") {
    process.exitCode = 2;
  }
}

function renderWakeStopHumanOutput(input: {
  presenter: Parameters<typeof renderInfoCard>[0]["presenter"];
  payload: ReturnType<typeof buildWakeStopPayload>;
}): void {
  let statusText: string;
  if (input.payload.confirmed) {
    statusText = "Wake Stop was confirmed by OpenMeld.";
  } else if (input.payload.response.ok) {
    statusText =
      "OpenMeld accepted the Stop request, but the Wake is not confirmed stopped yet.";
  } else {
    statusText = `Wake Stop was not completed (${input.payload.response.reasonCode}).`;
  }
  renderInfoCard({
    presenter: input.presenter,
    title: "Wake Stop",
    codePrefix: "space.wake_stop.card",
    rows: [
      { label: "Status", value: statusText },
      { label: "Target Profile", value: input.payload.target.targetProfileId },
      { label: "Server Status", value: input.payload.response.status },
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function emitWakeControlError(input: {
  error: unknown;
  operation: "space.wake_progress" | "space.wake_stop";
  presenter: Parameters<typeof renderInfoCard>[0]["presenter"];
}): void {
  const failure = toStructuredApiClientFailure(input.error);
  const code =
    failure.code ??
    readLocalWakeControlErrorCode(input.error) ??
    `${input.operation}_failed`;
  process.exitCode = 1;
  if (input.presenter.view === "agent") {
    input.presenter.data({
      code,
      payload: {
        status: "error",
        operation: input.operation,
        error: {
          code,
          message: failure.message,
          requestId: failure.requestId,
          status: failure.status,
          upstreamCode: failure.upstreamCode,
          ...(failure.schemaIssueMessage
            ? { schemaIssueMessage: failure.schemaIssueMessage }
            : {}),
          ...(failure.schemaIssuePath
            ? { schemaIssuePath: failure.schemaIssuePath }
            : {}),
        },
      },
    });
    return;
  }
  renderInfoCard({
    presenter: input.presenter,
    title:
      input.operation === "space.wake_stop"
        ? "Wake Stop Failed"
        : "Wake Progress Failed",
    codePrefix: `${input.operation}.error.card`,
    rows: [
      { label: "Reason", value: failure.message },
      ...(failure.requestId
        ? [{ label: "Request ID", value: failure.requestId }]
        : []),
      ...(failure.schemaIssuePath
        ? [{ label: "Schema Path", value: failure.schemaIssuePath }]
        : []),
      ...(failure.schemaIssueMessage
        ? [{ label: "Schema Issue", value: failure.schemaIssueMessage }]
        : []),
    ],
    sanitize: true,
    minContentWidth: 72,
  });
}

function readLocalWakeControlErrorCode(error: unknown): string | null {
  if (!(error && typeof error === "object" && "code" in error)) {
    return null;
  }
  const code = String((error as { code?: unknown }).code ?? "").trim();
  return code.startsWith("space.wake_") ? code : null;
}

function buildWakeProgressPayload(input: {
  mode: WakeProgressMode;
  response: GetActiveSpaceWakeProgressResponse | GetSpaceWakeProgressResponse;
}): WakeProgressPayload {
  const activeCount = input.response.items.filter(
    (item) => !item.terminal
  ).length;
  const terminalCount = input.response.items.length - activeCount;
  return {
    mode: input.mode,
    pollState: resolveWakeProgressPollState({
      mode: input.mode,
      activeCount,
      itemCount: input.response.items.length,
      terminalCount,
    }),
    activeCount,
    terminalCount,
    query: input.response.query,
    items: input.response.items,
  };
}

function resolveWakeProgressPollState(input: {
  mode: WakeProgressMode;
  activeCount: number;
  itemCount: number;
  terminalCount: number;
}): WakeProgressPollState {
  if (input.itemCount === 0) {
    return input.mode === "active" ? "idle" : "not_observed";
  }
  if (input.activeCount > 0) {
    return "active";
  }
  return input.terminalCount > 0 ? "terminal" : "not_observed";
}

function renderWakeProgressHumanOutput(input: {
  presenter: Parameters<typeof renderInfoCard>[0]["presenter"];
  payload: WakeProgressPayload;
}): void {
  const rows = input.payload.items.flatMap((item) => [
    {
      label: item.targetLabel,
      value: `${item.phase}: ${item.message}`,
    },
  ]);
  renderInfoCard({
    presenter: input.presenter,
    title:
      input.payload.mode === "active"
        ? "Active Wake Progress"
        : "Wake Progress",
    codePrefix: "space.wake_progress.card",
    rows:
      rows.length > 0
        ? rows
        : [
            {
              label: "Status",
              value:
                input.payload.mode === "active"
                  ? "No active Wakes were found."
                  : "Wake progress has not been observed yet.",
            },
          ],
    sanitize: true,
    minContentWidth: 72,
  });
  input.presenter.line({
    code: "space.wake_progress.boundary",
    text: "This is live progress. Use `space result` for archived results and `service trace` for execution diagnostics.",
  });
}
