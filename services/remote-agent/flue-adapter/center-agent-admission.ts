import { CLOUDFLARE_AGENT_INTERNAL_DISPATCH_PATH } from "@flue/runtime/internal";
import type { CenterAgentModelRoute } from "@openmeld/schemas/types";
import {
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
  redeliverDueRemoteAgentCallbacks,
} from "../agent-core/callback-context";
import { appendRemoteAgentImageUnderstanding } from "../agent-core/image-understanding";
import {
  buildRemoteAgentName,
  type RemoteAgentAdmissionHost,
  type RemoteAgentAdmissionImage,
  type RemoteAgentAdmissionStageReporter,
} from "../agent-core/submission";
import {
  type RemoteAgentConversationFootprint,
  resolveRemoteAgentConversationFootprintAdmission,
} from "./conversation-footprint";

type FlueCenterAgentAdmissionReceipt<Result> =
  | { claimedAtMs: number; status: "claimed" }
  | { result: Result; status: "finalized" };

export async function prepareFlueCenterAgentAdmission<Result>(input: {
  automaticRolloverSupported?: boolean;
  assertConversationFootprintSchema(): void;
  cleanupFinalizedSubmissionReplay(): Promise<void>;
  ensureInitialized(): Promise<void>;
  readConversationFootprint(): RemoteAgentConversationFootprint;
  readExistingSubmission(): Promise<FlueCenterAgentAdmissionReceipt<Result> | null>;
  reportConversationFootprintBeforeReplay(
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
      }
    );
    if (rejection) {
      return { footprint, outcome: "rejected", rejection };
    }
    input.reportConversationFootprintBeforeReplay(footprint);
  }
  await input.ensureInitialized();
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
  payload: undefined,
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
    admitConversationTurn: async ({
      images,
      message,
      metadata,
      request,
      submissionId,
    }) => {
      let routedImages = images;
      let routedMessage = message;
      if (
        request.v !== 1 &&
        images.length > 0 &&
        !request.modelRoute.inputModalities.includes("image")
      ) {
        if (!input.understandImages) {
          throw new Error(
            `Center Agent model ${request.modelRoute.modelId} requires auxiliary image understanding, but that capability is unavailable.`
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
      await input.registerProvider({
        ...(request.v !== 1 ? { modelRoute: request.modelRoute } : {}),
        organizationId: request.organizationId,
      });
      input.reportStage?.("provider_registered");
      input.reportStage?.("flue_request_started");
      const response = await input.routeRequest(
        new Request(
          `https://flue.internal${CLOUDFLARE_AGENT_INTERNAL_DISPATCH_PATH}`,
          {
            body: JSON.stringify({
              acceptedAt: metadata.submittedAt,
              agent: "center-agent",
              dispatchId: submissionId,
              id: buildRemoteAgentName(request),
              input: {
                message: routedMessage,
                ...(routedImages.length > 0 ? { images: routedImages } : {}),
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
        dispatchId?: unknown;
        error?: unknown;
      };
      const acceptedAtMs =
        typeof body.acceptedAt === "string"
          ? Date.parse(body.acceptedAt)
          : Number.NaN;
      if (
        !(
          response.ok &&
          body.dispatchId === submissionId &&
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
    `https://flue.internal/agents/center-agent/${encodeURIComponent(input.conversationId)}/abort`
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
  await input.schedule(delaySeconds, "retryRemoteAgentCallbacks", undefined, {
    idempotent: true,
  });
}

export async function redeliverRemoteAgentCallbacksAndScheduleNextRetry(input: {
  coreWorker?: RemoteAgentCoreWorkerBinding;
  nowMs?: () => number;
  schedule: RemoteAgentCallbackRetryScheduler;
  storage: RemoteAgentStorage;
}): Promise<{ processed: number; nextDueAtMs: number | null }> {
  const callbackRetry = await redeliverDueRemoteAgentCallbacks({
    coreWorker: input.coreWorker,
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
