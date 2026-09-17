import * as z from "zod/v4";
import { serviceControlCapabilitiesSchema } from "../../service-account-admission";
import { localProjectControlConnectionSchema } from "../daemon/local-project-control";
import { agentActivitySnapshotResponseSchema } from "../http/agent-activity";
import { agentActivitySessionInventoryResponseSchema } from "../http/agent-activity-sessions";
import {
  createCenterAgentRoutineResponseSchema,
  deleteCenterAgentRoutineResponseSchema,
  listCenterAgentRoutineRunsResponseSchema,
  listCenterAgentRoutinesResponseSchema,
  pauseCenterAgentRoutineResponseSchema,
  resumeCenterAgentRoutineResponseSchema,
  updateCenterAgentRoutineResponseSchema,
} from "../http/center-agent-routines";
import {
  submitFeedbackIssueRequestSchema,
  submitFeedbackIssueResponseSchema,
} from "../http/feedback";
import { organizationComputersResponseSchema } from "../http/organization-computers";
import { organizationDirectoryResponseSchema } from "../http/organization-directory";
import {
  getOrganizationJoinLinkResponseSchema,
  revokeOrganizationJoinLinkResponseSchema,
} from "../http/organization-join-link";
import {
  getOrganizationSkillResponseSchema,
  listOrganizationSkillsResponseSchema,
  ORGANIZATION_SKILL_FILE_LIMIT,
  organizationSkillReleaseSummarySchema,
  organizationSkillSummarySchema,
} from "../http/organization-skills";
import { organizationSpaceDirectoryWithMemberCountsResponseSchema } from "../http/organization-space-directory";
import {
  archiveProjectResponseSchema,
  createProjectResponseSchema,
  listProjectsResponseSchema,
  projectSchema,
  updateProjectResponseSchema,
} from "../http/projects";
import {
  spaceMemberAgentWakeAvailabilitySchema,
  spaceMemberDirectoryAllowedRelationsSchema,
  spaceMemberDirectorySchema,
  spaceMemberKindSchema,
} from "../http/space-members";
import { daemonStatusServerRequirementSchema } from "./daemon-status-server-requirement";

/**
 * Shared contract for the OpenMeld CLI `--json` machine-readable output boundary.
 *
 * This is the single source of truth for the stdout envelope a non-interactive
 * driver (Desktop GUI, scripts, CI) parses when a command is run with `--json`.
 * The CLI must derive its envelope types from these schemas via `z.infer`
 * instead of hand-writing a parallel shape that can drift
 * (`developing/architecture/shared-contracts.md`: "CLI JSON" is a shared
 * boundary; "Do not create a separate hand-written shared type that can drift
 * from the runtime schema.").
 *
 * Scope: this owns ONLY the `{ schemaVersion: 1, type, ... }` `--json` envelope.
 * It does NOT own the separate `--view agent` presenter protocol (the flat
 * `{ type: "error", code, message }` / `{ type: "hints", ... }` lines and the
 * `{ type: "result", code, payload }` stream), which is a distinct
 * machine-readable surface emitted without `schemaVersion`.
 */

/**
 * The CLI `--json` envelope schema version. This versions the envelope wire
 * surface independently of `OPENMELD_SCHEMA_VERSION` and the other component schema
 * versions, mirroring `LOCAL_COMPONENTS_SCHEMA_VERSION`, because the `--json`
 * boundary evolves on its own cadence. It is currently `1` everywhere the CLI
 * emits an envelope.
 */
export const CLI_JSON_OUTPUT_SCHEMA_VERSION = 1 as const;

const schemaVersionSchema = z.literal(CLI_JSON_OUTPUT_SCHEMA_VERSION);

/**
 * Stable error codes a blocked command entry-check emits under `--json`. These
 * are the closed set the CLI routes blocked entry states to; defining the set
 * here keeps the CLI from minting drift codes. The error envelope itself stays
 * open (`error.code` is any string) because errors also originate outside the
 * entry-check flow (e.g. `cli.error`, gateway codes).
 */
export const cliJsonEntryCheckBlockedErrorCodeSchema = z.enum([
  "auth.authentication_required",
  "auth.session_token_unavailable",
  "profile.required",
  "local_state.repair_required",
  "upgrade.required",
]);

export type CliJsonEntryCheckBlockedErrorCode = z.infer<
  typeof cliJsonEntryCheckBlockedErrorCodeSchema
>;

/**
 * The failure envelope: the top-level boundary prints exactly this when a
 * command throws (or a blocking entry-check fires) under `--json`, then exits 1.
 * Fully owned, so it is strict.
 */
export const cliJsonErrorEnvelopeSchema = z.strictObject({
  schemaVersion: schemaVersionSchema,
  type: z.literal("error"),
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});

export type CliJsonErrorEnvelope = z.infer<typeof cliJsonErrorEnvelopeSchema>;

/**
 * Success envelopes share the `{ schemaVersion, type }` frame and then flatten a
 * command-specific result onto the envelope. The deep result shapes (daemon
 * install/run/status state, runtime projections, agent registration summaries)
 * are owned by their respective daemon / agents runtime contracts. This envelope
 * is the FRAME owner: it pins the version literal and the closed `type`
 * discriminant, and deliberately RELAXES the flattened payload via
 * `z.looseObject` rather than re-deriving those domain-owned shapes here — doing
 * so would create a second source of truth for payloads another owner already
 * defines. (`shared-contracts.md`: "Document any relaxed object boundary.")
 *
 * Only fields the CLI authors directly on the envelope (and that carry a stable
 * literal or primitive shape) are validated here; everything flattened from a
 * domain payload passes through the relaxed boundary.
 */
function defineSuccessEnvelope<
  TType extends string,
  TShape extends z.ZodRawShape,
>(type: TType, shape: TShape) {
  return z.looseObject({
    schemaVersion: schemaVersionSchema,
    type: z.literal(type),
    ...shape,
  });
}

// Routine payloads already have complete shared HTTP response schemas, so their
// CLI envelopes can stay strict without re-owning any Routine fields here.
function defineStrictSuccessEnvelope<
  TType extends string,
  TShape extends z.ZodRawShape,
>(type: TType, shape: TShape) {
  return z.strictObject({
    schemaVersion: schemaVersionSchema,
    type: z.literal(type),
    ...shape,
  });
}

export const cliJsonDaemonRunEnvelopeSchema = defineSuccessEnvelope(
  "daemon.run",
  { ok: z.boolean() }
);

export const cliJsonDaemonInstallEnvelopeSchema = defineSuccessEnvelope(
  "daemon.install",
  { status: z.string() }
);

export const cliJsonDaemonUninstallEnvelopeSchema = defineSuccessEnvelope(
  "daemon.uninstall",
  { status: z.enum(["removed", "not_installed"]) }
);

export const cliJsonDaemonReinstallEnvelopeSchema = defineSuccessEnvelope(
  "daemon.reinstall",
  {}
);

export const cliJsonDaemonStatusEnvelopeSchema = defineSuccessEnvelope(
  "daemon.status",
  {
    // Distribution form of the running CLI/service: "binary" (single-binary
    // install) or "node-bundle" (npm dist + node_modules). Pure-additive
    // diagnostic field consumed by Desktop; absent on older CLIs.
    runtimeFlavor: z.enum(["binary", "node-bundle"]).optional(),
    serverRequirement: daemonStatusServerRequirementSchema.optional(),
  }
);

export const cliJsonServiceControlCapabilitiesEnvelopeSchema =
  defineSuccessEnvelope(
    "service.control_capabilities",
    serviceControlCapabilitiesSchema.shape
  );

export const cliJsonDaemonStopEnvelopeSchema = defineSuccessEnvelope(
  "daemon.stop",
  {}
);

export const cliJsonDaemonAutostartEnvelopeSchema = defineSuccessEnvelope(
  "daemon.autostart",
  {
    action: z.enum(["enable", "disable"]),
    enabled: z.boolean(),
  }
);

export const cliJsonAgentsDetectEnvelopeSchema = defineSuccessEnvelope(
  "agents.detect",
  { count: z.number().int().nonnegative() }
);

export const cliJsonAgentsListEnvelopeSchema = defineSuccessEnvelope(
  "agents.list",
  { count: z.number().int().nonnegative() }
);

export const cliJsonAgentsShowEnvelopeSchema = defineSuccessEnvelope(
  "agents.show",
  {}
);

export const cliJsonAgentsEnableEnvelopeSchema = defineSuccessEnvelope(
  "agents.enable",
  {}
);

export const cliJsonAgentsDisableEnvelopeSchema = defineSuccessEnvelope(
  "agents.disable",
  {}
);

export const cliJsonFeedbackSubmittedEnvelopeSchema = defineSuccessEnvelope(
  "feedback_submitted",
  {
    issueId: submitFeedbackIssueResponseSchema.shape.issueId,
    category: submitFeedbackIssueRequestSchema.shape.category,
    submitterKind: submitFeedbackIssueRequestSchema.shape.submitterKind,
    anonymous: z.boolean(),
  }
);

const cliJsonAgentActivityLocalBindingSchema = z.strictObject({
  boundAtMs: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
  repositoryFingerprint: z.string().nullable(),
  repositoryPath: z.string().min(1),
});

export const cliJsonProjectsListEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.list",
  {
    ...listProjectsResponseSchema.shape,
    localBindings: z.array(cliJsonAgentActivityLocalBindingSchema),
  }
);
export const cliJsonProjectsCreateEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.create",
  createProjectResponseSchema.shape
);
export const cliJsonProjectsUpdateEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.update",
  updateProjectResponseSchema.shape
);
export const cliJsonProjectsArchiveEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.archive",
  archiveProjectResponseSchema.shape
);
const cliJsonAgentActivityIntegrationUpdateSchema = z.strictObject({
  claude: z.enum(["changed", "missing", "reused"]),
  codex: z.enum(["changed", "missing", "reused"]),
  cursor: z.enum(["changed", "missing", "reused"]),
  openCode: z.enum(["changed", "missing", "reused"]),
});

const cliJsonAgentActivityIntegrationSetupSchema = z.discriminatedUnion(
  "status",
  [
    z.strictObject({
      integrations: cliJsonAgentActivityIntegrationUpdateSchema,
      status: z.literal("ready"),
    }),
    z.strictObject({
      message: z.string().trim().min(1).max(512),
      status: z.literal("needs_attention"),
    }),
  ]
);

export const cliJsonProjectsBindEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.bind",
  {
    binding: cliJsonAgentActivityLocalBindingSchema,
    integrationSetup: cliJsonAgentActivityIntegrationSetupSchema,
    project: projectSchema,
  }
);
export const cliJsonProjectsUnbindEnvelopeSchema = defineStrictSuccessEnvelope(
  "projects.unbind",
  {
    organizationId: z.string().min(1),
    projectSlug: z.string().min(1),
    unbound: z.literal(true),
  }
);

const cliJsonProjectConnectionSnapshotShape = {
  organizationId: z.string().min(1),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
  connections: z.array(localProjectControlConnectionSchema),
};

export const cliJsonProjectsConnectionsListEnvelopeSchema =
  defineStrictSuccessEnvelope("projects.connections.list", {
    ...cliJsonProjectConnectionSnapshotShape,
  });

export const cliJsonProjectsConnectionsSetDefaultEnvelopeSchema =
  defineStrictSuccessEnvelope("projects.connections.set_default", {
    ...cliJsonProjectConnectionSnapshotShape,
    status: z.enum(["updated", "unchanged"]),
  });

export const cliJsonProjectsConnectionsRemoveEnvelopeSchema =
  defineStrictSuccessEnvelope("projects.connections.remove", {
    ...cliJsonProjectConnectionSnapshotShape,
    status: z.enum(["removed", "unchanged"]),
  });

export const cliJsonAgentActivityReadEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "activity.read",
    agentActivitySnapshotResponseSchema.shape
  );

export const cliJsonAgentActivitySessionsEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "activity.sessions",
    agentActivitySessionInventoryResponseSchema.shape
  );

const cliJsonAgentActivityIntegrationStatusSchema = z.strictObject({
  claude: z.boolean(),
  codex: z.boolean(),
  cursor: z.boolean(),
  openCode: z.boolean(),
});

const cliJsonAgentActivityHealthSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  permanentlyRejected: z.number().int().nonnegative(),
  retrying: z.number().int().nonnegative(),
});

export const cliJsonAgentActivityInstallEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.install", {
    integrations: cliJsonAgentActivityIntegrationUpdateSchema,
  });

export const cliJsonAgentActivityUninstallEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.uninstall", {
    integrations: cliJsonAgentActivityIntegrationUpdateSchema,
  });

export const cliJsonAgentActivityStatusEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.status", {
    controllerTaskHealth: cliJsonAgentActivityHealthSchema,
    health: cliJsonAgentActivityHealthSchema,
    integrations: cliJsonAgentActivityIntegrationStatusSchema,
  });

export const cliJsonAgentActivityHealthEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.health", {
    controllerTaskHealth: cliJsonAgentActivityHealthSchema,
    health: cliJsonAgentActivityHealthSchema,
  });

export const cliJsonAgentActivitySyncEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.sync", {
    result: z.strictObject({
      controllerTaskEventSubmittedCount: z.number().int().nonnegative(),
      controllerTaskHealth: cliJsonAgentActivityHealthSchema,
      health: cliJsonAgentActivityHealthSchema,
      observedCount: z.number().int().nonnegative(),
      reason: z
        .enum([
          "service_contract_unavailable",
          "auth_unavailable",
          "registration_rejected",
          "write_auth_rejected",
          "write_endpoint_unavailable",
          "write_retryable_http_failure",
          "write_response_invalid",
          "write_timeout",
          "write_transport_failure",
          "inventory_write_auth_rejected",
          "inventory_endpoint_unavailable",
          "inventory_write_retryable_http_failure",
          "inventory_write_transport_failure",
        ])
        .nullable(),
      sessionInventory: z.strictObject({
        reason: z
          .enum([
            "service_contract_unavailable",
            "auth_unavailable",
            "registration_rejected",
            "inventory_write_auth_rejected",
            "inventory_endpoint_unavailable",
            "inventory_write_retryable_http_failure",
            "inventory_write_transport_failure",
          ])
          .nullable(),
        sessionCount: z.number().int().nonnegative(),
        sourceCount: z.number().int().nonnegative(),
        status: z.enum(["idle", "submitted", "unavailable"]),
        submittedSourceCount: z.number().int().nonnegative(),
      }),
      status: z.enum(["idle", "submitted", "unavailable"]),
      submittedCount: z.number().int().nonnegative(),
    }),
  });

export const cliJsonAgentActivityContextEnvelopeSchema =
  defineStrictSuccessEnvelope("activity.context", {
    context: z.string().min(1).max(300).nullable(),
  });

export const cliJsonRoutinesListEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.list",
  listCenterAgentRoutinesResponseSchema.shape
);

export const cliJsonRoutinesCreateEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.create",
  createCenterAgentRoutineResponseSchema.shape
);

// `show` selects one Routine from the shared list response. Its result payload
// intentionally reuses the existing single-Routine HTTP response shape rather
// than introducing a CLI-owned Routine DTO.
export const cliJsonRoutinesShowEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.show",
  createCenterAgentRoutineResponseSchema.shape
);

export const cliJsonRoutinesUpdateEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.update",
  updateCenterAgentRoutineResponseSchema.shape
);

export const cliJsonRoutinesPauseEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.pause",
  pauseCenterAgentRoutineResponseSchema.shape
);

export const cliJsonRoutinesResumeEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.resume",
  resumeCenterAgentRoutineResponseSchema.shape
);

export const cliJsonRoutinesDeleteEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.delete",
  deleteCenterAgentRoutineResponseSchema.shape
);

export const cliJsonRoutinesRunsEnvelopeSchema = defineStrictSuccessEnvelope(
  "routines.runs",
  listCenterAgentRoutineRunsResponseSchema.shape
);

export const cliJsonSpaceMembersEnvelopeSchema = defineStrictSuccessEnvelope(
  "space.members",
  spaceMemberDirectorySchema.shape
);

export const cliJsonSpaceMembersBriefEnvelopeSchema =
  defineStrictSuccessEnvelope("space.members.brief", {
    spaceId: z.string().trim().min(1),
    generatedAt: z.iso.datetime({ offset: true }),
    members: z.array(
      z.strictObject({
        profileId: z.string().trim().min(1),
        displayName: z.string().trim().min(1),
        profileKind: spaceMemberKindSchema,
        primaryMentionLabel: z.string().trim().min(1),
        allowedRelations: spaceMemberDirectoryAllowedRelationsSchema,
        wakeAvailability: spaceMemberAgentWakeAvailabilitySchema
          .pick({
            action: true,
            phase: true,
            reasonCode: true,
            status: true,
            summary: true,
          })
          .optional(),
        canWakeNow: z.boolean().optional(),
      })
    ),
  });

export const cliJsonSpaceListOrganizationEnvelopeSchema =
  defineStrictSuccessEnvelope("space.list.organization", {
    scope: z.literal("organization"),
    organizationId:
      organizationSpaceDirectoryWithMemberCountsResponseSchema.shape
        .organizationId,
    generatedAt:
      organizationSpaceDirectoryWithMemberCountsResponseSchema.shape
        .generatedAt,
    total: z.number().int().nonnegative(),
    returned: z.number().int().nonnegative(),
    spaces:
      organizationSpaceDirectoryWithMemberCountsResponseSchema.shape.spaces,
  });

export const cliJsonOrganizationDirectoryEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "organization.directory",
    organizationDirectoryResponseSchema.shape
  );

export const cliJsonOrganizationComputersEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "organization.computers",
    organizationComputersResponseSchema.shape
  );

export const cliJsonOrganizationInviteLinkGetEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "organization.invite_link.get",
    getOrganizationJoinLinkResponseSchema.shape
  );

export const cliJsonOrganizationInviteLinkCreateEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "organization.invite_link.create",
    getOrganizationJoinLinkResponseSchema.shape
  );

export const cliJsonOrganizationInviteLinkRevokeEnvelopeSchema =
  defineStrictSuccessEnvelope(
    "organization.invite_link.revoke",
    revokeOrganizationJoinLinkResponseSchema.shape
  );

export const cliJsonSkillsListEnvelopeSchema = defineStrictSuccessEnvelope(
  "skills.list",
  listOrganizationSkillsResponseSchema.shape
);

export const cliJsonSkillsShowEnvelopeSchema = defineStrictSuccessEnvelope(
  "skills.show",
  getOrganizationSkillResponseSchema.shape
);

export const cliJsonSkillsLoadEnvelopeSchema = defineStrictSuccessEnvelope(
  "skills.load",
  {
    cachePath: z.string().min(1),
    digest: organizationSkillReleaseSummarySchema.shape.digest,
    organizationId: organizationSkillSummarySchema.shape.organizationId,
    releaseId: organizationSkillReleaseSummarySchema.shape.id,
    resourcePaths: z
      .array(z.string().min(1))
      .max(ORGANIZATION_SKILL_FILE_LIMIT),
    reused: z.boolean(),
    skillId: organizationSkillSummarySchema.shape.id,
    skillMarkdownPath: z.string().min(1),
    skillName: organizationSkillSummarySchema.shape.name,
  }
);

export type CliJsonRoutinesListEnvelope = z.infer<
  typeof cliJsonRoutinesListEnvelopeSchema
>;
export type CliJsonRoutinesCreateEnvelope = z.infer<
  typeof cliJsonRoutinesCreateEnvelopeSchema
>;
export type CliJsonRoutinesShowEnvelope = z.infer<
  typeof cliJsonRoutinesShowEnvelopeSchema
>;
export type CliJsonRoutinesUpdateEnvelope = z.infer<
  typeof cliJsonRoutinesUpdateEnvelopeSchema
>;
export type CliJsonRoutinesPauseEnvelope = z.infer<
  typeof cliJsonRoutinesPauseEnvelopeSchema
>;
export type CliJsonRoutinesResumeEnvelope = z.infer<
  typeof cliJsonRoutinesResumeEnvelopeSchema
>;
export type CliJsonRoutinesDeleteEnvelope = z.infer<
  typeof cliJsonRoutinesDeleteEnvelopeSchema
>;
export type CliJsonRoutinesRunsEnvelope = z.infer<
  typeof cliJsonRoutinesRunsEnvelopeSchema
>;
export type CliJsonSpaceMembersEnvelope = z.infer<
  typeof cliJsonSpaceMembersEnvelopeSchema
>;
export type CliJsonSpaceListOrganizationEnvelope = z.infer<
  typeof cliJsonSpaceListOrganizationEnvelopeSchema
>;
export type CliJsonOrganizationDirectoryEnvelope = z.infer<
  typeof cliJsonOrganizationDirectoryEnvelopeSchema
>;
export type CliJsonOrganizationComputersEnvelope = z.infer<
  typeof cliJsonOrganizationComputersEnvelopeSchema
>;
export type CliJsonOrganizationInviteLinkGetEnvelope = z.infer<
  typeof cliJsonOrganizationInviteLinkGetEnvelopeSchema
>;
export type CliJsonOrganizationInviteLinkCreateEnvelope = z.infer<
  typeof cliJsonOrganizationInviteLinkCreateEnvelopeSchema
>;
export type CliJsonOrganizationInviteLinkRevokeEnvelope = z.infer<
  typeof cliJsonOrganizationInviteLinkRevokeEnvelopeSchema
>;

/**
 * The full `--json` output envelope: the failure envelope plus every success
 * envelope, discriminated on `type`. A `--json` driver dispatches on
 * `schemaVersion` + `type`; that frame is the contract this validates.
 */
export const cliJsonOutputEnvelopeSchema = z.discriminatedUnion("type", [
  cliJsonErrorEnvelopeSchema,
  cliJsonDaemonRunEnvelopeSchema,
  cliJsonDaemonInstallEnvelopeSchema,
  cliJsonDaemonUninstallEnvelopeSchema,
  cliJsonDaemonReinstallEnvelopeSchema,
  cliJsonDaemonStatusEnvelopeSchema,
  cliJsonServiceControlCapabilitiesEnvelopeSchema,
  cliJsonDaemonStopEnvelopeSchema,
  cliJsonDaemonAutostartEnvelopeSchema,
  cliJsonAgentsDetectEnvelopeSchema,
  cliJsonAgentsListEnvelopeSchema,
  cliJsonAgentsShowEnvelopeSchema,
  cliJsonAgentsEnableEnvelopeSchema,
  cliJsonAgentsDisableEnvelopeSchema,
  cliJsonFeedbackSubmittedEnvelopeSchema,
  cliJsonProjectsListEnvelopeSchema,
  cliJsonProjectsCreateEnvelopeSchema,
  cliJsonProjectsUpdateEnvelopeSchema,
  cliJsonProjectsArchiveEnvelopeSchema,
  cliJsonProjectsBindEnvelopeSchema,
  cliJsonProjectsUnbindEnvelopeSchema,
  cliJsonProjectsConnectionsListEnvelopeSchema,
  cliJsonProjectsConnectionsSetDefaultEnvelopeSchema,
  cliJsonProjectsConnectionsRemoveEnvelopeSchema,
  cliJsonAgentActivityReadEnvelopeSchema,
  cliJsonAgentActivitySessionsEnvelopeSchema,
  cliJsonAgentActivityInstallEnvelopeSchema,
  cliJsonAgentActivityUninstallEnvelopeSchema,
  cliJsonAgentActivityStatusEnvelopeSchema,
  cliJsonAgentActivityHealthEnvelopeSchema,
  cliJsonAgentActivitySyncEnvelopeSchema,
  cliJsonAgentActivityContextEnvelopeSchema,
  cliJsonRoutinesListEnvelopeSchema,
  cliJsonRoutinesCreateEnvelopeSchema,
  cliJsonRoutinesShowEnvelopeSchema,
  cliJsonRoutinesUpdateEnvelopeSchema,
  cliJsonRoutinesPauseEnvelopeSchema,
  cliJsonRoutinesResumeEnvelopeSchema,
  cliJsonRoutinesDeleteEnvelopeSchema,
  cliJsonRoutinesRunsEnvelopeSchema,
  cliJsonSpaceMembersEnvelopeSchema,
  cliJsonSpaceMembersBriefEnvelopeSchema,
  cliJsonSpaceListOrganizationEnvelopeSchema,
  cliJsonOrganizationDirectoryEnvelopeSchema,
  cliJsonOrganizationComputersEnvelopeSchema,
  cliJsonOrganizationInviteLinkGetEnvelopeSchema,
  cliJsonOrganizationInviteLinkCreateEnvelopeSchema,
  cliJsonOrganizationInviteLinkRevokeEnvelopeSchema,
  cliJsonSkillsListEnvelopeSchema,
  cliJsonSkillsShowEnvelopeSchema,
  cliJsonSkillsLoadEnvelopeSchema,
]);

export type CliJsonOutputEnvelope = z.infer<typeof cliJsonOutputEnvelopeSchema>;

export type CliJsonOutputType = CliJsonOutputEnvelope["type"];

/**
 * The closed set of `--json` envelope `type` discriminants, in the order the
 * union declares them. Useful for parity tests and contract documentation.
 */
export const CLI_JSON_OUTPUT_TYPES = [
  "error",
  "daemon.run",
  "daemon.install",
  "daemon.uninstall",
  "daemon.reinstall",
  "daemon.status",
  "service.control_capabilities",
  "daemon.stop",
  "daemon.autostart",
  "agents.detect",
  "agents.list",
  "agents.show",
  "agents.enable",
  "agents.disable",
  "feedback_submitted",
  "projects.list",
  "projects.create",
  "projects.update",
  "projects.archive",
  "projects.bind",
  "projects.unbind",
  "projects.connections.list",
  "projects.connections.set_default",
  "projects.connections.remove",
  "activity.read",
  "activity.sessions",
  "activity.install",
  "activity.uninstall",
  "activity.status",
  "activity.health",
  "activity.sync",
  "activity.context",
  "routines.list",
  "routines.create",
  "routines.show",
  "routines.update",
  "routines.pause",
  "routines.resume",
  "routines.delete",
  "routines.runs",
  "space.members",
  "space.members.brief",
  "space.list.organization",
  "organization.directory",
  "organization.computers",
  "organization.invite_link.get",
  "organization.invite_link.create",
  "organization.invite_link.revoke",
  "skills.list",
  "skills.show",
  "skills.load",
] as const satisfies readonly CliJsonOutputType[];
