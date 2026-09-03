import type * as zod from "zod/v4";
import * as z from "../../lazy-zod";
import { agentControllerCollaborationModeSchema } from "../agent-controller-collaboration-mode";
import { agentControllerPermissionModeSchema } from "../agent-controller-permission-mode";
import { openCodePermissionConfigSchema } from "../open-code-permission";
import {
  agentActivityNativeSessionIdSchema,
  localAgentSessionProviderSchema,
} from "./agent-activity-sessions";

const boundedIdentifierSchema = z.string().trim().min(1).max(256);
const reasonCodeSchema = z.string().trim().min(1).max(256);

export const agentProfileBindingRouteParamsSchema = z.strictObject({
  agentProfileId: boundedIdentifierSchema,
});

export const currentAgentProfileSessionLookupQuerySchema = z.strictObject({
  agentControllerConversationId: agentActivityNativeSessionIdSchema,
  agentControllerRef: boundedIdentifierSchema,
});

const currentAgentProfileSessionLookupIdentitySchema = z.strictObject({
  profileId: boundedIdentifierSchema,
  profileName: boundedIdentifierSchema,
  profileOrganizationId: boundedIdentifierSchema,
});

export const currentAgentProfileSessionLookupResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      currentOrganizationId: boundedIdentifierSchema,
      status: z.literal("not_found"),
    }),
    z.strictObject({
      currentOrganizationId: boundedIdentifierSchema,
      profile: currentAgentProfileSessionLookupIdentitySchema,
      sameOrganization: z.boolean(),
      status: z.literal("found"),
    }),
    z.strictObject({
      currentOrganizationId: boundedIdentifierSchema,
      reasonCode: reasonCodeSchema,
      status: z.literal("unavailable"),
    }),
  ]);

export const getAgentProfileControllerChangeEligibilityResponseSchema =
  z.discriminatedUnion("status", [
    z.strictObject({
      agentProfileId: boundedIdentifierSchema,
      reasonCode: z.literal("agent_profile_binding.controller_change_allowed"),
      status: z.literal("allowed"),
    }),
    z.strictObject({
      agentProfileId: boundedIdentifierSchema,
      reasonCode: z.literal(
        "agent_profile_binding.controller_change_blocked_active_execution"
      ),
      status: z.literal("blocked"),
    }),
    z.strictObject({
      agentProfileId: boundedIdentifierSchema,
      reasonCode: reasonCodeSchema,
      status: z.literal("unavailable"),
    }),
  ]);

export const agentProfileBindingRuntimeIdSchema = z.strictObject({
  source: z.literal("runtime_registry_authority"),
  value: z.string().trim().min(1).max(512),
});

export const agentProfileBindingModelSelectionSchema = z.strictObject({
  modelId: boundedIdentifierSchema,
  reasoningLevel: boundedIdentifierSchema.optional(),
});

export const agentProfileBindingAgentControllerPermissionModeSchema =
  agentControllerPermissionModeSchema;
export const agentProfileBindingAgentControllerCollaborationModeSchema =
  agentControllerCollaborationModeSchema;
export const agentProfileBindingOpenCodePermissionSchema =
  openCodePermissionConfigSchema;

export const agentProfileBindingWriteModeSchema = z.enum([
  "ensure",
  "reconnect",
]);

export const agentProfileBindingSessionInventorySelectionSchema =
  z.strictObject({
    computerId: boundedIdentifierSchema,
    nativeSessionId: agentActivityNativeSessionIdSchema,
    organizationId: boundedIdentifierSchema,
    ownerUserId: boundedIdentifierSchema,
    projectId: boundedIdentifierSchema,
    provider: localAgentSessionProviderSchema,
  });

export const ensureAgentProfilePrimaryBindingBodySchema = z
  .strictObject({
    agentControllerRef: boundedIdentifierSchema,
    agentControllerConversationId:
      agentActivityNativeSessionIdSchema.optional(),
    deviceId: boundedIdentifierSchema,
    lane: boundedIdentifierSchema,
    openMeldServiceRuntimeId: agentProfileBindingRuntimeIdSchema,
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema.optional(),
    modelId: boundedIdentifierSchema.optional(),
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
    reasoningLevel: boundedIdentifierSchema.optional(),
    sessionInventorySelection:
      agentProfileBindingSessionInventorySelectionSchema.optional(),
    writeMode: agentProfileBindingWriteModeSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.reasoningLevel && !value.modelId) {
      context.addIssue({
        code: "custom",
        message: "reasoningLevel requires modelId",
        path: ["reasoningLevel"],
      });
    }
    if (
      value.sessionInventorySelection &&
      value.agentControllerConversationId !==
        value.sessionInventorySelection.nativeSessionId
    ) {
      context.addIssue({
        code: "custom",
        message:
          "sessionInventorySelection requires the matching agentControllerConversationId",
        path: ["sessionInventorySelection", "nativeSessionId"],
      });
    }
  });

export const updateAgentProfilePrimaryBindingModelSelectionBodySchema = z
  .strictObject({
    modelId: boundedIdentifierSchema,
    reasoningLevel: boundedIdentifierSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.reasoningLevel && !value.modelId) {
      context.addIssue({
        code: "custom",
        message: "reasoningLevel requires modelId",
        path: ["reasoningLevel"],
      });
    }
  });

export const updateAgentProfilePrimaryBindingAgentControllerPermissionModeBodySchema =
  z.strictObject({
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema,
  });

export const updateAgentProfilePrimaryBindingAgentControllerCollaborationModeBodySchema =
  z.strictObject({
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema,
  });

export const updateAgentProfilePrimaryBindingOpenCodePermissionBodySchema =
  z.strictObject({
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.nullable(),
  });

const agentProfileCreationDefaultsFields = {
  agentControllerCollaborationMode:
    agentControllerCollaborationModeSchema.nullable(),
  agentControllerPermissionMode: agentControllerPermissionModeSchema.nullable(),
  defaultProjectId: boundedIdentifierSchema.nullable(),
  modelId: boundedIdentifierSchema.nullable(),
  openCodePermission: openCodePermissionConfigSchema.nullable(),
  reasoningLevel: boundedIdentifierSchema.nullable(),
};

function requireCreationDefaultsModelForReasoning(
  value: { modelId: string | null; reasoningLevel: string | null },
  context: zod.RefinementCtx
): void {
  if (value.reasoningLevel && !value.modelId) {
    context.addIssue({
      code: "custom",
      message: "reasoningLevel requires modelId",
      path: ["reasoningLevel"],
    });
  }
}

export const agentProfileCreationPreferenceSelectionSchema = z
  .strictObject(agentProfileCreationDefaultsFields)
  .superRefine(requireCreationDefaultsModelForReasoning);

export const setAgentProfileCreationDefaultsBodySchema = z
  .strictObject({
    ...agentProfileCreationDefaultsFields,
    agentControllerCollaborationMode: agentControllerCollaborationModeSchema
      .nullable()
      .optional(),
  })
  .superRefine(requireCreationDefaultsModelForReasoning);

export const agentProfileCreationDefaultsSchema = z
  .strictObject({
    ...agentProfileCreationDefaultsFields,
    agentControllerRef: boundedIdentifierSchema,
    organizationId: boundedIdentifierSchema,
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
    userId: boundedIdentifierSchema,
  })
  .superRefine(requireCreationDefaultsModelForReasoning);

export const getAgentProfileCreationDefaultsResponseSchema =
  agentProfileCreationDefaultsSchema;

export const setAgentProfileCreationDefaultsResponseSchema =
  agentProfileCreationDefaultsSchema;

export const listAgentProfileCreationDefaultsResponseSchema = z.strictObject({
  defaults: z.array(agentProfileCreationDefaultsSchema).max(100),
  organizationId: boundedIdentifierSchema,
  userId: boundedIdentifierSchema,
});

export const disableAgentProfilePrimaryBindingResponseSchema = z.strictObject({
  agentProfileId: boundedIdentifierSchema,
  disabled: z.boolean(),
  reasonCodes: z.array(reasonCodeSchema),
  status: z.enum(["disabled", "missing", "unavailable"]),
});

export const notifyAgentProfileRouteCatalogChangedBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(100).optional(),
});

export const notifyAgentProfilesRouteCatalogChangedBodySchema = z.strictObject({
  agentProfileIds: z.array(boundedIdentifierSchema).min(1).max(100),
  reason: z.string().trim().min(1).max(100).optional(),
});

export const notifyAgentProfileRouteCatalogChangedResponseSchema =
  z.strictObject({
    ok: z.boolean(),
    notifiedSessions: z.number().int().nonnegative(),
  });

export const agentProfileBindingStateSchema = z.enum([
  "missing",
  "enabled_primary",
  "disabled_historical",
  "conflict",
  "owner_mismatch",
]);

export const agentProfileBindingResolutionSourceSchema = z.enum([
  "binding_truth",
  "missing_projection",
  "conflict_evidence",
]);

export const agentProfileBindingAuthoritySourceSchema = z.enum([
  "binding_truth",
  "none",
  "blocked",
]);

export const agentProfileBindingAgentControllerReportSchema = z.strictObject({
  agentControllerRef: boundedIdentifierSchema,
  agentControllerConversationId: boundedIdentifierSchema.optional(),
  openMeldServiceRuntimeId: agentProfileBindingRuntimeIdSchema,
});

export const agentProfileBindingDispatchEligibilitySchema = z.strictObject({
  reasonCodes: z.array(reasonCodeSchema),
  routable: z.boolean(),
  status: z.enum(["routable", "not_routable"]),
});

export const agentProfileBindingProjectionSchema = z
  .strictObject({
    agentProfileId: boundedIdentifierSchema,
    authoritySource: agentProfileBindingAuthoritySourceSchema,
    bindingId: boundedIdentifierSchema.optional(),
    bindingState: agentProfileBindingStateSchema,
    dispatchEligibility: agentProfileBindingDispatchEligibilitySchema,
    grantsClaimSuccess: z.literal(false),
    agentControllerCollaborationMode:
      agentProfileBindingAgentControllerCollaborationModeSchema.optional(),
    agentControllerPermissionMode:
      agentProfileBindingAgentControllerPermissionModeSchema.optional(),
    modelSelection: agentProfileBindingModelSelectionSchema.optional(),
    openCodePermission: agentProfileBindingOpenCodePermissionSchema.optional(),
    reasonCodes: z.array(reasonCodeSchema),
    resolutionSource: agentProfileBindingResolutionSourceSchema,
    routable: z.boolean(),
    executionTarget: agentProfileBindingAgentControllerReportSchema.nullable(),
  })
  .superRefine(validateAgentProfileBindingProjection);

export const getAgentProfilePrimaryBindingResponseSchema = z
  .strictObject({
    binding: agentProfileBindingProjectionSchema,
    grantsClaimSuccess: z.literal(false),
    status: z.enum(["found", "missing", "unavailable"]),
  })
  .superRefine((value, context) => {
    if (value.binding.bindingState !== "missing") {
      if (value.status !== "found") {
        context.addIssue({
          code: "custom",
          message: "Binding read status must match Binding projection",
          path: ["status"],
        });
      }
      return;
    }

    if (value.status === "found") {
      context.addIssue({
        code: "custom",
        message: "Binding read status must match Binding projection",
        path: ["status"],
      });
      return;
    }

    const unavailable = hasUnavailableBindingReadReason(
      value.binding.reasonCodes
    );
    if (value.status === "unavailable" && !unavailable) {
      context.addIssue({
        code: "custom",
        message: "unavailable Binding read requires unavailable reason code",
        path: ["binding", "reasonCodes"],
      });
    }
    if (value.status === "missing" && unavailable) {
      context.addIssue({
        code: "custom",
        message: "unavailable Binding read cannot be reported as missing",
        path: ["status"],
      });
    }
  });

export const ensureAgentProfilePrimaryBindingResponseSchema = z
  .strictObject({
    binding: agentProfileBindingProjectionSchema.optional(),
    grantsClaimSuccess: z.literal(false),
    outcome: z.enum(["created", "reused", "reconnected"]).optional(),
    reasonCodes: z.array(reasonCodeSchema),
    routable: z.boolean(),
    status: z.enum(["accepted", "rejected"]),
  })
  .superRefine((value, context) => {
    if (value.status === "accepted") {
      if (!value.binding) {
        context.addIssue({
          code: "custom",
          message: "accepted Binding command response requires Binding truth",
          path: ["binding"],
        });
      }
      if (!value.outcome) {
        context.addIssue({
          code: "custom",
          message: "accepted Binding command response requires an outcome",
          path: ["outcome"],
        });
      }
      if (!value.routable) {
        context.addIssue({
          code: "custom",
          message: "accepted Binding command response must be routable",
          path: ["routable"],
        });
      }
      if (value.binding) {
        requireAcceptedBindingCommandProjection(value.binding, context);
      }
      return;
    }

    if (value.outcome) {
      context.addIssue({
        code: "custom",
        message: "rejected Binding command response cannot include outcome",
        path: ["outcome"],
      });
    }
    if (value.routable) {
      context.addIssue({
        code: "custom",
        message: "rejected Binding command response cannot be routable",
        path: ["routable"],
      });
    }
  });

function validateAgentProfileBindingProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  validateBindingDispatchEligibility(value, context);
  bindingProjectionValidators[value.bindingState](value, context);
}

const bindingProjectionValidators = {
  conflict: validateConflictProjection,
  disabled_historical: validateDisabledHistoricalProjection,
  enabled_primary: validateEnabledPrimaryProjection,
  missing: validateMissingProjection,
  owner_mismatch: validateOwnerMismatchProjection,
} satisfies Record<
  zod.infer<typeof agentProfileBindingStateSchema>,
  (
    value: zod.infer<typeof agentProfileBindingProjectionSchema>,
    context: zod.RefinementCtx
  ) => void
>;

function validateBindingDispatchEligibility(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.dispatchEligibility.routable !== value.routable) {
    context.addIssue({
      code: "custom",
      message: "Binding routable fields must agree",
      path: ["dispatchEligibility", "routable"],
    });
  }
  if (
    value.dispatchEligibility.status !==
    (value.routable ? "routable" : "not_routable")
  ) {
    context.addIssue({
      code: "custom",
      message: "Binding dispatch status must match routable state",
      path: ["dispatchEligibility", "status"],
    });
  }
}

function validateEnabledPrimaryProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  requireBindingTruthProjection(value, context);
  if (!value.routable) {
    context.addIssue({
      code: "custom",
      message: "enabled primary Binding must be routable",
      path: ["routable"],
    });
  }
}

function validateDisabledHistoricalProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  requireBindingTruthProjection(value, context);
  if (value.routable) {
    context.addIssue({
      code: "custom",
      message: "disabled historical Binding cannot be routable",
      path: ["routable"],
    });
  }
}

function validateMissingProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.authoritySource !== "none") {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection cannot have authority source",
      path: ["authoritySource"],
    });
  }
  if (value.resolutionSource !== "missing_projection") {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection requires missing source",
      path: ["resolutionSource"],
    });
  }
  rejectMissingProjectionEvidence(value, context);
}

function rejectMissingProjectionEvidence(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.bindingId) {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection cannot include bindingId",
      path: ["bindingId"],
    });
  }
  if (value.executionTarget) {
    context.addIssue({
      code: "custom",
      message:
        "missing Binding projection cannot include Agent Controller availability",
      path: ["executionTarget"],
    });
  }
  if (value.modelSelection) {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection cannot include model selection",
      path: ["modelSelection"],
    });
  }
  if (value.openCodePermission) {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection cannot include OpenCode permissions",
      path: ["openCodePermission"],
    });
  }
  if (value.agentControllerPermissionMode) {
    context.addIssue({
      code: "custom",
      message:
        "missing Binding projection cannot include Agent Controller Permission Mode",
      path: ["agentControllerPermissionMode"],
    });
  }
  if (value.agentControllerCollaborationMode) {
    context.addIssue({
      code: "custom",
      message:
        "missing Binding projection cannot include Agent Controller Collaboration Mode",
      path: ["agentControllerCollaborationMode"],
    });
  }
  if (value.routable) {
    context.addIssue({
      code: "custom",
      message: "missing Binding projection cannot be routable",
      path: ["routable"],
    });
  }
}

function validateConflictProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.authoritySource !== "blocked") {
    context.addIssue({
      code: "custom",
      message: "conflict Binding projection must be blocked",
      path: ["authoritySource"],
    });
  }
  if (value.resolutionSource !== "conflict_evidence") {
    context.addIssue({
      code: "custom",
      message: "conflict Binding projection requires conflict evidence",
      path: ["resolutionSource"],
    });
  }
  if (value.routable) {
    context.addIssue({
      code: "custom",
      message: "conflict Binding projection cannot be routable",
      path: ["routable"],
    });
  }
}

function validateOwnerMismatchProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.authoritySource !== "blocked") {
    context.addIssue({
      code: "custom",
      message: "owner mismatch Binding projection must be blocked",
      path: ["authoritySource"],
    });
  }
  if (value.routable) {
    context.addIssue({
      code: "custom",
      message: "owner mismatch Binding projection cannot be routable",
      path: ["routable"],
    });
  }
}

function requireBindingTruthProjection(
  value: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (value.authoritySource !== "binding_truth") {
    context.addIssue({
      code: "custom",
      message: "Binding truth projection requires binding authority",
      path: ["authoritySource"],
    });
  }
  if (value.resolutionSource !== "binding_truth") {
    context.addIssue({
      code: "custom",
      message: "Binding truth projection requires binding resolution source",
      path: ["resolutionSource"],
    });
  }
  if (!value.bindingId) {
    context.addIssue({
      code: "custom",
      message: "Binding truth projection requires bindingId",
      path: ["bindingId"],
    });
  }
  if (!value.executionTarget) {
    context.addIssue({
      code: "custom",
      message:
        "Binding truth projection requires Agent Controller availability",
      path: ["executionTarget"],
    });
  }
}

function requireAcceptedBindingCommandProjection(
  binding: zod.infer<typeof agentProfileBindingProjectionSchema>,
  context: zod.RefinementCtx
): void {
  if (binding.bindingState !== "enabled_primary") {
    context.addIssue({
      code: "custom",
      message:
        "accepted Binding command response requires enabled primary truth",
      path: ["binding", "bindingState"],
    });
  }
  if (binding.authoritySource !== "binding_truth") {
    context.addIssue({
      code: "custom",
      message: "accepted Binding command response requires Binding authority",
      path: ["binding", "authoritySource"],
    });
  }
  if (binding.resolutionSource !== "binding_truth") {
    context.addIssue({
      code: "custom",
      message:
        "accepted Binding command response requires Binding truth source",
      path: ["binding", "resolutionSource"],
    });
  }
  if (!binding.bindingId) {
    context.addIssue({
      code: "custom",
      message: "accepted Binding command response requires bindingId",
      path: ["binding", "bindingId"],
    });
  }
  if (!binding.executionTarget) {
    context.addIssue({
      code: "custom",
      message:
        "accepted Binding command response requires Agent Controller availability",
      path: ["binding", "executionTarget"],
    });
  }
  if (!(binding.routable && binding.dispatchEligibility.routable)) {
    context.addIssue({
      code: "custom",
      message:
        "accepted Binding command response requires routable Binding truth",
      path: ["binding", "routable"],
    });
  }
  if (binding.dispatchEligibility.status !== "routable") {
    context.addIssue({
      code: "custom",
      message: "accepted Binding command response requires routable status",
      path: ["binding", "dispatchEligibility", "status"],
    });
  }
}

function hasUnavailableBindingReadReason(
  reasonCodes: readonly string[]
): boolean {
  return reasonCodes.some(
    (reasonCode) =>
      reasonCode === "agent_profile_binding.lookup_failed" ||
      reasonCode === "agent_profile_binding.owner_mismatch" ||
      reasonCode === "agent_profile_binding.profile_owner_invalid" ||
      reasonCode === "agent_profile_binding.profile_owner_unavailable" ||
      reasonCode === "agent_profile_binding.read_unavailable" ||
      reasonCode === "agent_profile_binding.store_unavailable"
  );
}
