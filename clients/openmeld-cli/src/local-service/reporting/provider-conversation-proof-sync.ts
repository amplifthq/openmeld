import type {
  OpenMeldDaemonProviderConversationProof,
  RuntimeAgentControllerLaunchContract,
} from "@openmeld/schemas/types";
import { resolveLocalProviderConversationProof } from "../control-plane/conversation-execution-status";
import type { RouteCatalog } from "../core/types";
import {
  notifyRuntimeReportingAttemptObserver,
  type RuntimeProviderConversationProofInput,
  type RuntimeProviderConversationProofSubmission,
  type RuntimeReportingAttemptObserver,
  submitRuntimeProviderConversationProofs,
} from "./runtime-agent-controller-reporting-submission";

const PROVIDER_CONVERSATION_PROOF_FALLBACK_TTL_MS = 10 * 60_000;

export type LocalServiceProviderConversationProofSyncResult =
  | {
      status: "skipped";
      reasonCodes: readonly string[];
      proofCount: 0;
      submittedCount: 0;
      failedCount: 0;
    }
  | {
      status: "submitted";
      reasonCodes: readonly string[];
      proofCount: number;
      submittedCount: number;
      failedCount: number;
    };

export async function syncLocalServiceProviderConversationProofs(input: {
  onAttempt?: RuntimeReportingAttemptObserver;
  routeCatalog: RouteCatalog;
}): Promise<LocalServiceProviderConversationProofSyncResult> {
  let proofInputs: RuntimeProviderConversationProofInput[];
  try {
    proofInputs = (
      await Promise.all(
        [...input.routeCatalog.routeByProfileId.values()].map(async (route) => {
          if (!isCodexAppServerRouteWithConversation(route)) {
            return null;
          }
          const workspace = route.workingFolderRuntime;
          if (workspace?.status !== "ready") {
            return null;
          }
          const proof = await resolveLocalProviderConversationProof({
            agentControllerConversationId: route.agentControllerConversationId,
            boundAgentControllerRef: route.agentControllerRef,
            launchContract: route.launchContract ?? null,
            profileAgentControllerRef: route.agentControllerRef,
            runtimeWorkingDirectory: workspace.effectiveRuntimeWorkingDirectory,
            transportMode: route.transportMode,
          });
          return toRuntimeProviderConversationProofInput({
            agentControllerConversationId: route.agentControllerConversationId,
            agentControllerRef: route.agentControllerRef,
            bindingId: route.bindingId,
            profileId: route.profileId,
            proof,
          });
        })
      )
    ).filter(
      (proof): proof is RuntimeProviderConversationProofInput => proof !== null
    );
  } catch (error) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "provider_conversation_proof",
      message: "Provider conversation proof collection failed.",
      reasonCode: "provider_conversation.runtime_reporting.collection_failed",
      status: "failed",
    });
    throw error;
  }

  if (proofInputs.length === 0) {
    await notifyRuntimeReportingAttemptObserver(input.onAttempt, {
      authenticationRejected: false,
      family: "provider_conversation_proof",
      message: null,
      reasonCode: "provider_conversation.proof.no_applicable_routes",
      status: "not_applicable",
    });
    return {
      status: "skipped",
      reasonCodes: ["provider_conversation.proof.no_applicable_routes"],
      proofCount: 0,
      submittedCount: 0,
      failedCount: 0,
    };
  }

  const submissions = await submitRuntimeProviderConversationProofs({
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    proofs: proofInputs,
  });
  return summarizeSubmissions(submissions);
}

function isCodexAppServerRouteWithConversation(route: {
  agentControllerConversationId?: string | null;
  agentControllerRef: string;
  bindingId?: string;
  launchContract?: RuntimeAgentControllerLaunchContract | null;
  transportMode: string;
}): route is typeof route & {
  agentControllerConversationId: string;
  bindingId: string;
  launchContract: RuntimeAgentControllerLaunchContract;
  transportMode: "codex-app-server";
} {
  return (
    route.agentControllerRef === "builtin:codex" &&
    route.transportMode === "codex-app-server" &&
    Boolean(route.agentControllerConversationId?.trim()) &&
    Boolean(route.bindingId?.trim()) &&
    Boolean(route.launchContract)
  );
}

function toRuntimeProviderConversationProofInput(input: {
  agentControllerConversationId: string;
  agentControllerRef: string;
  bindingId: string;
  profileId: string;
  proof: OpenMeldDaemonProviderConversationProof;
}): RuntimeProviderConversationProofInput | null {
  if (!(input.proof.status === "passed" || input.proof.status === "failed")) {
    return null;
  }
  if (
    !(
      input.proof.provider === "codex" &&
      input.proof.method === "codex_app_server_thread_read" &&
      input.proof.transportMode === "codex-app-server" &&
      input.proof.intrusive === false
    )
  ) {
    return null;
  }

  const observedAtMs = Date.parse(input.proof.checkedAt ?? "");
  if (!(Number.isFinite(observedAtMs) && observedAtMs > 0)) {
    return null;
  }
  const parsedExpiresAtMs = Date.parse(input.proof.expiresAt ?? "");
  const expiresAtMs =
    Number.isFinite(parsedExpiresAtMs) && parsedExpiresAtMs > observedAtMs
      ? parsedExpiresAtMs
      : observedAtMs + PROVIDER_CONVERSATION_PROOF_FALLBACK_TTL_MS;

  return {
    agentProfileId: input.profileId,
    bindingId: input.bindingId,
    agentControllerRef: input.agentControllerRef,
    agentControllerConversationId: input.agentControllerConversationId,
    transportMode: "codex-app-server",
    provider: "codex",
    method: "codex_app_server_thread_read",
    intrusive: false,
    observedAtMs,
    expiresAtMs,
    status: input.proof.status,
    ...(input.proof.errorCode ? { errorCode: input.proof.errorCode } : {}),
    ...(input.proof.errorMessage
      ? { errorMessage: input.proof.errorMessage }
      : {}),
    ...(input.proof.errorType ? { errorType: input.proof.errorType } : {}),
  };
}

function summarizeSubmissions(
  submissions: readonly RuntimeProviderConversationProofSubmission[]
): LocalServiceProviderConversationProofSyncResult {
  const submittedCount = submissions.filter(
    (submission) =>
      submission.status === "submitted" &&
      submission.providerConversationProofStatus === "accepted"
  ).length;
  const failedCount = submissions.length - submittedCount;
  return {
    status: "submitted",
    reasonCodes: [
      ...new Set(
        submissions
          .flatMap((submission) => submission.reasonCodes)
          .filter((reasonCode) => reasonCode.trim())
      ),
    ],
    proofCount: submissions.length,
    submittedCount,
    failedCount,
  };
}
