import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import {
  projectSlugSchema,
  repositoryFingerprintSchema,
} from "../http/projects";
import { localFolderPathSchema } from "./local-folder-path";
import { openMeldRequestContextSchema } from "./profile-identity";
import { daemonServiceLaneSchema } from "./service-contract";

const boundedIdentifierSchema = z.string().trim().min(1).max(512);
const clientGenerationSchema = z.number().int().nonnegative();
const localProjectControlAbsolutePathSchema = localFolderPathSchema;

export const localProjectControlGitStatusSchema = z.enum([
  "available",
  "not_installed",
  "command_line_tools_missing",
  "timed_out",
  "unavailable",
]);

export const localProjectControlCandidateSchema = z.strictObject({
  candidateId: boundedIdentifierSchema,
  canonicalPath: localProjectControlAbsolutePathSchema,
  candidateKind: z.enum(["repository", "worktree"]),
  repositoryFingerprint: repositoryFingerprintSchema,
});

export const localProjectControlConnectionSchema = z.strictObject({
  bindingGeneration: boundedIdentifierSchema,
  path: localProjectControlAbsolutePathSchema,
  isDefault: z.boolean(),
  status: z.enum(["available", "missing"]),
});

const localProjectControlDiscoveryBaseShape = {
  candidates: z.array(localProjectControlCandidateSchema),
  connections: z.array(localProjectControlConnectionSchema),
  projectId: boundedIdentifierSchema,
};

export const localProjectControlProjectDiscoverySchema = z
  .discriminatedUnion("status", [
    z.strictObject({
      ...localProjectControlDiscoveryBaseShape,
      connections: z.array(localProjectControlConnectionSchema).min(1),
      status: z.literal("connected"),
    }),
    z.strictObject({
      ...localProjectControlDiscoveryBaseShape,
      connections: z.array(localProjectControlConnectionSchema).min(1),
      status: z.literal("connected_folder_missing"),
    }),
    z.strictObject({
      ...localProjectControlDiscoveryBaseShape,
      candidates: z.array(localProjectControlCandidateSchema).min(1),
      connections: z.array(localProjectControlConnectionSchema).max(0),
      status: z.literal("found"),
    }),
    z.strictObject({
      ...localProjectControlDiscoveryBaseShape,
      candidates: z.array(localProjectControlCandidateSchema).max(0),
      connections: z.array(localProjectControlConnectionSchema).max(0),
      status: z.literal("not_found"),
    }),
    z.strictObject({
      ...localProjectControlDiscoveryBaseShape,
      candidates: z.array(localProjectControlCandidateSchema).max(0),
      connections: z.array(localProjectControlConnectionSchema).max(0),
      status: z.literal("verification_unavailable"),
    }),
  ])
  .superRefine((project, context) => {
    if (
      project.status !== "connected" &&
      project.status !== "connected_folder_missing"
    ) {
      return;
    }
    const defaults = project.connections.filter(
      (connection) => connection.isDefault
    );
    if (defaults.length !== 1) {
      context.addIssue({
        code: "custom",
        message:
          "A connected Project must have exactly one default connection.",
        path: ["connections"],
      });
      return;
    }
    const expectedDefaultStatus =
      project.status === "connected" ? "available" : "missing";
    if (defaults[0]?.status !== expectedDefaultStatus) {
      context.addIssue({
        code: "custom",
        message: `The default connection must be ${expectedDefaultStatus} for ${project.status}.`,
        path: ["connections"],
      });
    }
  });

export const localProjectControlDiscoverProjectsRequestSchema = z.strictObject({
  expectedOrganizationId: boundedIdentifierSchema,
  clientGeneration: clientGenerationSchema,
  projectIds: z.array(boundedIdentifierSchema).min(1).max(500).optional(),
});

export const localProjectControlCanonicalProjectSchema = z.strictObject({
  projectId: boundedIdentifierSchema,
  repositoryFingerprint: repositoryFingerprintSchema.nullable(),
});

export const localProjectControlDiscoverProjectsDaemonRequestSchema =
  z.strictObject({
    expectedOrganizationId: boundedIdentifierSchema,
    clientGeneration: clientGenerationSchema,
    projects: z.array(localProjectControlCanonicalProjectSchema).max(500),
  });

export const localProjectControlDiscoverProjectsResponseSchema = z.strictObject(
  {
    requestId: boundedIdentifierSchema,
    clientGeneration: clientGenerationSchema,
    deviceId: boundedIdentifierSchema,
    checkedAtMs: z.number().int().nonnegative(),
    gitStatus: localProjectControlGitStatusSchema,
    projects: z.array(localProjectControlProjectDiscoverySchema).max(500),
  }
);

const localProjectControlConnectBaseShape = {
  expectedOrganizationId: boundedIdentifierSchema,
  projectId: boundedIdentifierSchema,
  clientGeneration: clientGenerationSchema,
  idempotencyKey: boundedIdentifierSchema,
  moveConfirmationToken: boundedIdentifierSchema.optional(),
};

export const localProjectControlConnectCandidateRequestSchema = z.strictObject({
  ...localProjectControlConnectBaseShape,
  candidateId: boundedIdentifierSchema,
  candidatePath: localProjectControlAbsolutePathSchema,
});

export const localProjectControlConnectDeclaredPathRequestSchema =
  z.strictObject({
    ...localProjectControlConnectBaseShape,
    confirmNonGit: z.boolean().optional(),
    declaredPath: localProjectControlAbsolutePathSchema,
  });

const localProjectControlCanonicalConnectShape = {
  projectSlug: projectSlugSchema,
  repositoryFingerprint: repositoryFingerprintSchema.nullable(),
};

export const localProjectControlConnectCandidateDaemonRequestSchema =
  z.strictObject({
    ...localProjectControlConnectBaseShape,
    ...localProjectControlCanonicalConnectShape,
    candidateId: boundedIdentifierSchema,
    candidatePath: localProjectControlAbsolutePathSchema,
  });

export const localProjectControlConnectDeclaredPathDaemonRequestSchema =
  z.strictObject({
    ...localProjectControlConnectBaseShape,
    ...localProjectControlCanonicalConnectShape,
    confirmNonGit: z.boolean().optional(),
    declaredPath: localProjectControlAbsolutePathSchema,
  });

export const localProjectControlConnectResponseSchema = z.strictObject({
  status: z.enum(["connected", "unchanged"]),
  bindingGeneration: boundedIdentifierSchema,
  isDefault: z.boolean(),
  canonicalPath: localProjectControlAbsolutePathSchema,
});

export const localProjectControlExpectedBindingGenerationSchema =
  boundedIdentifierSchema;

const localProjectControlMutationBaseShape = {
  expectedOrganizationId: boundedIdentifierSchema,
  projectId: boundedIdentifierSchema,
  clientGeneration: clientGenerationSchema,
  idempotencyKey: boundedIdentifierSchema,
};

export const localProjectControlSetDefaultConnectionRequestSchema =
  z.strictObject({
    ...localProjectControlMutationBaseShape,
    targetBindingGeneration: boundedIdentifierSchema,
  });

export const localProjectControlSetDefaultConnectionResponseSchema =
  z.strictObject({
    status: z.enum(["updated", "unchanged"]),
    connections: z.array(localProjectControlConnectionSchema),
  });

export const localProjectControlRemoveConnectionRequestSchema = z.strictObject({
  ...localProjectControlMutationBaseShape,
  bindingGeneration: boundedIdentifierSchema,
  replacementBindingGeneration: boundedIdentifierSchema.optional(),
});

export const localProjectControlRemoveConnectionResponseSchema = z.strictObject(
  {
    status: z.enum(["removed", "unchanged"]),
    connections: z.array(localProjectControlConnectionSchema),
  }
);

export const localProjectControlRemoveMissingConnectionsRequestSchema =
  z.strictObject(localProjectControlMutationBaseShape);

export const localProjectControlRemoveMissingConnectionsResponseSchema =
  z.strictObject({
    removedCount: z.number().int().nonnegative(),
    connections: z.array(localProjectControlConnectionSchema),
  });

export const localProjectControlDiscoverProjectsRpcInputSchema =
  localProjectControlDiscoverProjectsRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const localProjectControlConnectCandidateRpcInputSchema =
  localProjectControlConnectCandidateRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const localProjectControlConnectDeclaredPathRpcInputSchema =
  localProjectControlConnectDeclaredPathRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const localProjectControlSetDefaultConnectionRpcInputSchema =
  localProjectControlSetDefaultConnectionRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const localProjectControlRemoveConnectionRpcInputSchema =
  localProjectControlRemoveConnectionRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });
export const localProjectControlRemoveMissingConnectionsRpcInputSchema =
  localProjectControlRemoveMissingConnectionsRequestSchema.extend({
    context: openMeldRequestContextSchema,
  });

export const localProjectControlErrorCodeSchema = z.enum([
  "invalid_request",
  "invalid_response",
  "path_not_found",
  "path_not_directory",
  "path_unreadable",
  "path_conflict",
  "fingerprint_mismatch",
  "git_repository_required",
  "needs_confirmation",
  "git_unavailable",
  "command_line_tools_missing",
  "candidate_unavailable",
  "binding_not_found",
  "binding_generation_stale",
  "replacement_required",
  "replacement_invalid",
  "default_missing_requires_replacement",
  "service_offline",
  "service_update_required",
  "timeout",
  "unsupported",
  "internal_error",
]);

const localProjectControlNonConflictErrorCodeSchema =
  localProjectControlErrorCodeSchema.exclude(["path_conflict"]);

export const localProjectControlPathConflictResponseSchema = z.strictObject({
  status: z.literal("rejected"),
  code: z.literal("path_conflict"),
  message: z.string().trim().min(1).max(1024),
  conflictingProjectSlug: projectSlugSchema,
  conflictScope: z.enum(["same_organization", "another_organization"]),
  moveConfirmationToken: boundedIdentifierSchema,
  moveImpact: z.enum([
    "additional_connection",
    "default_connection",
    "only_connection",
  ]),
});

const localProjectControlLegacyPathConflictResponseSchema = z.strictObject({
  status: z.literal("rejected"),
  code: z.literal("path_conflict"),
  message: z.string().trim().min(1).max(1024),
  conflictingProjectSlug: projectSlugSchema,
});

export const localProjectControlErrorResponseSchema = z.union([
  localProjectControlPathConflictResponseSchema,
  localProjectControlLegacyPathConflictResponseSchema,
  z.strictObject({
    status: z.literal("rejected"),
    code: localProjectControlNonConflictErrorCodeSchema,
    message: z.string().trim().min(1).max(1024),
  }),
]);

export const localProjectControlDiscoverProjectsResultSchema = z.union([
  localProjectControlDiscoverProjectsResponseSchema,
  localProjectControlErrorResponseSchema,
]);
export const localProjectControlConnectResultSchema = z.union([
  localProjectControlConnectResponseSchema,
  localProjectControlErrorResponseSchema,
]);
export const localProjectControlConnectOutcomeSchema = z.union([
  localProjectControlConnectResponseSchema,
  localProjectControlPathConflictResponseSchema,
]);
export const localProjectControlSetDefaultConnectionResultSchema = z.union([
  localProjectControlSetDefaultConnectionResponseSchema,
  localProjectControlErrorResponseSchema,
]);
export const localProjectControlRemoveConnectionResultSchema = z.union([
  localProjectControlRemoveConnectionResponseSchema,
  localProjectControlErrorResponseSchema,
]);
export const localProjectControlRemoveMissingConnectionsResultSchema = z.union([
  localProjectControlRemoveMissingConnectionsResponseSchema,
  localProjectControlErrorResponseSchema,
]);

const LOCAL_PROJECT_CONTROL_FRAME_VERSION = 1 as const;

function defineRequestFrame<TCode extends string, TRequest extends zod.ZodType>(
  code: TCode,
  request: TRequest
) {
  return z.strictObject({
    v: z.literal(LOCAL_PROJECT_CONTROL_FRAME_VERSION),
    code: z.literal(code),
    payload: z.strictObject({
      requestId: boundedIdentifierSchema,
      request,
    }),
  });
}

function defineResultFrame<TCode extends string, TResult extends zod.ZodType>(
  code: TCode,
  result: TResult
) {
  return z.strictObject({
    v: z.literal(LOCAL_PROJECT_CONTROL_FRAME_VERSION),
    code: z.literal(code),
    payload: z.strictObject({
      requestId: boundedIdentifierSchema,
      result,
    }),
  });
}

export const localProjectControlDiscoverProjectsRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.discover_projects",
    localProjectControlDiscoverProjectsDaemonRequestSchema
  );
export const localProjectControlDiscoverProjectsResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.discover_projects_result",
    localProjectControlDiscoverProjectsResultSchema
  );
export const localProjectControlConnectCandidateRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.connect_candidate",
    localProjectControlConnectCandidateDaemonRequestSchema
  );
export const localProjectControlConnectCandidateResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.connect_candidate_result",
    localProjectControlConnectResultSchema
  );
export const localProjectControlConnectDeclaredPathRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.connect_declared_path",
    localProjectControlConnectDeclaredPathDaemonRequestSchema
  );
export const localProjectControlConnectDeclaredPathResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.connect_declared_path_result",
    localProjectControlConnectResultSchema
  );
export const localProjectControlSetDefaultConnectionRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.set_default_connection",
    localProjectControlSetDefaultConnectionRequestSchema
  );
export const localProjectControlSetDefaultConnectionResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.set_default_connection_result",
    localProjectControlSetDefaultConnectionResultSchema
  );
export const localProjectControlRemoveConnectionRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.remove_connection",
    localProjectControlRemoveConnectionRequestSchema
  );
export const localProjectControlRemoveConnectionResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.remove_connection_result",
    localProjectControlRemoveConnectionResultSchema
  );
export const localProjectControlRemoveMissingConnectionsRequestFrameSchema =
  defineRequestFrame(
    "daemon.local_project_control.remove_missing_connections",
    localProjectControlRemoveMissingConnectionsRequestSchema
  );
export const localProjectControlRemoveMissingConnectionsResultFrameSchema =
  defineResultFrame(
    "daemon.local_project_control.remove_missing_connections_result",
    localProjectControlRemoveMissingConnectionsResultSchema
  );

export const localProjectControlDaemonFrameSchema = z.discriminatedUnion(
  "code",
  [
    localProjectControlDiscoverProjectsRequestFrameSchema,
    localProjectControlDiscoverProjectsResultFrameSchema,
    localProjectControlConnectCandidateRequestFrameSchema,
    localProjectControlConnectCandidateResultFrameSchema,
    localProjectControlConnectDeclaredPathRequestFrameSchema,
    localProjectControlConnectDeclaredPathResultFrameSchema,
    localProjectControlSetDefaultConnectionRequestFrameSchema,
    localProjectControlSetDefaultConnectionResultFrameSchema,
    localProjectControlRemoveConnectionRequestFrameSchema,
    localProjectControlRemoveConnectionResultFrameSchema,
    localProjectControlRemoveMissingConnectionsRequestFrameSchema,
    localProjectControlRemoveMissingConnectionsResultFrameSchema,
  ]
);

const runtimeTransportLocalProjectControlTargetShape = {
  v: z.literal(LOCAL_PROJECT_CONTROL_FRAME_VERSION),
  ownerUserId: boundedIdentifierSchema,
  deviceId: boundedIdentifierSchema,
  lane: daemonServiceLaneSchema,
  requestId: boundedIdentifierSchema,
};

export const runtimeTransportLocalProjectControlDiscoverProjectsRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlDiscoverProjectsDaemonRequestSchema,
  });
export const runtimeTransportLocalProjectControlConnectCandidateRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlConnectCandidateDaemonRequestSchema,
  });
export const runtimeTransportLocalProjectControlConnectDeclaredPathRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlConnectDeclaredPathDaemonRequestSchema,
  });
export const runtimeTransportLocalProjectControlSetDefaultConnectionRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlSetDefaultConnectionRequestSchema,
  });
export const runtimeTransportLocalProjectControlRemoveConnectionRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlRemoveConnectionRequestSchema,
  });
export const runtimeTransportLocalProjectControlRemoveMissingConnectionsRequestSchema =
  z.strictObject({
    ...runtimeTransportLocalProjectControlTargetShape,
    request: localProjectControlRemoveMissingConnectionsRequestSchema,
  });
