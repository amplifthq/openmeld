import { desc, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const agentControllerTasks = sqliteTable(
  "agent_controller_tasks",
  {
    taskKey: text("task_key").primaryKey(),
    organizationId: text("organization_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    openMeldServiceRuntimeId: text("openmeld_service_runtime_id").notNull(),
    hostId: text("host_id").notNull(),
    agentControllerRef: text("agent_controller_ref").notNull(),
    taskId: text("task_id").notNull(),
    taskHandleJson: text("task_handle_json").notNull(),
    registrationEventId: text("registration_event_id").notNull(),
    registrationSource: text("registration_source").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("agent_controller_tasks_registration_event_unique").on(
      table.registrationEventId
    ),
    uniqueIndex("agent_controller_tasks_controller_identity_unique").on(
      table.hostId,
      table.agentControllerRef,
      table.taskId
    ),
    index("agent_controller_tasks_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    index("agent_controller_tasks_org_owner_occurred_idx").on(
      table.organizationId,
      table.ownerUserId,
      desc(table.occurredAtMs)
    ),
    index("agent_controller_tasks_runtime_updated_idx").on(
      table.openMeldServiceRuntimeId,
      desc(table.updatedAtMs)
    ),
    check(
      "agent_controller_tasks_identity_non_empty_check",
      sql`length(trim("task_key")) > 0 and length(trim("host_id")) > 0 and length(trim("agent_controller_ref")) > 0 and length(trim("task_id")) > 0`
    ),
    check(
      "agent_controller_tasks_authority_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("owner_user_id")) > 0 and length(trim("openmeld_service_runtime_id")) > 0`
    ),
    check(
      "agent_controller_tasks_payload_non_empty_check",
      sql`length(trim("task_handle_json")) > 0 and length(trim("registration_event_id")) > 0`
    ),
    check(
      "agent_controller_tasks_registration_source_check",
      sql`"registration_source" in ('claude_session_start', 'claude_subagent_start', 'claude_task_created', 'codex_subagent_start', 'codex_user_prompt_submit')`
    ),
    check(
      "agent_controller_tasks_times_check",
      sql`"occurred_at_ms" >= 0 and "observed_at_ms" >= 0 and "updated_at_ms" >= "observed_at_ms"`
    ),
  ]
);

export const agentControllerTaskLifecycleEvents = sqliteTable(
  "agent_controller_task_lifecycle_events",
  {
    eventId: text("event_id").primaryKey(),
    taskKey: text("task_key").notNull(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    payloadJson: text("payload_json").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
    processedAtMs: integer("processed_at_ms"),
  },
  (table) => [
    index("agent_controller_task_events_task_observed_idx").on(
      table.taskKey,
      desc(table.observedAtMs)
    ),
    index("agent_controller_task_events_unprocessed_idx").on(
      table.processedAtMs,
      table.observedAtMs
    ),
    check(
      "agent_controller_task_events_identity_non_empty_check",
      sql`length(trim("event_id")) > 0 and length(trim("task_key")) > 0`
    ),
    check(
      "agent_controller_task_events_type_check",
      sql`"event_type" in ('registered', 'completed', 'needs_attention')`
    ),
    check(
      "agent_controller_task_events_source_check",
      sql`"source" in ('claude_notification', 'claude_session_start', 'claude_subagent_start', 'claude_subagent_stop', 'claude_task_completed', 'claude_task_created', 'codex_permission_request', 'codex_stop', 'codex_subagent_start', 'codex_subagent_stop', 'codex_user_prompt_submit')`
    ),
    check(
      "agent_controller_task_events_payload_non_empty_check",
      sql`length(trim("payload_json")) > 0`
    ),
    check(
      "agent_controller_task_events_times_check",
      sql`"occurred_at_ms" >= 0 and "observed_at_ms" >= 0 and ("processed_at_ms" is null or "processed_at_ms" >= "observed_at_ms")`
    ),
  ]
);

export const agentTaskTerminalOutcomes = sqliteTable(
  "agent_task_terminal_outcomes",
  {
    taskKey: text("task_key").primaryKey(),
    taskHandleJson: text("task_handle_json").notNull(),
    status: text("status").notNull(),
    eventId: text("event_id").notNull(),
    outcomeJson: text("outcome_json").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
  },
  (table) => [
    index("agent_task_terminal_outcomes_event_idx").on(table.eventId),
    index("agent_task_terminal_outcomes_observed_idx").on(table.observedAtMs),
    index("agent_task_terminal_outcomes_status_observed_idx").on(
      table.status,
      desc(table.observedAtMs)
    ),
    check(
      "agent_task_terminal_outcomes_task_key_non_empty_check",
      sql`length(trim("task_key")) > 0`
    ),
    check(
      "agent_task_terminal_outcomes_handle_non_empty_check",
      sql`length(trim("task_handle_json")) > 0`
    ),
    check(
      "agent_task_terminal_outcomes_status_check",
      sql`"status" in ('succeeded', 'completed', 'failed', 'stopped', 'stayed_silent', 'publication_failed')`
    ),
    check(
      "agent_task_terminal_outcomes_event_non_empty_check",
      sql`length(trim("event_id")) > 0`
    ),
    check(
      "agent_task_terminal_outcomes_outcome_non_empty_check",
      sql`length(trim("outcome_json")) > 0`
    ),
    check(
      "agent_task_terminal_outcomes_times_check",
      sql`"occurred_at_ms" >= 0 and "observed_at_ms" >= 0`
    ),
  ]
);

export const agentTaskNeedsAttentionObservations = sqliteTable(
  "agent_task_needs_attention_observations",
  {
    taskKey: text("task_key").notNull(),
    eventId: text("event_id").notNull(),
    taskHandleJson: text("task_handle_json").notNull(),
    status: text("status").notNull(),
    observationJson: text("observation_json").notNull(),
    occurredAtMs: integer("occurred_at_ms").notNull(),
    observedAtMs: integer("observed_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.taskKey, table.eventId],
      name: "agent_task_needs_attention_observations_pk",
    }),
    index("agent_task_needs_attention_observations_task_occurred_idx").on(
      table.taskKey,
      desc(table.occurredAtMs)
    ),
    index("agent_task_needs_attention_observations_observed_idx").on(
      table.observedAtMs
    ),
    check(
      "agent_task_needs_attention_observations_identity_non_empty_check",
      sql`length(trim("task_key")) > 0 and length(trim("event_id")) > 0`
    ),
    check(
      "agent_task_needs_attention_observations_payload_non_empty_check",
      sql`length(trim("task_handle_json")) > 0 and length(trim("observation_json")) > 0`
    ),
    check(
      "agent_task_needs_attention_observations_status_check",
      sql`"status" = 'needs_attention'`
    ),
    check(
      "agent_task_needs_attention_observations_times_check",
      sql`"occurred_at_ms" >= 0 and "observed_at_ms" >= 0`
    ),
  ]
);

export const agentTaskCompletionSubscriptions = sqliteTable(
  "agent_task_completion_subscriptions",
  {
    subscriptionId: text("subscription_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    organizationId: text("organization_id").notNull(),
    watchedTaskKey: text("watched_task_key").notNull(),
    watchedTaskHandleJson: text("watched_task_handle_json").notNull(),
    observerTaskKey: text("observer_task_key").notNull(),
    observerTaskHandleJson: text("observer_task_handle_json").notNull(),
    completionCondition: text("completion_condition").notNull(),
    continuationJson: text("continuation_json"),
    continuationIdempotencyKey: text("continuation_idempotency_key"),
    state: text("state").notNull(),
    outcomeJson: text("outcome_json"),
    lastEventId: text("last_event_id"),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    continuationTaskKey: text("continuation_task_key"),
    continuationTaskHandleJson: text("continuation_task_handle_json"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    settledAtMs: integer("settled_at_ms"),
  },
  (table) => [
    uniqueIndex("agent_task_completion_subscriptions_idempotency_unique").on(
      table.idempotencyKey
    ),
    uniqueIndex(
      "agent_task_completion_subscriptions_continuation_idempotency_unique"
    ).on(table.continuationIdempotencyKey),
    index("agent_task_completion_subscriptions_watched_state_idx").on(
      table.watchedTaskKey,
      table.state
    ),
    index("agent_task_completion_subscriptions_state_updated_idx").on(
      table.state,
      table.updatedAtMs
    ),
    index("agent_task_completion_subscriptions_observer_idx").on(
      table.observerTaskKey,
      desc(table.createdAtMs)
    ),
    index("agent_task_completion_subscriptions_observer_state_idx").on(
      table.observerTaskKey,
      table.state
    ),
    index("agent_task_completion_subscriptions_continuation_task_state_idx").on(
      table.continuationTaskKey,
      table.state
    ),
    check(
      "agent_task_completion_subscriptions_idempotency_non_empty_check",
      sql`length(trim("idempotency_key")) > 0`
    ),
    check(
      "agent_task_completion_subscriptions_org_non_empty_check",
      sql`length(trim("organization_id")) > 0`
    ),
    check(
      "agent_task_completion_subscriptions_watched_non_empty_check",
      sql`length(trim("watched_task_key")) > 0 and length(trim("watched_task_handle_json")) > 0`
    ),
    check(
      "agent_task_completion_subscriptions_observer_non_empty_check",
      sql`length(trim("observer_task_key")) > 0 and length(trim("observer_task_handle_json")) > 0`
    ),
    check(
      "agent_task_completion_subscriptions_condition_check",
      sql`"completion_condition" in ('terminal', 'succeeded', 'failed', 'needs_attention')`
    ),
    check(
      "agent_task_completion_subscriptions_continuation_shape_check",
      sql`(
        ("continuation_json" is null and "continuation_idempotency_key" is null)
        or ("continuation_json" is not null and "continuation_idempotency_key" is not null and length(trim("continuation_idempotency_key")) > 0)
      )`
    ),
    check(
      "agent_task_completion_subscriptions_state_check",
      sql`"state" in ('pending', 'ready', 'continuation_claimed', 'settled', 'cancelled')`
    ),
    check(
      "agent_task_completion_subscriptions_claim_shape_check",
      sql`(
        ("state" = 'continuation_claimed' and "claim_id" is not null and "claim_expires_at_ms" is not null)
        or ("state" <> 'continuation_claimed' and "claim_id" is null and "claim_expires_at_ms" is null)
      )`
    ),
    check(
      "agent_task_completion_subscriptions_continuation_task_shape_check",
      sql`(
        ("continuation_task_key" is null and "continuation_task_handle_json" is null)
        or ("continuation_task_key" is not null and "continuation_task_handle_json" is not null)
      )`
    ),
    check(
      "agent_task_completion_subscriptions_times_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("settled_at_ms" is null or "settled_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const agentDelegations = sqliteTable(
  "agent_delegations",
  {
    delegationId: text("delegation_id").primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    organizationId: text("organization_id").notNull(),
    spaceId: text("space_id").notNull(),
    parentTaskKey: text("parent_task_key").notNull(),
    parentTaskHandleJson: text("parent_task_handle_json").notNull(),
    completionPolicyJson: text("completion_policy_json").notNull(),
    state: text("state").notNull(),
    generation: integer("generation").notNull(),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
    completedAtMs: integer("completed_at_ms"),
  },
  (table) => [
    uniqueIndex("agent_delegations_idempotency_unique").on(
      table.idempotencyKey
    ),
    index("agent_delegations_parent_state_idx").on(
      table.parentTaskKey,
      table.state
    ),
    index("agent_delegations_org_state_updated_idx").on(
      table.organizationId,
      table.state,
      desc(table.updatedAtMs)
    ),
    check(
      "agent_delegations_identity_non_empty_check",
      sql`length(trim("delegation_id")) > 0 and length(trim("idempotency_key")) > 0`
    ),
    check(
      "agent_delegations_scope_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("space_id")) > 0`
    ),
    check(
      "agent_delegations_parent_non_empty_check",
      sql`length(trim("parent_task_key")) > 0 and length(trim("parent_task_handle_json")) > 0`
    ),
    check(
      "agent_delegations_policy_non_empty_check",
      sql`length(trim("completion_policy_json")) > 0`
    ),
    check(
      "agent_delegations_state_check",
      sql`"state" in ('active', 'completed', 'cancelled', 'failed')`
    ),
    check("agent_delegations_generation_positive_check", sql`"generation" > 0`),
    check(
      "agent_delegations_times_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("completed_at_ms" is null or "completed_at_ms" >= "created_at_ms")`
    ),
  ]
);

export const centerAgentWakePublications = sqliteTable(
  "center_agent_wake_publications",
  {
    publicationId: text("publication_id").primaryKey(),
    delegationId: text("delegation_id").notNull(),
    organizationId: text("organization_id").notNull(),
    spaceId: text("space_id").notNull(),
    commandJson: text("command_json").notNull(),
    state: text("state").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    nextAttemptAtMs: integer("next_attempt_at_ms").notNull(),
    lastError: text("last_error"),
    claimId: text("claim_id"),
    claimExpiresAtMs: integer("claim_expires_at_ms"),
    acceptedAtMs: integer("accepted_at_ms"),
    signalJson: text("signal_json"),
    completedAtMs: integer("completed_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    uniqueIndex("center_agent_wake_publications_delegation_unique").on(
      table.delegationId
    ),
    index("center_agent_wake_publications_due_idx").on(
      table.state,
      table.nextAttemptAtMs
    ),
    index("center_agent_wake_publications_org_updated_idx").on(
      table.organizationId,
      desc(table.updatedAtMs)
    ),
    check(
      "center_agent_wake_publications_identity_non_empty_check",
      sql`length(trim("publication_id")) > 0 and length(trim("delegation_id")) > 0`
    ),
    check(
      "center_agent_wake_publications_scope_non_empty_check",
      sql`length(trim("organization_id")) > 0 and length(trim("space_id")) > 0`
    ),
    check(
      "center_agent_wake_publications_command_non_empty_check",
      sql`length(trim("command_json")) > 0`
    ),
    check(
      "center_agent_wake_publications_state_check",
      sql`"state" in ('pending', 'accepted', 'completed', 'failed')`
    ),
    check(
      "center_agent_wake_publications_attempt_nonnegative_check",
      sql`"attempt_count" >= 0`
    ),
    check(
      "center_agent_wake_publications_times_check",
      sql`"next_attempt_at_ms" >= 0 and "created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("claim_expires_at_ms" is null or "claim_expires_at_ms" >= "created_at_ms") and ("accepted_at_ms" is null or "accepted_at_ms" >= "created_at_ms") and ("completed_at_ms" is null or "completed_at_ms" >= "created_at_ms")`
    ),
    check(
      "center_agent_wake_publications_claim_shape_check",
      sql`(("claim_id" is null and "claim_expires_at_ms" is null) or (length(trim("claim_id")) > 0 and "claim_expires_at_ms" is not null))`
    ),
    check(
      "center_agent_wake_publications_terminal_shape_check",
      sql`(
        ("state" = 'pending' and "accepted_at_ms" is null and "signal_json" is null and "completed_at_ms" is null)
        or ("state" = 'accepted' and "accepted_at_ms" is not null and length(trim("signal_json")) > 0 and "completed_at_ms" is null)
        or ("state" = 'completed' and "accepted_at_ms" is not null and length(trim("signal_json")) > 0 and "completed_at_ms" is not null)
        or ("state" = 'failed' and "completed_at_ms" is not null)
      )`
    ),
  ]
);

export const agentDelegationChildren = sqliteTable(
  "agent_delegation_children",
  {
    delegationId: text("delegation_id").notNull(),
    childIndex: integer("child_index").notNull(),
    taskKey: text("task_key").notNull(),
    taskHandleJson: text("task_handle_json").notNull(),
    role: text("role").notNull(),
    agentProfileId: text("agent_profile_id").notNull(),
    state: text("state").notNull(),
    terminalOutcomeJson: text("terminal_outcome_json"),
    activatedAtMs: integer("activated_at_ms"),
    terminalAtMs: integer("terminal_at_ms"),
    createdAtMs: integer("created_at_ms").notNull(),
    updatedAtMs: integer("updated_at_ms").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.delegationId, table.childIndex],
      name: "agent_delegation_children_pk",
    }),
    uniqueIndex("agent_delegation_children_task_unique").on(table.taskKey),
    index("agent_delegation_children_delegation_state_idx").on(
      table.delegationId,
      table.state
    ),
    check(
      "agent_delegation_children_index_nonnegative_check",
      sql`"child_index" >= 0`
    ),
    check(
      "agent_delegation_children_task_non_empty_check",
      sql`length(trim("task_key")) > 0 and length(trim("task_handle_json")) > 0`
    ),
    check(
      "agent_delegation_children_role_check",
      sql`"role" in ('primary', 'fallback')`
    ),
    check(
      "agent_delegation_children_profile_non_empty_check",
      sql`length(trim("agent_profile_id")) > 0`
    ),
    check(
      "agent_delegation_children_state_check",
      sql`"state" in ('planned', 'active', 'terminal', 'skipped', 'cancelled')`
    ),
    check(
      "agent_delegation_children_times_check",
      sql`"created_at_ms" >= 0 and "updated_at_ms" >= "created_at_ms" and ("activated_at_ms" is null or "activated_at_ms" >= "created_at_ms") and ("terminal_at_ms" is null or "terminal_at_ms" >= "created_at_ms")`
    ),
  ]
);
