import {
  ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
} from "@openmeld/gateway-contract";
import {
  bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema,
  bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema,
  centerAgentOrganizationMemoryPolicyResponseSchema,
  centerAgentWipeMemberMemoryResponseSchema,
  feedbackReportingPolicyResponseSchema,
  getAgentProfileCreationDefaultsResponseSchema,
  getOrganizationBindingAuthorizationPreferenceResponseSchema,
  listOrganizationBindingAuthorizationProfilesResponseSchema,
  organizationComputersResponseSchema,
  organizationDirectoryResponseSchema,
  organizationInformationProtectionPolicyResponseSchema,
  organizationMemberOpenMeldServiceStatusesResponseSchema,
  organizationSpaceDirectoryResponseSchema,
  organizationSpaceDirectoryWithMemberCountsResponseSchema,
  saveOrganizationWakeAccessChoiceBodySchema,
  saveOrganizationWakeAccessChoiceResponseSchema,
  setAgentProfileCreationDefaultsBodySchema,
  setAgentProfileCreationDefaultsResponseSchema,
  setOrganizationBindingAuthorizationPreferenceBodySchema,
  setOrganizationBindingAuthorizationPreferenceResponseSchema,
  updateCenterAgentOrganizationMemoryPolicyBodySchema,
  updateFeedbackReportingPolicyBodySchema,
  updateOrganizationInformationProtectionPolicyBodySchema,
} from "@openmeld/schemas";
import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const CURRENT_ORGANIZATION_DIRECTORY_ROUTE =
  "/v1/organizations/current/directory";
const CURRENT_ORGANIZATION_COMPUTERS_ROUTE =
  "/v1/organizations/current/computers";
const CURRENT_ORGANIZATION_MEMBER_OPENMELD_SERVICE_STATUSES_ROUTE =
  "/v1/organizations/current/member-openmeld-service-statuses";
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
const ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE =
  "/v1/organizations/:organizationId/binding-authorizations/bulk";
const ORGANIZATION_BINDING_AUTHORIZATION_PROFILES_ROUTE =
  "/v1/organizations/:organizationId/binding-authorizations/profiles";
const ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE =
  "/v1/organizations/:organizationId/binding-authorization-preference";
const AGENT_PROFILE_CREATION_DEFAULTS_ROUTE =
  "/v1/organizations/:organizationId/agent-profile-creation-defaults/:agentControllerRef";
const ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE =
  "/v1/organizations/:organizationId/wake-access-choice";

export function registerOrganizationRoutes(app: Hono<HonoBindings>): void {
  app.get(CURRENT_ORGANIZATION_DIRECTORY_ROUTE, (c) => {
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
      route: CURRENT_ORGANIZATION_DIRECTORY_ROUTE,
      method: "GET",
      responseSchema: organizationDirectoryResponseSchema,
      resolveSuccessPayload: (result) =>
        projectOrganizationDirectoryResponse({
          includeHumanProfileLastUsedAt,
          includeMemberLastActiveAt,
          result,
        }),
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationDirectory({
          context: buildCoreRpcContext(c),
          ...(includeMemberLastActiveAt
            ? { includeMemberLastActiveAt: true }
            : {}),
        }),
    });
  });

  app.get(CURRENT_ORGANIZATION_COMPUTERS_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CURRENT_ORGANIZATION_COMPUTERS_ROUTE,
      method: "GET",
      responseSchema: organizationComputersResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCurrentOrganizationComputers({
          context: buildCoreRpcContext(c),
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

  app.post(ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "organizationId is required",
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body =
      bulkAuthorizeAgentProfileBindingsForOrganizationBodySchema.safeParse(
        bodyResult.value
      );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Organization Binding authorization payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: ORGANIZATION_BINDING_AUTHORIZATIONS_BULK_ROUTE,
      method: "POST",
      responseSchema:
        bulkAuthorizeAgentProfileBindingsForOrganizationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.bulkAuthorizeAgentProfileBindingsForOrganization({
          ...body.data,
          organizationId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(ORGANIZATION_BINDING_AUTHORIZATION_PROFILES_ROUTE, (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATION_PROFILES_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "organizationId is required",
      });
    }

    return executeRpcRoute({
      c,
      route: ORGANIZATION_BINDING_AUTHORIZATION_PROFILES_ROUTE,
      method: "GET",
      responseSchema:
        listOrganizationBindingAuthorizationProfilesResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listOrganizationBindingAuthorizationProfiles({
          organizationId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE, (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message: "organizationId is required",
      });
    }

    return executeRpcRoute({
      c,
      route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
      method: "GET",
      responseSchema:
        getOrganizationBindingAuthorizationPreferenceResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getOrganizationBindingAuthorizationPreference({
          organizationId,
          context: buildCoreRpcContext(c),
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

  app.put(ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message: "organizationId is required",
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body =
      setOrganizationBindingAuthorizationPreferenceBodySchema.safeParse(
        bodyResult.value
      );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Organization Binding authorization preference payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: ORGANIZATION_BINDING_AUTHORIZATION_PREFERENCE_ROUTE,
      method: "PUT",
      responseSchema:
        setOrganizationBindingAuthorizationPreferenceResponseSchema,
      execute: async () =>
        await c.var.coreRpc.setOrganizationBindingAuthorizationPreference({
          ...body.data,
          organizationId,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.put(ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE, async (c) => {
    const organizationId = c.req.param("organizationId")?.trim();
    if (!organizationId) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message: "organizationId is required",
      });
    }

    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE,
        method: "PUT",
        code: "invalid_json",
        message: bodyResult.message,
      });
    }
    const body = saveOrganizationWakeAccessChoiceBodySchema.safeParse(
      bodyResult.value
    );
    if (!body.success) {
      return respondBadRequest({
        c,
        route: ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE,
        method: "PUT",
        code: "invalid_payload",
        message:
          body.error.issues[0]?.message ??
          "Invalid Organization Wake access choice payload.",
      });
    }

    return executeRpcRoute({
      c,
      route: ORGANIZATION_WAKE_ACCESS_CHOICE_ROUTE,
      method: "PUT",
      responseSchema: saveOrganizationWakeAccessChoiceResponseSchema,
      execute: async () =>
        await c.var.coreRpc.saveOrganizationWakeAccessChoice({
          ...body.data,
          organizationId,
          context: buildCoreRpcContext(c),
        }),
    });
  });
}

function projectOrganizationDirectoryResponse(input: {
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
    members: parsed.data.members.map((member) => {
      const humanProfile = member.humanProfile;
      return {
        ...(input.includeMemberLastActiveAt && member.lastActiveAt
          ? { lastActiveAt: member.lastActiveAt }
          : {}),
        memberId: member.memberId,
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
        joinedAt: member.joinedAt,
        user: member.user,
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
    }),
  } satisfies OrganizationDirectoryResponse;
}
