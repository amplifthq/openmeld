import {
  ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_CENTER_AGENT_ONLY_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER,
  ORGANIZATION_PROFILE_DIRECTORY_INCLUDE_MODEL_SELECTION_QUERY_PARAMETER,
} from "@openmeld/gateway-contract";
import {
  agentProfileCreationRequestMutationResponseSchema,
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
  createAgentProfileCreationRequestBodySchema,
  createAgentProfileCreationRequestResponseSchema,
  decideAgentProfileCreationRequestBodySchema,
  feedbackReportingPolicyResponseSchema,
  getAgentProfileCreationApprovalPreferenceResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  listAgentProfileCreationRequestsResponseSchema,
  organizationAgentRuntimeOverviewResponseSchema,
  organizationComputersResponseSchema,
  organizationDirectoryResponseSchema,
  organizationInformationProtectionPolicyResponseSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
  organizationMemberPresenceBodySchema,
  organizationMemberPresenceResponseSchema,
  organizationMemberPresenceWriteResponseSchema,
  organizationMemberWebActivityResponseSchema,
  organizationProfileDirectoryResponseSchema,
  organizationSpaceDirectoryQuerySchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  retryAgentProfileCreationRequestBodySchema,
  setAgentProfileCreationApprovalPreferenceBodySchema,
  setAgentProfileCreationApprovalPreferenceResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
  setAgentProfileCreationDefaultsResponseSchema,
  updateCenterAgentOrganizationMemoryPolicyBodySchema,
  updateFeedbackReportingPolicyBodySchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
} from "@openmeld/schemas";
import type {
  OrganizationDirectoryResponse,
  OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const CURRENT_ORGANIZATION_DIRECTORY_ROUTE =
  "/v1/organizations/current/directory";
const CURRENT_ORGANIZATION_PROFILE_DIRECTORY_ROUTE =
  "/v1/organizations/current/profile-directory";
const CURRENT_ORGANIZATION_AGENT_RUNTIME_OVERVIEW_ROUTE =
  "/v1/organizations/current/agent-runtime-overview";
const CURRENT_ORGANIZATION_COMPUTERS_ROUTE =
  "/v1/organizations/current/computers";
const CURRENT_ORGANIZATION_MEMBER_OPENMELD_SERVICE_STATUSES_ROUTE =
  "/v1/organizations/current/member-openmeld-service-statuses";
const CURRENT_ORGANIZATION_MEMBER_WEB_ACTIVITY_ROUTE =
  "/v1/organizations/current/member-activity/web";
const CURRENT_ORGANIZATION_SPACES_ROUTE = "/v1/organizations/current/spaces";
const CURRENT_ORGANIZATION_SPACES_WITH_MEMBER_COUNTS_ROUTE =
  "/v1/organizations/current/spaces-with-member-counts";
const CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE =
  "/v1/organizations/current/center-agent-memory/organization-policy";
const CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_WIPE_SELF_ROUTE =
  "/v1/organizations/current/center-agent-memory/wipe-self";
const CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE =
  "/v1/organizations/current/information-protection";
const CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE =
  "/v1/organizations/current/feedback-reporting-policy";
const AGENT_PROFILE_CREATION_DEFAULTS_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-defaults/:agentControllerRef";
const AGENT_PROFILE_CREATION_REQUESTS_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-requests";
const AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-requests/:requestId/decision";
const AGENT_PROFILE_CREATION_REQUEST_CANCEL_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-requests/:requestId/cancel";
const AGENT_PROFILE_CREATION_REQUEST_RETRY_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-requests/:requestId/retry";
const AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-approval-preference";

export function registerOrganizationRoutes(app: Hono<HonoBindings>): void {
  app.post(AGENT_PROFILE_CREATION_REQUESTS_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId is required",
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: bodyResult.message,
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
      });
    }
    const body = createAgentProfileCreationRequestBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Agent Profile creation request payload.",
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createAgentProfileCreationRequest({
          ...body.data,
          context: buildCoreRpcContext(c),
          organizationId,
        }),
      method: "POST",
      responseSchema: createAgentProfileCreationRequestResponseSchema,
      route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
    });
  });

  app.get(AGENT_PROFILE_CREATION_REQUESTS_ROUTE, (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId is required",
        method: "GET",
        route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listAgentProfileCreationRequests({
          context: buildCoreRpcContext(c),
          organizationId,
          ...(c.req.query("requestId")
            ? { requestId: c.req.query("requestId") }
            : {}),
          ...(c.req.query("idempotencyKey")
            ? { idempotencyKey: c.req.query("idempotencyKey") }
            : {}),
        }),
      method: "GET",
      responseSchema: listAgentProfileCreationRequestsResponseSchema,
      route: AGENT_PROFILE_CREATION_REQUESTS_ROUTE,
    });
  });

  app.post(AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE, async (c) => {
    const identifiers = readCreationRequestIdentifiers(c);
    if (!identifiers) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId and requestId are required",
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: bodyResult.message,
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE,
      });
    }
    const body = decideAgentProfileCreationRequestBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Agent Profile creation request decision.",
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.decideAgentProfileCreationRequest({
          ...body.data,
          ...identifiers,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: agentProfileCreationRequestMutationResponseSchema,
      route: AGENT_PROFILE_CREATION_REQUEST_DECISION_ROUTE,
    });
  });

  app.post(AGENT_PROFILE_CREATION_REQUEST_CANCEL_ROUTE, (c) =>
    executeCreationRequestMutation({
      c,
      execute: async (identifiers) =>
        await c.var.coreRpc.cancelAgentProfileCreationRequest({
          ...identifiers,
          context: buildCoreRpcContext(c),
        }),
      route: AGENT_PROFILE_CREATION_REQUEST_CANCEL_ROUTE,
    })
  );

  app.post(AGENT_PROFILE_CREATION_REQUEST_RETRY_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: bodyResult.message,
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUEST_RETRY_ROUTE,
      });
    }
    const body = retryAgentProfileCreationRequestBodySchema.safeParse(
      bodyResult.value ?? {}
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: body.error.issues[0]?.message ?? "Invalid setup correction.",
        method: "POST",
        route: AGENT_PROFILE_CREATION_REQUEST_RETRY_ROUTE,
      });
    }
    return executeCreationRequestMutation({
      c,
      execute: async (identifiers) =>
        await c.var.coreRpc.retryAgentProfileCreationRequest({
          ...identifiers,
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      route: AGENT_PROFILE_CREATION_REQUEST_RETRY_ROUTE,
    });
  });

  app.get(AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE, (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId is required",
        method: "GET",
        route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getAgentProfileCreationApprovalPreference({
          context: buildCoreRpcContext(c),
          organizationId,
        }),
      method: "GET",
      responseSchema: getAgentProfileCreationApprovalPreferenceResponseSchema,
      route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
    });
  });

  app.put(AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId is required",
        method: "PUT",
        route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: bodyResult.message,
        method: "PUT",
        route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
      });
    }
    const body = setAgentProfileCreationApprovalPreferenceBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Agent Profile creation approval preference.",
        method: "PUT",
        route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setAgentProfileCreationApprovalPreference({
          ...body.data,
          context: buildCoreRpcContext(c),
          organizationId,
        }),
      method: "PUT",
      responseSchema: setAgentProfileCreationApprovalPreferenceResponseSchema,
      route: AGENT_PROFILE_CREATION_APPROVAL_PREFERENCE_ROUTE,
    });
  });

  app.get(CURRENT_ORGANIZATION_DIRECTORY_ROUTE, (c) => {
    const includeAgentAvatars =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER
      ) === "true";
    const includeHumanProfileLastUsedAt =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER
      ) === "true";
    const includeMemberLastActiveAt =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER
      ) === "true";
    const agentProfileWorkRecoveryVersion =
      c.req.query(
        ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER
      ) === "2"
        ? 2
        : undefined;

    return executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_DIRECTORY_ROUTE,
      method: "GET",
      responseSchema: organizationDirectoryResponseSchema,
      resolveSuccessPayload: (result) =>
        projectOrganizationDirectoryResponse({
          includeAgentAvatars,
          includeHumanProfileLastUsedAt,
          includeMemberLastActiveAt,
          result,
        }),
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationDirectory({
          ...(c.req.query(
            ORGANIZATION_DIRECTORY_CENTER_AGENT_ONLY_QUERY_PARAMETER
          ) === "true"
            ? { centerAgentOnly: true }
            : {}),
          ...(agentProfileWorkRecoveryVersion
            ? { agentProfileWorkRecoveryVersion }
            : {}),
          context: buildCoreRpcContext(c),
          ...(includeMemberLastActiveAt
            ? { includeMemberLastActiveAt: true }
            : {}),
        }),
    });
  });

  app.get(CURRENT_ORGANIZATION_PROFILE_DIRECTORY_ROUTE, (c) => {
    const includeAgentAvatars =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_AGENT_AVATARS_QUERY_PARAMETER
      ) === "true";
    const includeModelSelection =
      c.req.query(
        ORGANIZATION_PROFILE_DIRECTORY_INCLUDE_MODEL_SELECTION_QUERY_PARAMETER
      ) === "true";
    const includeHumanProfileLastUsedAt =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER
      ) === "true";
    const includeMemberLastActiveAt =
      c.req.query(
        ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER
      ) === "true";

    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationProfileDirectory({
          context: buildCoreRpcContext(c),
          ...(includeModelSelection ? { includeModelSelection: true } : {}),
          ...(c.req.query(
            ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER
          ) === "true"
            ? { includeTaskActivity: true }
            : {}),
          ...(includeMemberLastActiveAt
            ? { includeMemberLastActiveAt: true }
            : {}),
        }),
      method: "GET",
      resolveSuccessPayload: (result) =>
        projectOrganizationProfileDirectoryResponse({
          includeAgentAvatars,
          includeModelSelection,
          includeHumanProfileLastUsedAt,
          includeMemberLastActiveAt,
          result,
        }),
      responseSchema: organizationProfileDirectoryResponseSchema,
      route: CURRENT_ORGANIZATION_PROFILE_DIRECTORY_ROUTE,
    });
  });

  app.get(CURRENT_ORGANIZATION_AGENT_RUNTIME_OVERVIEW_ROUTE, (c) => {
    const agentProfileWorkRecoveryVersion =
      c.req.query(
        ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER
      ) === "2"
        ? 2
        : undefined;
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationAgentRuntimeOverview({
          ...(c.req.query("workloadProfileId")
            ? { workloadProfileId: c.req.query("workloadProfileId") }
            : {}),
          ...(c.req.query("includeUsageLimits") === "true"
            ? { includeUsageLimits: true }
            : {}),
          ...(c.req.query(
            ORGANIZATION_DIRECTORY_INCLUDE_TASK_ACTIVITY_QUERY_PARAMETER
          ) === "true"
            ? { includeTaskActivity: true }
            : {}),
          ...(agentProfileWorkRecoveryVersion
            ? { agentProfileWorkRecoveryVersion }
            : {}),
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: organizationAgentRuntimeOverviewResponseSchema,
      route: CURRENT_ORGANIZATION_AGENT_RUNTIME_OVERVIEW_ROUTE,
    });
  });

  app.get("/v1/organizations/current/member-presence", (c) =>
    executeRpcRoute({
      c,
      route: "/v1/organizations/current/member-presence",
      method: "GET",
      responseSchema: organizationMemberPresenceResponseSchema,
      execute: () =>
        c.var.coreRpc.getCurrentOrganizationMemberPresence({
          context: buildCoreRpcContext(c),
        }),
    })
  );
  app.post("/v1/organizations/current/member-presence", async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    const report = organizationMemberPresenceBodySchema.safeParse(
      body.ok ? body.value : undefined
    );
    if (!report.success) {
      return respondBadRequest({
        c,
        code: body.ok ? "invalid_payload" : "invalid_json",
        message: "Invalid member presence report.",
        method: "POST",
        route: "/v1/organizations/current/member-presence",
      });
    }
    return executeRpcRoute({
      c,
      route: "/v1/organizations/current/member-presence",
      method: "POST",
      responseSchema: organizationMemberPresenceWriteResponseSchema,
      execute: () =>
        c.var.coreRpc.recordCurrentOrganizationMemberPresence({
          context: buildCoreRpcContext(c),
          report: report.data,
        }),
    });
  });

  app.post(CURRENT_ORGANIZATION_MEMBER_WEB_ACTIVITY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_MEMBER_WEB_ACTIVITY_ROUTE,
      method: "POST",
      responseSchema: organizationMemberWebActivityResponseSchema,
      execute: async () =>
        await c.var.coreRpc.recordCurrentOrganizationWebActivity({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post("/v1/spaces/:spaceId/member-activity/web", (c) =>
    executeRpcRoute({
      c,
      route: "/v1/spaces/:spaceId/member-activity/web",
      method: "POST",
      responseSchema: organizationMemberWebActivityResponseSchema,
      execute: async () =>
        await c.var.coreRpc.recordCurrentOrganizationWebActivity({
          context: buildCoreRpcContext(c),
          spaceId: c.req.param("spaceId"),
        }),
    })
  );

  app.get(CURRENT_ORGANIZATION_COMPUTERS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_COMPUTERS_ROUTE,
      method: "GET",
      responseSchema: organizationComputersResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationComputers({
          context: buildCoreRpcContext(c),
          includeUsageLimits:
            c.req.query("includeUsageLimits") === "true" ? "true" : undefined,
        }),
    })
  );

  app.get(CURRENT_ORGANIZATION_MEMBER_OPENMELD_SERVICE_STATUSES_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_MEMBER_OPENMELD_SERVICE_STATUSES_ROUTE,
      method: "GET",
      responseSchema: organizationMemberOpenMeldServiceStatusesResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationMemberOpenMeldServiceStatuses(
          {
            context: buildCoreRpcContext(c),
          }
        ),
    })
  );

  app.get(CURRENT_ORGANIZATION_SPACES_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_SPACES_ROUTE,
      method: "GET",
      responseSchema: organizationSpaceDirectoryResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationSpaceDirectory({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.get(CURRENT_ORGANIZATION_SPACES_WITH_MEMBER_COUNTS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_SPACES_WITH_MEMBER_COUNTS_ROUTE,
      method: "GET",
      responseSchema: organizationSpaceDirectoryWithMemberCountsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationSpaceDirectoryWithMemberCounts(
          {
            context: buildCoreRpcContext(c),
            ...organizationSpaceDirectoryQuerySchema.parse(c.req.query()),
          }
        ),
    })
  );

  app.get(CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE,
      method: "GET",
      responseSchema: centerAgentOrganizationMemoryPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.readCenterAgentOrganizationMemoryPolicy({
          context: buildCoreRpcContext(c),
          ...(c.req.query("includeAvailability") === "true"
            ? { includeAvailability: true }
            : {}),
        }),
    })
  );

  app.put(CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body = updateCenterAgentOrganizationMemoryPolicyBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Center Agent organization memory policy payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_POLICY_ROUTE,
      method: "PUT",
      responseSchema: centerAgentOrganizationMemoryPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.setCenterAgentOrganizationMemoryPolicy({
          context: buildCoreRpcContext(c),
          organizationMemoryOptIn: body.data.organizationMemoryOptIn,
        }),
    });
  });

  app.get(CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE,
      method: "GET",
      responseSchema: organizationInformationProtectionPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.readOrganizationInformationProtectionPolicy({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body =
      updateOrganizationInformationProtectionPolicyBodySchema.safeParse(
        bodyResult.value
      );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Organization information protection policy payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_INFORMATION_PROTECTION_ROUTE,
      method: "PUT",
      responseSchema: organizationInformationProtectionPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.setOrganizationInformationProtectionPolicy({
          context: buildCoreRpcContext(c),
          protectedInformation: body.data.protectedInformation,
        }),
    });
  });

  app.post(CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_WIPE_SELF_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_CENTER_AGENT_MEMORY_WIPE_SELF_ROUTE,
      method: "POST",
      responseSchema: centerAgentWipeMemberMemoryResponseSchema,
      execute: async () =>
        await c.var.coreRpc.wipeCurrentMemberCenterAgentMemory({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.get(CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE,
      method: "GET",
      responseSchema: feedbackReportingPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.readCurrentOrganizationFeedbackReportingPolicy({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE, async (c) => {
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body = updateFeedbackReportingPolicyBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid feedback reporting policy payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_FEEDBACK_REPORTING_POLICY_ROUTE,
      method: "PUT",
      responseSchema: feedbackReportingPolicyResponseSchema,
      execute: async () =>
        await c.var.coreRpc.setCurrentOrganizationFeedbackReportingPolicy({
          context: buildCoreRpcContext(c),
          reportingEnabled: body.data.reportingEnabled,
        }),
    });
  });

  app.get(AGENT_PROFILE_CREATION_DEFAULTS_ROUTE, (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    const agentControllerRef = c.req.param("agentControllerRef")?.trim();
    if (!(organizationId && agentControllerRef)) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId and agentControllerRef are required",
        method: "GET",
        route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getAgentProfileCreationDefaults({
          agentControllerRef,
          context: buildCoreRpcContext(c),
          organizationId,
        }),
      method: "GET",
      responseSchema: getAgentProfileCreationDefaultsResponseSchema,
      route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
    });
  });

  app.put(AGENT_PROFILE_CREATION_DEFAULTS_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    const agentControllerRef = c.req.param("agentControllerRef")?.trim();
    if (!(organizationId && agentControllerRef)) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "organizationId and agentControllerRef are required",
        method: "PUT",
        route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
      });
    }
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        code: "invalid_json",
        message: bodyResult.message,
        method: "PUT",
        route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
      });
    }
    const body = setAgentProfileCreationDefaultsBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Agent Profile creation defaults payload.",
        method: "PUT",
        route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
      });
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setAgentProfileCreationDefaults({
          requestCredential: await buildCoreRpcCredential(c),
          ...body.data,
          agentControllerRef,
          context: buildCoreRpcContext(c),
          organizationId,
        }),
      method: "PUT",
      responseSchema: setAgentProfileCreationDefaultsResponseSchema,
      route: AGENT_PROFILE_CREATION_DEFAULTS_ROUTE,
    });
  });
}

function readCreationRequestIdentifiers(c: {
  req: { param: (name: string) => string | undefined };
}): { organizationId: string; requestId: string } | null {
  const organizationId = c.req.param("organizationId")?.trim();
  const requestId = c.req.param("requestId")?.trim();
  return organizationId && requestId ? { organizationId, requestId } : null;
}

function executeCreationRequestMutation(input: {
  c: Parameters<typeof executeRpcRoute>[0]["c"];
  execute: (identifiers: {
    organizationId: string;
    requestId: string;
  }) => Promise<unknown>;
  route: string;
}) {
  const identifiers = readCreationRequestIdentifiers(input.c);
  if (!identifiers) {
    return respondBadRequest({
      c: input.c,
      code: "invalid_payload",
      message: "organizationId and requestId are required",
      method: "POST",
      route: input.route,
    });
  }
  return executeRpcRoute({
    c: input.c,
    execute: async () => await input.execute(identifiers),
    method: "POST",
    responseSchema: agentProfileCreationRequestMutationResponseSchema,
    route: input.route,
  });
}

function projectOrganizationDirectoryResponse(input: {
  includeAgentAvatars: boolean;
  includeHumanProfileLastUsedAt: boolean;
  includeMemberLastActiveAt: boolean;
  result: unknown;
}): unknown {
  const parsed = organizationDirectoryResponseSchema.safeParse(input.result);
  if (!parsed.success) {
    return input.result;
  }

  return {
    ...parsed.data,
    agentProfiles: parsed.data.agentProfiles.map(
      ({ avatarModelId, avatarStyle, ...profile }) => ({
        ...profile,
        ...(input.includeAgentAvatars ? { avatarModelId, avatarStyle } : {}),
      })
    ),
    members: parsed.data.members.map((member) =>
      projectOrganizationDirectoryMember({ ...input, member })
    ),
  } satisfies OrganizationDirectoryResponse;
}

function projectOrganizationProfileDirectoryResponse(input: {
  includeAgentAvatars: boolean;
  includeModelSelection: boolean;
  includeHumanProfileLastUsedAt: boolean;
  includeMemberLastActiveAt: boolean;
  result: unknown;
}): unknown {
  const parsed = organizationProfileDirectoryResponseSchema.safeParse(
    input.result
  );
  if (!parsed.success) {
    return input.result;
  }
  return {
    ...parsed.data,
    agentProfiles: parsed.data.agentProfiles.map(
      ({ avatarModelId, avatarStyle, modelSelection, ...profile }) => ({
        ...profile,
        ...(input.includeAgentAvatars ? { avatarModelId, avatarStyle } : {}),
        ...(input.includeModelSelection && modelSelection !== undefined
          ? { modelSelection }
          : {}),
      })
    ),
    members: parsed.data.members.map((member) =>
      projectOrganizationDirectoryMember({ ...input, member })
    ),
  } satisfies OrganizationProfileDirectoryResponse;
}

function projectOrganizationDirectoryMember(input: {
  includeHumanProfileLastUsedAt: boolean;
  includeMemberLastActiveAt: boolean;
  member: OrganizationDirectoryResponse["members"][number];
}): OrganizationDirectoryResponse["members"][number] {
  const humanProfile = input.member.humanProfile;
  return {
    ...(input.includeMemberLastActiveAt && input.member.lastActiveAt
      ? { lastActiveAt: input.member.lastActiveAt }
      : {}),
    memberId: input.member.memberId,
    organizationId: input.member.organizationId,
    userId: input.member.userId,
    role: input.member.role,
    joinedAt: input.member.joinedAt,
    user: input.member.user,
    humanProfile: humanProfile
      ? {
          ...(input.includeHumanProfileLastUsedAt && humanProfile.lastUsedAt
            ? { lastUsedAt: humanProfile.lastUsedAt }
            : {}),
          profileId: humanProfile.profileId,
          profileName: humanProfile.profileName,
          profileHandle: humanProfile.profileHandle,
          status: humanProfile.status,
        }
      : null,
  };
}
