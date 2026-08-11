import type {
  CenterAgentInteractionSource,
  CenterAgentTaskReference,
  DispatchResult,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import { resolveOpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { assertDispatchOwnedRuntimePublicWriteAllowed } from "../runtime/dispatch-owned-runtime";
import type { Presenter } from "../runtime/presenter/types";
import type { RuntimeContext } from "../runtime/types";
import { createCliSpaceApi } from "../space/cli-space-api";
import { resolveSpaceSendText } from "../space/send-input";
import { resolveGatewayWebOrigin } from "../space/web-url";
import { renderInfoCard } from "../ui/info-card";
import {
  DEFAULT_CENTER_AGENT_ASK_POLL_INTERVAL_MS,
  waitForCenterAgentAsk,
  waitForCenterAgentVisibleReply,
} from "./ask-polling";
import {
  type CenterAgentOrganizationScope,
  createCenterAgentApiClient,
  resolveTargetedCenterAgentCommandContext,
} from "./command-context";
import { emitCenterAgentApiError, emitCenterAgentCommandError } from "./errors";
import { resolveCenterAgentLocalSource } from "./interaction-source";
import { formatOrganizationLabel } from "./presentation";

type CenterAgentTaskLink = {
  taskId: string;
  url: string;
};

const DEFAULT_CENTER_AGENT_ASK_TIMEOUT_SECONDS = 600;
const MAX_CENTER_AGENT_ASK_TIMEOUT_SECONDS = 3600;

export async function runCenterAgentAsk(input: {
  file?: string;
  organization?: string;
  pollIntervalMs?: number;
  sessionId?: string;
  stdin?: boolean;
  text?: string;
  timeoutSeconds?: number;
  via?: string;
  view?: string;
  wait?: boolean;
}): Promise<void> {
  assertDispatchOwnedRuntimePublicWriteAllowed({
    commandLabel: "openmeld center-agent ask",
  });

  const context = await resolveTargetedCenterAgentCommandContext(input);
  if (!context) {
    return;
  }

  const text = await resolveSpaceSendText({
    file: input.file,
    stdin: input.stdin,
    text: input.text,
  });
  const source = resolveCenterAgentLocalSource(input);
  if (!source) {
    emitCenterAgentCommandError({
      activeOrganization: context.organizationScope.target,
      code: "center_agent.ask_source_invalid",
      message:
        "The Local Agent source must include a client name up to 80 characters and an optional session ID up to 512 characters.",
      nextStep:
        "Retry with `--via codex`, `--via claude-code`, or another short client name.",
      presenter: context.presenter,
      title: "Local Agent Source Invalid",
    });
    return;
  }
  const timeoutSeconds = resolveCenterAgentAskTimeoutSeconds(
    input.timeoutSeconds
  );
  if (timeoutSeconds === null) {
    emitCenterAgentCommandError({
      activeOrganization: context.organizationScope.target,
      code: "center_agent.ask_timeout_invalid",
      message: `Wait timeout must be a whole number from 1 to ${MAX_CENTER_AGENT_ASK_TIMEOUT_SECONDS} seconds.`,
      nextStep: "Retry with `--timeout 600`.",
      presenter: context.presenter,
      title: "Wait Timeout Invalid",
    });
    return;
  }

  try {
    const baseUrl = await resolveBaseUrl();
    const centerAgentApi = await createCenterAgentApiClient({
      baseUrl,
      organizationId: context.organizationScope.target.id,
    });
    const directMessage = await centerAgentApi.openDirectMessageSpace();
    const memberProfile = await resolveOpenMeldProfile({
      profileKind: "human",
      openMeldProfileId: directMessage.memberProfileId,
    });
    const requestContext = buildOpenMeldRequestContextFromProfile({
      openMeldProfile: memberProfile,
    });
    const spaceApi = createCliSpaceApi(baseUrl, {
      organizationId: context.organizationScope.target.id,
    });
    const clientMessageId = crypto.randomUUID();
    const signal = await spaceApi.postNormalMessage({
      messageEnvelope: {
        activationTargets: [directMessage.centerAgentProfileId],
        referenceTargets: [],
        text,
      },
      meta: {
        centerAgentInteractionSource: source,
        clientMessageId,
      },
      requestContext,
      spaceId: directMessage.spaceId,
      text,
    });
    const interaction = {
      centerAgentProfileId: directMessage.centerAgentProfileId,
      clientMessageId,
      createdConversation: directMessage.created,
      signalId: signal.id,
      source,
      spaceId: directMessage.spaceId,
    };

    if (input.wait === false) {
      emitCenterAgentAskSuccess({
        organizationScope: context.organizationScope,
        answer: null,
        interaction,
        presenter: context.presenter,
        result: null,
        runtime: context.runtime,
        status: "submitted",
      });
      return;
    }

    const deadlineAtMs = Date.now() + timeoutSeconds * 1000;
    const waitOutcome = await waitForCenterAgentAsk({
      clientMessageId,
      deadlineAtMs,
      pollIntervalMs:
        input.pollIntervalMs ?? DEFAULT_CENTER_AGENT_ASK_POLL_INTERVAL_MS,
      requestContext,
      spaceApi,
      spaceId: directMessage.spaceId,
      targetProfileId: directMessage.centerAgentProfileId,
    });
    if (waitOutcome.kind === "needs_input") {
      emitCenterAgentAskSuccess({
        organizationScope: context.organizationScope,
        answer: null,
        interaction: {
          ...interaction,
          dispatchId: waitOutcome.progress.dispatchId,
          pendingInteraction: waitOutcome.progress.pendingInteraction,
          phase: waitOutcome.progress.phase,
        },
        presenter: context.presenter,
        result: null,
        runtime: context.runtime,
        status: "needs_input",
      });
      return;
    }
    if (waitOutcome.kind === "pending") {
      emitCenterAgentAskSuccess({
        organizationScope: context.organizationScope,
        answer: null,
        interaction: {
          ...interaction,
          dispatchId: waitOutcome.progress?.dispatchId ?? null,
          phase: waitOutcome.progress?.phase ?? "request_sent",
        },
        presenter: context.presenter,
        result: null,
        runtime: context.runtime,
        status: "pending",
      });
      return;
    }
    if (
      waitOutcome.progress.phase !== "replied" ||
      !waitOutcome.progress.dispatchId
    ) {
      emitCenterAgentCommandError({
        activeOrganization: context.organizationScope.target,
        code:
          waitOutcome.progress.failureReasonCode ?? "center_agent.ask_failed",
        message: waitOutcome.progress.message,
        nextStep:
          "Open Center Agent Chat in OpenMeld to inspect the visible request and its diagnostics.",
        payload: {
          interaction: {
            ...interaction,
            dispatchId: waitOutcome.progress.dispatchId,
            phase: waitOutcome.progress.phase,
          },
        },
        presenter: context.presenter,
        title: "Center Agent Request Did Not Complete",
      });
      return;
    }

    const visibleReply = await waitForCenterAgentVisibleReply({
      deadlineAtMs,
      pollIntervalMs:
        input.pollIntervalMs ?? DEFAULT_CENTER_AGENT_ASK_POLL_INTERVAL_MS,
      requestContext,
      sourceSignalId: signal.id,
      spaceApi,
      spaceId: directMessage.spaceId,
      targetProfileId: directMessage.centerAgentProfileId,
    });
    if (!visibleReply) {
      emitCenterAgentAskSuccess({
        organizationScope: context.organizationScope,
        answer: null,
        interaction: {
          ...interaction,
          dispatchId: waitOutcome.progress.dispatchId,
          phase: waitOutcome.progress.phase,
        },
        presenter: context.presenter,
        result: null,
        runtime: context.runtime,
        status: "pending",
      });
      return;
    }
    emitCenterAgentAskSuccess({
      organizationScope: context.organizationScope,
      answer: visibleReply.answer,
      interaction: {
        ...interaction,
        dispatchId: waitOutcome.progress.dispatchId,
        phase: waitOutcome.progress.phase,
        publishedSignalId: visibleReply.publishedSignalId,
      },
      presenter: context.presenter,
      result: null,
      runtime: context.runtime,
      status: "completed",
      taskReferences: buildCenterAgentTaskLinks({
        baseUrl,
        organizationSlug: context.organizationScope.target.slug,
        references: visibleReply.taskReferences,
      }),
    });
  } catch (error) {
    emitCenterAgentApiError({
      activeOrganization: context.organizationScope.target,
      error,
      operation: "ask",
      presenter: context.presenter,
    });
  }
}

function emitCenterAgentAskSuccess(input: {
  answer: string | null;
  interaction: Record<string, unknown> & {
    source: CenterAgentInteractionSource;
  };
  presenter: Presenter;
  organizationScope: CenterAgentOrganizationScope;
  result: DispatchResult | null;
  runtime: RuntimeContext;
  status: "completed" | "needs_input" | "pending" | "submitted";
  taskReferences?: readonly CenterAgentTaskLink[];
}): void {
  const taskReferences = input.taskReferences ?? [];
  const payload = {
    answer: input.answer,
    interaction: input.interaction,
    organization: input.organizationScope,
    result: input.result,
    status: input.status,
    taskReferences,
  };
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: "center_agent.ask",
      payload,
    });
    return;
  }

  renderInfoCard({
    codePrefix: "center-agent.ask.card",
    minContentWidth: 72,
    presenter: input.presenter,
    rows: [
      {
        label: "Organization",
        value: formatOrganizationLabel(input.organizationScope.target),
      },
      { label: "Via", value: input.interaction.source.client },
      {
        label: "Status",
        value: formatCenterAgentAskStatus(input.status),
      },
      ...(input.answer ? [{ label: "Answer", value: input.answer }] : []),
      ...taskReferences.map((reference) => ({
        label: "Task",
        value: reference.url,
      })),
      ...(input.status === "needs_input"
        ? [
            {
              label: "Next Step",
              value:
                "Open Center Agent Chat in OpenMeld to answer the pending question or permission request.",
            },
          ]
        : []),
      ...(input.status === "pending"
        ? [
            {
              label: "Result",
              value:
                "The request is still running in Center Agent Chat. Leaving this CLI wait did not cancel it.",
            },
          ]
        : []),
      ...(input.status === "submitted"
        ? [
            {
              label: "Result",
              value:
                "The request was added to the existing Center Agent Chat without waiting for its reply.",
            },
          ]
        : []),
    ],
    sanitize: true,
    title: "Center Agent",
  });
}

function buildCenterAgentTaskLinks(input: {
  baseUrl: string;
  organizationSlug: string;
  references: readonly CenterAgentTaskReference[];
}): CenterAgentTaskLink[] {
  const webOrigin = resolveGatewayWebOrigin(input.baseUrl);
  const seenTaskIds = new Set<string>();
  return input.references.flatMap((reference) => {
    const taskId = reference.taskId.trim();
    if (!taskId || seenTaskIds.has(taskId)) {
      return [];
    }
    seenTaskIds.add(taskId);
    const url = new URL(webOrigin);
    url.pathname = `/o/${encodeURIComponent(input.organizationSlug)}/center-agent/tasks/${encodeURIComponent(taskId)}`;
    return [{ taskId, url: url.toString() }];
  });
}

function resolveCenterAgentAskTimeoutSeconds(
  value: number | undefined
): number | null {
  const timeoutSeconds = value ?? DEFAULT_CENTER_AGENT_ASK_TIMEOUT_SECONDS;
  return Number.isInteger(timeoutSeconds) &&
    timeoutSeconds >= 1 &&
    timeoutSeconds <= MAX_CENTER_AGENT_ASK_TIMEOUT_SECONDS
    ? timeoutSeconds
    : null;
}

function formatCenterAgentAskStatus(
  status: "completed" | "needs_input" | "pending" | "submitted"
): string {
  if (status === "needs_input") {
    return "Needs your input";
  }
  if (status === "pending") {
    return "Still running";
  }
  if (status === "submitted") {
    return "Submitted";
  }
  return "Completed";
}
