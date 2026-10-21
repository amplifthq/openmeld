import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  AGENT_ACTIVITY_EVENT_MAX_BYTES,
  AGENT_ACTIVITY_EVENT_RETENTION_MS,
  AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS,
  agentActivityEventSchema,
  submitAgentActivityEventsResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityEvent,
  SubmitAgentActivityEventResult,
  SubmitAgentActivityEventsResponse,
} from "@openmeld/schemas/types";
import {
  readProjectLifecycleRecord,
  readProjectRepositorySettingsRecord,
} from "../projects/project-repository";
import type { VerifiedRuntimeReportingAuthority } from "../runtime-reporting/runtime-reporting-authority";
import { acceptAgentActivityEventRecord } from "./activity-event-repository";
import { linkAcceptedAgentActivityExecutions } from "./activity-execution-link-repository";

type MembershipEvidence =
  | {
      ok: true;
      userId: string;
    }
  | {
      ok: false;
      unavailable: boolean;
    };
export async function acceptAgentActivityEventBatch(input: {
  db: PostgresDatabase;
  events: readonly unknown[];
  now?: () => number;
  resolveMembership: (organizationId: string) => Promise<MembershipEvidence>;
  runtime: VerifiedRuntimeReportingAuthority;
}): Promise<SubmitAgentActivityEventsResponse> {
  const nowMs = (input.now ?? Date.now)();
  const results: SubmitAgentActivityEventResult[] = [];
  for (const [index, candidate] of input.events.entries()) {
    if (!isCandidateWithinByteLimit(candidate)) {
      results.push({
        ...readCandidateEventId(candidate),
        index,
        outcome: "permanent_rejected",
        reason: "event_invalid",
      });
      continue;
    }
    const parsed = agentActivityEventSchema.safeParse(candidate);
    if (!parsed.success) {
      results.push({
        ...readCandidateEventId(candidate),
        index,
        outcome: "permanent_rejected",
        reason: "event_invalid",
      });
      continue;
    }
    results.push(
      await acceptValidatedEvent({
        db: input.db,
        event: parsed.data,
        index,
        nowMs,
        resolveMembership: input.resolveMembership,
        runtime: input.runtime,
      })
    );
  }
  return parseResponse({
    events: results,
    status: summarizeBatchStatus(results),
    openMeldServiceRuntimeId: {
      source: "runtime_registry_authority",
      value: input.runtime.openMeldServiceRuntimeId,
    },
  });
}
function isCandidateWithinByteLimit(candidate: unknown): boolean {
  try {
    return (
      new TextEncoder().encode(JSON.stringify(candidate)).byteLength <=
      AGENT_ACTIVITY_EVENT_MAX_BYTES
    );
  } catch {
    return false;
  }
}
async function acceptValidatedEvent(input: {
  db: PostgresDatabase;
  event: AgentActivityEvent;
  index: number;
  nowMs: number;
  resolveMembership: (organizationId: string) => Promise<MembershipEvidence>;
  runtime: VerifiedRuntimeReportingAuthority;
}): Promise<SubmitAgentActivityEventResult> {
  if (!isEventTimeAcceptable(input.event, input.nowMs)) {
    return reject(input, "event_time_invalid", "permanent_rejected");
  }
  const membership = await input.resolveMembership(input.event.organizationId);
  if (!membership.ok) {
    return reject(
      input,
      membership.unavailable ? "membership_unavailable" : "membership_removed",
      membership.unavailable ? "retryable_rejected" : "permanent_rejected"
    );
  }
  if (membership.userId !== input.runtime.ownerUserId) {
    return reject(input, "membership_removed", "permanent_rejected");
  }
  const project = await readProjectLifecycleRecord({
    db: input.db,
    organizationId: input.event.organizationId,
    projectId: input.event.projectId,
  });
  if (!project) {
    return reject(input, "project_missing", "permanent_rejected");
  }
  if (project.archivedAtMs !== null) {
    return reject(input, "project_archived", "permanent_rejected");
  }
  const settings = await readProjectRepositorySettingsRecord({
    db: input.db,
    organizationId: input.event.organizationId,
    projectId: input.event.projectId,
  });
  if (!settings) {
    return reject(input, "project_missing", "permanent_rejected");
  }
  const associatedFingerprints = [
    ...(settings.legacyDefaultFingerprint
      ? [settings.legacyDefaultFingerprint]
      : []),
    ...settings.repositories.map(
      (repository) => repository.repositoryFingerprint
    ),
  ];
  if (
    associatedFingerprints.length > 0 &&
    (input.event.repositoryFingerprint === null ||
      !associatedFingerprints.includes(input.event.repositoryFingerprint))
  ) {
    return reject(
      input,
      "repository_fingerprint_mismatch",
      "permanent_rejected"
    );
  }
  const outcome = await acceptAgentActivityEventRecord({
    db: input.db,
    deviceId: input.runtime.deviceId,
    event: input.event,
    memberUserId: membership.userId,
    nowMs: input.nowMs,
    openMeldServiceRuntimeId: input.runtime.openMeldServiceRuntimeId,
  });
  if (outcome === "project_archived" || outcome === "project_missing") {
    return reject(input, outcome, "permanent_rejected");
  }
  if (outcome === "accepted" || outcome === "reused") {
    await linkAcceptedAgentActivityExecutions({
      activitySession: {
        deviceId: input.runtime.deviceId,
        memberUserId: membership.userId,
        organizationId: input.event.organizationId,
        provider: input.event.provider,
        providerSessionId: input.event.providerSessionId,
      },
      db: input.db,
      nowMs: input.nowMs,
    }).catch((error) => {
      console.warn("[core.agent_activity.execution_link_failed]", {
        errorName: error instanceof Error ? error.name : "NonError",
        eventId: input.event.eventId,
        organizationId: input.event.organizationId,
        projectId: input.event.projectId,
      });
    });
  }
  return outcome === "event_id_conflict"
    ? reject(input, outcome, "permanent_rejected")
    : { eventId: input.event.eventId, index: input.index, outcome };
}
function isEventTimeAcceptable(event: AgentActivityEvent, nowMs: number) {
  return (
    event.observedAtMs >= nowMs - AGENT_ACTIVITY_EVENT_RETENTION_MS &&
    event.observedAtMs <= nowMs + AGENT_ACTIVITY_PRESENCE_TTL_MAX_MS &&
    event.expiresAtMs <= event.observedAtMs + AGENT_ACTIVITY_EVENT_RETENTION_MS
  );
}
function reject(
  input: {
    event: AgentActivityEvent;
    index: number;
  },
  reason: NonNullable<SubmitAgentActivityEventResult["reason"]>,
  outcome: "permanent_rejected" | "retryable_rejected"
): SubmitAgentActivityEventResult {
  return { eventId: input.event.eventId, index: input.index, outcome, reason };
}
function readCandidateEventId(candidate: unknown): {
  eventId?: string;
} {
  if (!(candidate && typeof candidate === "object" && "eventId" in candidate)) {
    return {};
  }
  const eventId = String(candidate.eventId).trim();
  return eventId.length > 0 && eventId.length <= 256 ? { eventId } : {};
}
function summarizeBatchStatus(
  results: readonly SubmitAgentActivityEventResult[]
): "accepted" | "partial" | "rejected" {
  const accepted = results.filter(
    (result) => result.outcome === "accepted" || result.outcome === "reused"
  ).length;
  if (accepted === results.length) {
    return "accepted";
  }
  return accepted === 0 ? "rejected" : "partial";
}
function parseResponse(value: unknown): SubmitAgentActivityEventsResponse {
  const parsed = submitAgentActivityEventsResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Failed to build a valid Agent Activity event response.");
  }
  return parsed.data;
}
