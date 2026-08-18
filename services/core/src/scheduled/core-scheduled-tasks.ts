import { runAgentActivityDigestTick } from "../agent-activity/activity-digest-service";
import {
  runAgentActivityDailyAggregation,
  runAgentActivityRetention,
} from "../agent-activity/activity-retention-service";
import { retryReadyAgentTaskContinuations } from "../agent-task-coordination/application/agent-task-terminal-outcome-service";
import { runAgentControllerTaskRetention } from "../agent-task-coordination/infrastructure/d1/agent-controller-task-retention";
import { retryPendingCenterAgentWakePublications } from "../center-agent/application/center-agent-wake-publication-service";
import { shouldWriteDestinationNeutralTaskContinuations } from "../center-agent/application/task-continuation-rollout";
import { runCenterAgentMemberResearchTick } from "../center-agent-member-research/member-research-service";
import { recoverCenterAgentTaskWork } from "../center-agent-tasks/application/center-agent-task-service";
import { createCenterAgentTaskNativeRuntimePort } from "../center-agent-tasks/infrastructure/remote-agent/center-agent-task-native-runtime";
import { retryPendingPreHeadFailurePublications } from "../dispatch/application/dispatch-queue-service";
import { runWakeEvidenceRetentionIfSplitActive } from "../dispatch/infrastructure/d1/wake-evidence-retention";
import {
  EVAL_WEEKLY_REPORT_CRON,
  runWeeklyEvalReport,
} from "../eval/weekly-eval-report-service";
import { retryInboxUrgentEmailDeliveries } from "../inbox/application/inbox-email-delivery-service";
import type { CoreBindings } from "../lib/bindings";
import {
  agentActivityDb,
  agentTaskCoordinationDb,
  dispatchRecoveryDb,
  inboxDb,
  localStateDb,
  organizationDocumentsDb,
  routineDb,
  wakeEvidenceDb,
} from "../lib/bindings";
import { reconcileOrganizationDocumentDraftInbox } from "../organization-documents/organization-document-inbox-reconciler";
import { readOrganizationPersonalClassification } from "../organizations/organization-context";
import { resolveOrganizationDirectoryMembers } from "../organizations/organization-directory";
import { runLarkPlatformRegistrationTick } from "../remote-agent/application/lark-platform-registration-scheduler";
import {
  reconcileLinkedSlackNativeDeliveryInbox,
  retryMissingRemoteAgentAcceptedDeliveryProbes,
  retryPendingCenterAgentTaskTerminalProjections,
  retryRemoteAgentRoutineFailurePublications,
  retryRemoteAgentRoutineSubmissions,
  submitRemoteAgentRoutineDelivery,
} from "../remote-agent/application/native-delivery-service";
import { runSlackChannelIntroductionTick } from "../remote-agent/application/slack-signal-service";
import { countStrandedRemoteAgentSlackEventIngress } from "../remote-agent/infrastructure/d1/slack-event-ingress-repo";
import {
  assertRoutineWorkflowConfiguration,
  resolveRoutineExecutionEngineSelection,
} from "../routines/routine-execution-engine";
import { runRoutineSchedulerTick } from "../routines/routine-scheduler";
import {
  ensureRoutineRunWorkflowStarted,
  retryPendingRoutineRunWorkflowStarts,
} from "../routines/routine-workflow-coordinator";
import {
  rpcPostCenterAgentWakePublicationSignal,
  rpcResolveCenterAgentWakePublicationSignal,
  runSlackInstallationWelcomePreparationTick,
} from "../rpc/methods";
import { emitCoreCloudflareRuntimeEvidence } from "../shared/observability/cloudflare-runtime-evidence";

export const ROUTINE_TICK_CRON = "* * * * *";
export const WAKE_EVIDENCE_RETENTION_CRON = "0 4 * * *";
export const AGENT_ACTIVITY_RETENTION_CRON = WAKE_EVIDENCE_RETENTION_CRON;
export { EVAL_WEEKLY_REPORT_CRON };

export async function runCoreScheduledTasks(input: {
  cron: string | null;
  env: CoreBindings;
  nowMs: number;
  runRoutineTick?: typeof runRoutineSchedulerTick;
  retryRoutineFailurePublications?: typeof retryRemoteAgentRoutineFailurePublications;
  retryRoutineWorkflowStarts?: typeof retryPendingRoutineRunWorkflowStarts;
  retryRoutineSubmissions?: typeof retryRemoteAgentRoutineSubmissions;
  runWakeEvidenceRetention?: typeof runWakeEvidenceRetentionIfSplitActive;
  runAgentActivityDigest?: typeof runAgentActivityDigestTick;
  runAgentActivityDailyAggregation?: typeof runAgentActivityDailyAggregation;
  runAgentActivityRetention?: typeof runAgentActivityRetention;
  runAgentControllerTaskRetention?: typeof runAgentControllerTaskRetention;
  runMemberResearchTick?: typeof runCenterAgentMemberResearchTick;
  runSlackWelcomePreparationTick?: typeof runSlackInstallationWelcomePreparationTick;
  runSlackChannelIntroductionTick?: typeof runSlackChannelIntroductionTick;
  runLarkPlatformRegistrationTick?: typeof runLarkPlatformRegistrationTick;
  retryAgentTaskContinuations?: typeof retryReadyAgentTaskContinuations;
  retryAcceptedDeliveryProbes?: typeof retryMissingRemoteAgentAcceptedDeliveryProbes;
  retryCenterAgentWakePublications?: typeof retryPendingCenterAgentWakePublications;
  retryPreHeadFailurePublications?: typeof retryPendingPreHeadFailurePublications;
  countStrandedSlackIngress?: typeof countStrandedRemoteAgentSlackEventIngress;
  runWeeklyEvalReport?: typeof runWeeklyEvalReport;
  reconcileOrganizationDocumentInbox?: typeof reconcileOrganizationDocumentDraftInbox;
  reconcileSlackNativeDeliveryInbox?: typeof reconcileLinkedSlackNativeDeliveryInbox;
  recoverCenterAgentTasks?: typeof recoverCenterAgentTaskWork;
  retryCenterAgentTaskTerminalProjections?: typeof retryPendingCenterAgentTaskTerminalProjections;
  retryInboxEmailDeliveries?: typeof retryInboxUrgentEmailDeliveries;
}): Promise<void> {
  if (input.cron === EVAL_WEEKLY_REPORT_CRON) {
    await (input.runWeeklyEvalReport ?? runWeeklyEvalReport)({
      env: input.env,
      nowMs: input.nowMs,
    });
    return;
  }

  if (input.cron === ROUTINE_TICK_CRON) {
    await runLarkPlatformRegistrationContinuation(input);
    await reportStrandedRemoteAgentSlackEventIngress(input);
    await runAgentTaskContinuationRedrive(input);
    await runCenterAgentWakePublicationRedrive(input);
    await runPreHeadFailurePublicationRedrive(input);
    await runAcceptedDeliveryProbeRecovery(input);
    await runOrganizationDocumentInboxReconciliation(input);
    await runSlackNativeDeliveryInboxReconciliation(input);
    await runInboxEmailDeliveryRedrive(input);
    await runCenterAgentTaskRecovery(input);
    await runCenterAgentTaskTerminalProjectionRecovery(input);
    assertRoutineWorkflowConfiguration(input.env);
    const db = routineDb(input.env);
    if (!db) {
      console.error("[core.routine.scheduler.db_unavailable]", {
        cron: input.cron,
        event: "core.routine.scheduler.db_unavailable",
      });
      throw new Error("Routine scheduler database is unavailable");
    }
    await runSlackWelcomePreparationContinuation(input, db);
    await runSlackChannelIntroductionContinuation(input, db);
    await (input.runMemberResearchTick ?? runCenterAgentMemberResearchTick)({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
    await runSlackWelcomePreparationContinuation(input, db);
    const retryRoutineFailurePublications =
      input.retryRoutineFailurePublications ??
      retryRemoteAgentRoutineFailurePublications;
    const retryRoutineSubmissions =
      input.retryRoutineSubmissions ?? retryRemoteAgentRoutineSubmissions;
    const retryRoutineWorkflowStarts =
      input.retryRoutineWorkflowStarts ?? retryPendingRoutineRunWorkflowStarts;
    await retryRoutineWorkflowStarts({ db, env: input.env });
    await retryRoutineSubmissions({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
    await retryRoutineFailurePublications({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
    const runRoutineTick = input.runRoutineTick ?? runRoutineSchedulerTick;
    await runRoutineTick({
      db,
      nowMs: input.nowMs,
      resolveExecutionEngine: (routine) => {
        const selection = resolveRoutineExecutionEngineSelection({
          env: input.env,
          organizationId: routine.organizationId,
        });
        console.log(
          JSON.stringify({
            engine: selection.engine,
            event: "core.routine.execution_engine.selected",
            organizationId: routine.organizationId,
            routineId: routine.id,
            source: selection.source,
          })
        );
        return selection.engine;
      },
      submitRoutineDelivery: async (deliveryInput) => {
        if (deliveryInput.executionEngine === "workflow") {
          await ensureRoutineRunWorkflowStarted({
            env: input.env,
            runId: deliveryInput.run.id,
          });
          return { status: "pending" };
        }
        return await submitRemoteAgentRoutineDelivery({
          ...deliveryInput,
          env: input.env,
        });
      },
    });
    if (input.env.OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED === "true") {
      const activityDb = agentActivityDb(input.env);
      const summarize =
        input.env.OPENMELD_REMOTE_AGENT_WORKER?.summarizeAgentActivityDigest;
      if (!(activityDb && summarize)) {
        throw new Error(
          "Agent Activity digest is enabled without its database and Remote Agent consumer."
        );
      }
      const digestResult = await (
        input.runAgentActivityDigest ?? runAgentActivityDigestTick
      )({
        db: activityDb,
        nowMs: input.nowMs,
        summarize: async (request) => await summarize(request),
      });
      console.log(
        JSON.stringify({
          event: "core.agent_activity.digest.tick",
          ...digestResult,
        })
      );
    }
    return;
  }

  const scheduledRetentionFailures = await runScheduledRetention(input);

  const runWakeEvidenceRetention =
    input.runWakeEvidenceRetention ?? runWakeEvidenceRetentionIfSplitActive;
  try {
    await runWakeEvidenceRetention({
      cron: input.cron,
      env: input.env,
      nowMs: input.nowMs,
    });
  } catch (error) {
    scheduledRetentionFailures.push(error);
  }
  throwScheduledRetentionFailures(scheduledRetentionFailures);
}

async function runSlackWelcomePreparationContinuation(
  input: Parameters<typeof runCoreScheduledTasks>[0],
  db: D1Database
): Promise<void> {
  try {
    await (
      input.runSlackWelcomePreparationTick ??
      runSlackInstallationWelcomePreparationTick
    )({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
  } catch (error) {
    console.error("[core.slack_installation_welcome.tick_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runSlackChannelIntroductionContinuation(
  input: Parameters<typeof runCoreScheduledTasks>[0],
  db: D1Database
): Promise<void> {
  try {
    await (
      input.runSlackChannelIntroductionTick ?? runSlackChannelIntroductionTick
    )({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
  } catch (error) {
    console.error("[core.slack_channel_introduction.tick_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runAcceptedDeliveryProbeRecovery(input: {
  env: CoreBindings;
  nowMs: number;
  retryAcceptedDeliveryProbes?: typeof retryMissingRemoteAgentAcceptedDeliveryProbes;
}): Promise<void> {
  const db = wakeEvidenceDb(input.env);
  if (!db) {
    console.error(
      "[core.remote_agent.native_delivery.accepted_probe_recovery_store_unavailable]"
    );
    return;
  }
  try {
    const result = await (
      input.retryAcceptedDeliveryProbes ??
      retryMissingRemoteAgentAcceptedDeliveryProbes
    )({ db, env: input.env, nowMs: input.nowMs });
    if (result.scanned > 0 || result.errors > 0) {
      console.log(
        JSON.stringify({
          event: "core.remote_agent.native_delivery.accepted_probe_recovery",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error(
      "[core.remote_agent.native_delivery.accepted_probe_recovery_failed]",
      { error: error instanceof Error ? error.message : String(error) }
    );
  }
}

async function runCenterAgentTaskTerminalProjectionRecovery(input: {
  env: CoreBindings;
  nowMs: number;
  retryCenterAgentTaskTerminalProjections?: typeof retryPendingCenterAgentTaskTerminalProjections;
}): Promise<void> {
  const taskDb = localStateDb(input.env);
  const deliveryDb = wakeEvidenceDb(input.env);
  const taskInboxDb = inboxDb(input.env);
  if (!(taskDb && deliveryDb && taskInboxDb)) {
    console.error(
      "[core.center_agent_task.terminal_projection_recovery_store_unavailable]",
      {
        deliveryDatabaseAvailable: Boolean(deliveryDb),
        inboxDatabaseAvailable: Boolean(taskInboxDb),
        taskDatabaseAvailable: Boolean(taskDb),
      }
    );
    return;
  }
  try {
    const result = await (
      input.retryCenterAgentTaskTerminalProjections ??
      retryPendingCenterAgentTaskTerminalProjections
    )({
      deliveryDb,
      env: input.env,
      nowMs: input.nowMs,
    });
    if (
      result.canonicalized +
        result.errors +
        result.ownerRejected +
        result.retained >
      0
    ) {
      console.log(
        JSON.stringify({
          event: "core.center_agent_task.terminal_projection_recovery",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error(
      "[core.center_agent_task.terminal_projection_recovery_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

async function runCenterAgentTaskRecovery(input: {
  env: CoreBindings;
  nowMs: number;
  recoverCenterAgentTasks?: typeof recoverCenterAgentTaskWork;
}): Promise<void> {
  const taskDb = localStateDb(input.env);
  const deliveryDb = wakeEvidenceDb(input.env);
  const taskInboxDb = inboxDb(input.env);
  if (!(taskDb && deliveryDb && taskInboxDb)) {
    console.error("[core.center_agent_task.recovery_store_unavailable]", {
      deliveryDatabaseAvailable: Boolean(deliveryDb),
      inboxDatabaseAvailable: Boolean(taskInboxDb),
      taskDatabaseAvailable: Boolean(taskDb),
    });
    return;
  }
  try {
    const result = await (
      input.recoverCenterAgentTasks ?? recoverCenterAgentTaskWork
    )({
      db: taskDb,
      inboxDb: taskInboxDb,
      now: () => input.nowMs,
      runtime: createCenterAgentTaskNativeRuntimePort({
        deliveryDb,
        env: input.env,
      }),
    });
    if (
      result.admissionsDelivered +
        result.admissionsFailed +
        result.stopsResolved +
        result.stopsFailed +
        result.errors >
      0
    ) {
      console.log(
        JSON.stringify({ event: "core.center_agent_task.recovery", ...result })
      );
    }
  } catch (error) {
    console.error("[core.center_agent_task.recovery_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runInboxEmailDeliveryRedrive(input: {
  env: CoreBindings;
  nowMs: number;
  retryInboxEmailDeliveries?: typeof retryInboxUrgentEmailDeliveries;
}): Promise<void> {
  const db = inboxDb(input.env);
  const authWorker = input.env.OPENMELD_AUTH_WORKER;
  const sendInboxUrgentEmail = authWorker?.sendInboxUrgentEmail;
  if (!(db && authWorker && sendInboxUrgentEmail)) {
    console.error("[core.inbox.email.redrive_unavailable]", {
      authSenderAvailable: Boolean(authWorker?.sendInboxUrgentEmail),
      databaseAvailable: Boolean(db),
    });
    return;
  }
  try {
    const organizationMembersById = new Map<
      string,
      Promise<Set<string> | null>
    >();
    const result = await (
      input.retryInboxEmailDeliveries ?? retryInboxUrgentEmailDeliveries
    )({
      db,
      nowMs: input.nowMs,
      resolveOrganizationAccess: async ({
        organizationId,
        recipientUserId,
      }) => {
        let members = organizationMembersById.get(organizationId);
        if (!members) {
          members = resolveOrganizationDirectoryMembers({
            authWorker,
            organizationId,
          })
            .then(
              (directoryMembers) =>
                new Set(directoryMembers.map((member) => member.userId))
            )
            .catch(() => null);
          organizationMembersById.set(organizationId, members);
        }
        const activeMemberIds = await members;
        if (!activeMemberIds) {
          return "unavailable";
        }
        return activeMemberIds.has(recipientUserId) ? "allowed" : "denied";
      },
      send: async (request) => await sendInboxUrgentEmail(request),
    });
    if (result.attempted > 0 || result.failed > 0) {
      console.log(
        JSON.stringify({ event: "core.inbox.email.redrive", ...result })
      );
    }
  } catch (error) {
    console.error("[core.inbox.email.redrive_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runSlackNativeDeliveryInboxReconciliation(input: {
  env: CoreBindings;
  nowMs: number;
  reconcileSlackNativeDeliveryInbox?: typeof reconcileLinkedSlackNativeDeliveryInbox;
}): Promise<void> {
  const db = localStateDb(input.env);
  if (!db) {
    return;
  }
  try {
    const result = await (
      input.reconcileSlackNativeDeliveryInbox ??
      reconcileLinkedSlackNativeDeliveryInbox
    )({ db, env: input.env, nowMs: input.nowMs });
    if (result.attempted > 0 || result.errors > 0) {
      console.log(
        JSON.stringify({
          event: "core.remote_agent.native_delivery.inbox_reconcile",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error(
      "[core.remote_agent.native_delivery.inbox_reconcile_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

async function runOrganizationDocumentInboxReconciliation(input: {
  env: CoreBindings;
  nowMs: number;
  reconcileOrganizationDocumentInbox?: typeof reconcileOrganizationDocumentDraftInbox;
}): Promise<void> {
  const db = organizationDocumentsDb(input.env);
  if (
    !(db && input.env.OPENMELD_AUTH_WORKER?.resolveOrganizationDirectoryMembers)
  ) {
    console.error("[core.organization_document.inbox_reconcile_unavailable]", {
      authDirectoryAvailable: Boolean(
        input.env.OPENMELD_AUTH_WORKER?.resolveOrganizationDirectoryMembers
      ),
      databaseAvailable: Boolean(db),
    });
    return;
  }
  try {
    const result = await (
      input.reconcileOrganizationDocumentInbox ??
      reconcileOrganizationDocumentDraftInbox
    )({
      authWorker: input.env.OPENMELD_AUTH_WORKER,
      db,
      nowMs: input.nowMs,
    });
    if (result.attempted > 0 || result.errors > 0) {
      console.log(
        JSON.stringify({
          event: "core.organization_document.inbox_reconcile",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error("[core.organization_document.inbox_reconcile_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runPreHeadFailurePublicationRedrive(input: {
  env: CoreBindings;
  nowMs: number;
  retryPreHeadFailurePublications?: typeof retryPendingPreHeadFailurePublications;
}): Promise<void> {
  const db = dispatchRecoveryDb(input.env);
  if (!db) {
    return;
  }
  try {
    const result = await (
      input.retryPreHeadFailurePublications ??
      retryPendingPreHeadFailurePublications
    )({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
    if (result.enqueued + result.errors > 0) {
      console.log(
        JSON.stringify({
          event: "core.dispatch.pre_head_failure_publication.redrive",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error(
      "[core.dispatch.pre_head_failure_publication.redrive_failed]",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }
}

async function runLarkPlatformRegistrationContinuation(input: {
  env: CoreBindings;
  nowMs: number;
  runLarkPlatformRegistrationTick?: typeof runLarkPlatformRegistrationTick;
}): Promise<void> {
  const db = localStateDb(input.env);
  if (!db) {
    console.error("[core.remote_agent.lark_registration.db_unavailable]", {
      event: "core.remote_agent.lark_registration.db_unavailable",
    });
    return;
  }
  try {
    const result = await (
      input.runLarkPlatformRegistrationTick ?? runLarkPlatformRegistrationTick
    )({
      classifyOrganization: async ({ organizationId }) =>
        await readOrganizationPersonalClassification({
          env: input.env,
          organizationId,
        }),
      clock: Date.now,
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
    if (result.scanned > 0) {
      console.log(
        JSON.stringify({
          event: "core.remote_agent.lark_registration.tick",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error("[core.remote_agent.lark_registration.tick_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runCenterAgentWakePublicationRedrive(input: {
  env: CoreBindings;
  nowMs: number;
  retryCenterAgentWakePublications?: typeof retryPendingCenterAgentWakePublications;
}): Promise<void> {
  const db = agentTaskCoordinationDb(input.env);
  if (!db) {
    return;
  }
  try {
    const result = await (
      input.retryCenterAgentWakePublications ??
      retryPendingCenterAgentWakePublications
    )({
      db,
      destinationNeutralContinuations:
        shouldWriteDestinationNeutralTaskContinuations(input.env),
      nowMs: input.nowMs,
      publishSignal: async (command) =>
        await rpcPostCenterAgentWakePublicationSignal(input.env, command),
      resolveSignal: async (command) =>
        await rpcResolveCenterAgentWakePublicationSignal(input.env, command),
    });
    if (
      result.completed + result.deferred + result.failed + result.rescheduled >
      0
    ) {
      console.log(
        JSON.stringify({
          event: "core.center_agent.wake_publication.redrive",
          ...result,
        })
      );
    }
  } catch (error) {
    console.error("[core.center_agent.wake_publication.redrive_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runAgentTaskContinuationRedrive(input: {
  env: CoreBindings;
  nowMs: number;
  retryAgentTaskContinuations?: typeof retryReadyAgentTaskContinuations;
}): Promise<void> {
  const db = agentTaskCoordinationDb(input.env);
  if (!db) {
    return;
  }
  try {
    await (
      input.retryAgentTaskContinuations ?? retryReadyAgentTaskContinuations
    )({
      db,
      env: input.env,
      nowMs: input.nowMs,
    });
  } catch (error) {
    console.error("[core.openmeld.agent_task.continuation_redrive_failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function reportStrandedRemoteAgentSlackEventIngress(input: {
  env: CoreBindings;
  nowMs: number;
  countStrandedSlackIngress?: typeof countStrandedRemoteAgentSlackEventIngress;
}): Promise<void> {
  const db = localStateDb(input.env);
  if (!db) {
    return;
  }
  const countStrandedSlackIngress =
    input.countStrandedSlackIngress ??
    countStrandedRemoteAgentSlackEventIngress;
  const strandedCount = await countStrandedSlackIngress({
    db,
    nowMs: input.nowMs,
  });
  if (strandedCount === 0) {
    return;
  }
  console.error("[core.remote_agent.slack_event.stranded_admission]", {
    count: strandedCount,
    reasonCode: "remote_agent.slack_event_claim_expired",
  });
  emitCoreCloudflareRuntimeEvidence(input.env, {
    durationMs: 0,
    event: "core.remote_agent.slack_event.stranded_admission",
    messageCount: strandedCount,
    operation: ROUTINE_TICK_CRON,
    reasonCode: "remote_agent.slack_event_claim_expired",
    runtimeKind: "queue",
    status: "failed",
    workerEnvironment: input.env.OPENMELD_WORKER_ENVIRONMENT,
  });
}

async function runAgentActivityScheduledRetention(input: {
  env: CoreBindings;
  nowMs: number;
  runAgentActivityDailyAggregation?: typeof runAgentActivityDailyAggregation;
  runAgentActivityRetention?: typeof runAgentActivityRetention;
}) {
  try {
    const db = agentActivityDb(input.env);
    if (!db) {
      throw new Error("Agent Activity retention database is unavailable.");
    }
    const aggregationResult = await (
      input.runAgentActivityDailyAggregation ?? runAgentActivityDailyAggregation
    )({ db, nowMs: input.nowMs });
    console.log(
      JSON.stringify({
        event: "core.agent_activity.daily_aggregation.tick",
        ...aggregationResult,
      })
    );
    const retentionResult = await (
      input.runAgentActivityRetention ?? runAgentActivityRetention
    )({ db, nowMs: input.nowMs });
    console.log(
      JSON.stringify({
        event: "core.agent_activity.retention.tick",
        ...retentionResult,
      })
    );
    return null;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "core.agent_activity.retention.failed",
        reason: "scheduled_task_failed",
        ...summarizeScheduledError(error),
      })
    );
    return error;
  }
}

async function runScheduledRetention(input: {
  cron: string | null;
  env: CoreBindings;
  nowMs: number;
  runAgentActivityDailyAggregation?: typeof runAgentActivityDailyAggregation;
  runAgentActivityRetention?: typeof runAgentActivityRetention;
  runAgentControllerTaskRetention?: typeof runAgentControllerTaskRetention;
}): Promise<unknown[]> {
  if (input.cron !== AGENT_ACTIVITY_RETENTION_CRON) {
    return [];
  }
  const agentActivityFailure = await runAgentActivityScheduledRetention(input);
  const agentControllerTaskFailure =
    await runAgentControllerTaskScheduledRetention(input);
  return [agentActivityFailure, agentControllerTaskFailure].filter(
    (failure) => failure !== null
  );
}

async function runAgentControllerTaskScheduledRetention(input: {
  env: CoreBindings;
  nowMs: number;
  runAgentControllerTaskRetention?: typeof runAgentControllerTaskRetention;
}) {
  try {
    const db = agentTaskCoordinationDb(input.env);
    if (!db) {
      throw new Error(
        "Agent Controller task retention database is unavailable."
      );
    }
    const result = await (
      input.runAgentControllerTaskRetention ?? runAgentControllerTaskRetention
    )({
      db,
      nowMs: input.nowMs,
    });
    console.log(
      JSON.stringify({
        event: "core.agent_controller_task.retention.tick",
        ...result,
      })
    );
    return null;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "core.agent_controller_task.retention.failed",
        reason: "scheduled_task_failed",
        ...summarizeScheduledError(error),
      })
    );
    return error;
  }
}

function throwScheduledRetentionFailures(failures: unknown[]): void {
  if (failures.length === 0) {
    return;
  }
  if (failures.length === 1) {
    throw failures[0];
  }
  throw new AggregateError(failures, "Core scheduled retention tasks failed.");
}

function summarizeScheduledError(error: unknown): {
  errorMessage: string;
  errorName: string;
} {
  if (error instanceof Error) {
    return {
      errorMessage: error.message.slice(0, 500),
      errorName: error.name.slice(0, 120),
    };
  }
  return {
    errorMessage: String(error).slice(0, 500),
    errorName: "UnknownError",
  };
}
