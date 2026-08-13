import {
  listDueRemoteAgentLarkPlatformRegistrationAttempts,
  rejectRemoteAgentLarkPlatformRegistrationAttempt,
} from "../infrastructure/d1/lark-platform-registration-attempt-repo";
import {
  continueRemoteAgentLarkPlatformRegistration,
  type RegistrationEnvironment,
} from "./lark-platform-registration-service";

const DEFAULT_REGISTRATION_TICK_LIMIT = 4;

export type LarkPlatformRegistrationTickSummary = {
  errors: number;
  processed: number;
  scanned: number;
};

export async function runLarkPlatformRegistrationTick(input: {
  classifyOrganization: (input: {
    organizationId: string;
  }) => Promise<{ ok: true; personal: boolean } | { ok: false }>;
  clock?: () => number;
  createId?: () => string;
  createSecret?: () => string;
  db: D1Database;
  env: RegistrationEnvironment;
  fetchImpl?: typeof fetch;
  limit?: number;
  nowMs: number;
  providerRequestTimeoutMs?: number;
}): Promise<LarkPlatformRegistrationTickSummary> {
  const attempts = await listDueRemoteAgentLarkPlatformRegistrationAttempts({
    db: input.db,
    limit: input.limit ?? DEFAULT_REGISTRATION_TICK_LIMIT,
    nowMs: input.nowMs,
  });
  const summary: LarkPlatformRegistrationTickSummary = {
    errors: 0,
    processed: 0,
    scanned: attempts.length,
  };

  for (const attempt of attempts) {
    try {
      const continuationNowMs = input.clock?.() ?? input.nowMs;
      const classification = await input.classifyOrganization({
        organizationId: attempt.organizationId,
      });
      if (!classification.ok) {
        const failureReasonCode = "organization.context_unavailable";
        await rejectRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: attempt.attemptId,
          db: input.db,
          failureReasonCode,
          nowMs: continuationNowMs,
        });
        summary.processed += 1;
        console.warn(
          "[core.remote_agent.lark_registration.organization_classification_unavailable]",
          {
            attemptId: attempt.attemptId,
            organizationId: attempt.organizationId,
            provider: attempt.provider,
            reasonCode: failureReasonCode,
          }
        );
        continue;
      }
      if (classification.personal) {
        const failureReasonCode = `${attempt.provider}.organization_required`;
        await rejectRemoteAgentLarkPlatformRegistrationAttempt({
          attemptId: attempt.attemptId,
          db: input.db,
          failureReasonCode,
          nowMs: continuationNowMs,
        });
        summary.processed += 1;
        console.warn(
          "[core.remote_agent.lark_registration.personal_workspace_rejected]",
          {
            attemptId: attempt.attemptId,
            organizationId: attempt.organizationId,
            provider: attempt.provider,
            reasonCode: failureReasonCode,
          }
        );
        continue;
      }
      await continueRemoteAgentLarkPlatformRegistration({
        attemptId: attempt.attemptId,
        clock: input.clock,
        createId: input.createId,
        createSecret: input.createSecret,
        db: input.db,
        env: input.env,
        fetchImpl: input.fetchImpl,
        nowMs: continuationNowMs,
        providerRequestTimeoutMs: input.providerRequestTimeoutMs,
      });
      summary.processed += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(
        "[core.remote_agent.lark_registration.continuation_failed]",
        {
          attemptId: attempt.attemptId,
          error: error instanceof Error ? error.message : String(error),
          organizationId: attempt.organizationId,
          provider: attempt.provider,
        }
      );
    }
  }

  return summary;
}
