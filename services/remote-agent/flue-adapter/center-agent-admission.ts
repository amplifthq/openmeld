import { CLOUDFLARE_AGENT_INTERNAL_DISPATCH_PATH } from "@flue/runtime/internal";
import type {
  CenterAgentModelRoute,
  RemoteAgentWorkerAdmissionRejectedResponse,
} from "@openmeld/schemas/types";
import {
  listDueRetryableCallbackContexts,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  redeliverDueRemoteAgentCallbacks,
} from "../agent-core/callback-context";
import type { RemoteAgentDiagnosticsEnv } from "../agent-core/diagnostics-content-policy";
import { appendRemoteAgentImageUnderstanding } from "../agent-core/image-understanding";
import {
  buildRemoteAgentName,
  type RemoteAgentAdmissionHost,
  type RemoteAgentAdmissionImage,
  RemoteAgentAdmissionRejectedError,
  type RemoteAgentAdmissionStageReporter,
} from "../agent-core/submission";
import {
  type RemoteAgentConversationFootprint,
  resolveRemoteAgentConversationFootprintAdmission,
} from "./conversation-footprint";
import { retryComputerCleanupHandoffs } from "./execution-cleanup";
import {
  type FlueSubmissionLifecycle,
  reconcileSettledRemoteAgentExecutions,
} from "./execution-reconciliation";
import type { RemoteAgentProviderContextCapacity } from "./provider-context-capacity";

type FlueCenterAgentAdmissionReceipt<Result> =
  | {
      rejection: RemoteAgentWorkerAdmissionRejectedResponse;
      status: "rejected";
    }
  | { claimedAtMs: number; status: "claimed" }
  | { result: Result; status: "finalized" };

export async function prepareFlueCenterAgentAdmission<Result>(input: {
  automaticRolloverSupported?: boolean;
  providerContextCapacity?: RemoteAgentProviderContextCapacity;
  assertConversationFootprintSchema(): void;
  cleanupFinalizedSubmissionReplay(): Promise<void>;
  readConversationFootprint(): RemoteAgentConversationFootprint;
  readExistingSubmission(): Promise<FlueCenterAgentAdmissionReceipt<Result> | null>;
  reportConversationFootprint(
    footprint: RemoteAgentConversationFootprint
  ): void;
}): Promise<
  | {
      footprint: RemoteAgentConversationFootprint;
      outcome: "rejected";
      rejection: NonNullable<
        ReturnType<typeof resolveRemoteAgentConversationFootprintAdmission>
      >;
    }
  | {
      outcome: "finalized";
      submission: { result: Result; status: "finalized" };
    }
  | {
      admission: "claimed" | "new";
      footprint: RemoteAgentConversationFootprint | null;
      outcome: "ready";
    }
> {
  const existingSubmission = await input.readExistingSubmission();
  if (existingSubmission?.status === "rejected") {
    throw new RemoteAgentAdmissionRejectedError(existingSubmission.rejection);
  }
  if (existingSubmission?.status === "finalized") {
    await input.cleanupFinalizedSubmissionReplay();
    return { outcome: "finalized", submission: existingSubmission };
  }

  let footprint: RemoteAgentConversationFootprint | null = null;
  if (existingSubmission?.status === "claimed") {
    input.assertConversationFootprintSchema();
  } else {
    footprint = input.readConversationFootprint();
    const rejection = resolveRemoteAgentConversationFootprintAdmission(
      footprint,
      {
        automaticRolloverSupported: input.automaticRolloverSupported,
        providerContextCapacity: input.providerContextCapacity,
      }
    );
    if (rejection) {
      return { footprint, outcome: "rejected", rejection };
    }
    input.reportConversationFootprint(footprint);
  }
  return {
    admission: existingSubmission ? "claimed" : "new",
    footprint,
    outcome: "ready",
  };
}

export type RemoteAgentProviderRegistrar = (input: {
  modelRoute?: CenterAgentModelRoute;
  organizationId: string;
}) => Promise<void>;

export type RemoteAgentCallbackRetryScheduler = (
  delaySeconds: number,
  callbackName: "retryRemoteAgentCallbacks",
  payload: { retryAt: number },
  options: { idempotent: true }
) => Promise<unknown>;

export function createFlueCenterAgentAdmissionHost(input: {
  registerProvider: RemoteAgentProviderRegistrar;
  reportStage?: RemoteAgentAdmissionStageReporter;
  routeRequest(request: Request): Promise<Response>;
  understandImages?: (input: {
    images: readonly RemoteAgentAdmissionImage[];
    model: CenterAgentModelRoute["imageUnderstandingModel"];
    organizationId: string;
  }) => Promise<string>;
}): RemoteAgentAdmissionHost {
  return {
    prepareConversationTurn: async ({ images, message, request }) => {
      let routedImages = images;
      let routedMessage = message;
      if (request.v !== 1 && images.length > 0) {
        if (!input.understandImages) {
          throw new Error(
            "Center Agent image understanding is required before persistent conversation admission, but that capability is unavailable."
          );
        }
        const description = await input.understandImages({
          images,
          model: request.modelRoute.imageUnderstandingModel,
          organizationId: request.organizationId,
        });
        routedMessage = appendRemoteAgentImageUnderstanding({
          description,
          message,
          modelDisplayName:
            request.modelRoute.imageUnderstandingModel.displayName,
        });
        routedImages = [];
      }
      return { images: routedImages, message: routedMessage };
    },
    admitConversationTurn: async ({
      images,
      message,
      metadata,
      request,
      submissionId,
    }) => {
      await input.registerProvider({
        ...(request.v !== 1 ? { modelRoute: request.modelRoute } : {}),
        organizationId: request.organizationId,
      });
      input.reportStage?.("provider_registered");
      input.reportStage?.("flue_request_started");
      const serializedImages = images.map((image) => {
        if (!("data" in image)) {
          throw new Error(
            "Legacy Flue image admission requires an inline image payload."
          );
        }
        return image;
      });
      const response = await input.routeRequest(
        new Request(
          `https://flue.internal${CLOUDFLARE_AGENT_INTERNAL_DISPATCH_PATH}`,
          {
            body: JSON.stringify({
              acceptedAt: metadata.submittedAt,
              agent: "center-agent-v2",
              submissionId,
              id: buildRemoteAgentName(request),
              message: {
                kind: "user",
                body: message,
                ...(serializedImages.length > 0
                  ? { attachments: serializedImages }
                  : {}),
              },
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          }
        )
      );
      input.reportStage?.("flue_request_completed");
      const body = (await response.json().catch(() => ({}))) as {
        acceptedAt?: unknown;
        submissionId?: unknown;
        error?: unknown;
      };
      const acceptedAtMs =
        typeof body.acceptedAt === "string"
          ? Date.parse(body.acceptedAt)
          : Number.NaN;
      if (
        !(
          response.ok &&
          body.submissionId === submissionId &&
          Number.isFinite(acceptedAtMs)
        )
      ) {
        throw new Error(
          `Flue deterministic Durable Object admission failed with status ${response.status}: ${JSON.stringify(body.error ?? body)}`
        );
      }
      return {
        accepted: true,
        createdAt: acceptedAtMs,
        idempotencyKey: request.idempotencyKey,
        requestId: submissionId,
        status: "pending",
        submissionId,
      };
    },
  };
}

export async function abortFlueCenterAgentSubmission(input: {
  conversationId: string;
  routeRequest(request: Request): Promise<Response>;
  submissionId: string;
}): Promise<{ aborted: boolean }> {
  const url = new URL(
    `https://flue.internal/agents/center-agent-v2/${encodeURIComponent(input.conversationId)}/abort`
  );
  url.searchParams.set("submissionId", input.submissionId);
  const response = await input.routeRequest(
    new Request(url, { method: "POST" })
  );
  const payload = (await response.json().catch(() => null)) as {
    aborted?: unknown;
  } | null;
  if (!(response.ok && typeof payload?.aborted === "boolean")) {
    throw new Error(
      `Flue submission cancellation failed with status ${response.status}.`
    );
  }
  return { aborted: payload.aborted };
}

export async function scheduleRemoteAgentCallbackRetry(input: {
  dueAtIso?: string;
  nowMs?: () => number;
  schedule: RemoteAgentCallbackRetryScheduler;
}): Promise<void> {
  const nowMs = input.nowMs?.() ?? Date.now();
  const dueAtMs = input.dueAtIso ? Date.parse(input.dueAtIso) : nowMs + 5000;
  const delaySeconds = Math.max(1, Math.ceil((dueAtMs - nowMs) / 1000));
  // Agents deduplicates one-shot schedules by callback and payload, including
  // the row currently executing. That row is deleted when its callback ends.
  // Name the upcoming second so rearming cannot reuse the firing row, while
  // concurrent requests for the same retry still converge on one schedule.
  await input.schedule(
    delaySeconds,
    "retryRemoteAgentCallbacks",
    { retryAt: Math.floor(nowMs / 1000) + delaySeconds },
    { idempotent: true }
  );
}

export async function redeliverRemoteAgentCallbacksAndScheduleNextRetry(input: {
  env?: RemoteAgentDiagnosticsEnv;
  coreWorker?: RemoteAgentCoreWorkerBinding;
  excludeSubmissionIds?: ReadonlySet<string>;
  nowMs?: () => number;
  schedule: RemoteAgentCallbackRetryScheduler;
  storage: RemoteAgentStorage;
}): Promise<{ processed: number; nextDueAtMs: number | null }> {
  const callbackRetry = await redeliverDueRemoteAgentCallbacks({
    env: input.env,
    coreWorker: input.coreWorker,
    excludeSubmissionIds: input.excludeSubmissionIds,
    nowMs: input.nowMs,
    storage: input.storage,
  });
  if (callbackRetry.nextDueAtMs !== null) {
    await scheduleRemoteAgentCallbackRetry({
      dueAtIso: new Date(callbackRetry.nextDueAtMs).toISOString(),
      nowMs: input.nowMs,
      schedule: input.schedule,
    });
  }
  return callbackRetry;
}

export async function reconcileAndRedeliverRemoteAgentCallbacks(input: {
  env?: RemoteAgentDiagnosticsEnv & { AGENT_COMPUTER?: unknown };
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  readSubmission: (
    submissionId: string
  ) => Promise<FlueSubmissionLifecycle | null>;
  schedule: RemoteAgentCallbackRetryScheduler;
  storage: RemoteAgentStorage;
}): Promise<{
  nextDueAtMs: number | null;
  processed: number;
  reconciled: number;
}> {
  const nowMs = input.nowMs?.() ?? Date.now();
  // Fence the exact retryable set through the execution owner before this
  // alarm can redeliver any callback projection captured before a restart.
  try {
    const retryableContexts = (
      await listDueRetryableCallbackContexts(input.storage, nowMs)
    ).filter((context) => context.callbackStatus === "retryable");
    const reconciliation = await reconcileSettledRemoteAgentExecutions({
      env: input.env,
      coreWorker: input.coreWorker,
      nowMs: () => nowMs,
      readSubmission: input.readSubmission,
      retryableContexts,
      storage: input.storage,
    });
    const redelivery = await redeliverRemoteAgentCallbacksAndScheduleNextRetry({
      env: input.env,
      coreWorker: input.coreWorker,
      excludeSubmissionIds: new Set(
        retryableContexts.map((context) => context.submissionId)
      ),
      nowMs: () => nowMs,
      schedule: input.schedule,
      storage: input.storage,
    });
    return { ...redelivery, reconciled: reconciliation.reconciled };
  } finally {
    // Stop delivery remains owned even when callback recovery or scheduling
    // fails. Both duties use the existing alarm, but neither gates the other.
    const cleanupDueAtMs = await retryComputerCleanupHandoffs(input);
    if (cleanupDueAtMs !== null) {
      await scheduleRemoteAgentCallbackRetry({
        dueAtIso: new Date(cleanupDueAtMs).toISOString(),
        nowMs: input.nowMs,
        schedule: input.schedule,
      });
    }
  }
}
