import { ORGANIZATION_DIRECTORY_INCLUDE_PUBLIC_WAKEABILITY_REASON_QUERY_PARAMETER } from "@openmeld/gateway-contract";
import {
  centerAgentContextManifestIdSchema,
  centerAgentCreateAgentProfileBodySchema,
  centerAgentCreateAgentProfileResponseSchema,
  centerAgentCreateSpaceBodySchema,
  centerAgentCreateSpaceResponseSchema,
  centerAgentEnableAgentProfileBodySchema,
  centerAgentEnableAgentProfileResponseSchema,
  centerAgentInviteMemberBodySchema,
  centerAgentInviteMemberResponseSchema,
  centerAgentModelConfigurationResponseSchema,
  centerAgentSessionSelectorSchema,
  centerAgentSlackWorkspaceConnectBodySchema,
  centerAgentSlackWorkspaceConnectionResponseSchema,
  centerAgentSlackWorkspaceDisconnectResponseSchema,
  centerAgentUpdateProfileBodySchema,
  centerAgentUpdateProfileResponseSchema,
  convertDirectMessageToSpaceBodySchema,
  convertDirectMessageToSpaceResponseSchema,
  createCenterAgentContextLoadReceiptBodySchema,
  createCenterAgentContextLoadReceiptResponseSchema,
  createCenterAgentContextManifestBodySchema,
  createCenterAgentContextManifestResponseSchema,
  createCenterAgentSessionBodySchema,
  designateCenterAgentBodySchema,
  designateCenterAgentResponseSchema,
  getCenterAgentDesignationResponseSchema,
  getCenterAgentDirectMessageSpaceProjectionResponseSchema,
  getCenterAgentOperatingStateResponseSchema,
  listCenterAgentAuditJournalQuerySchema,
  listCenterAgentAuditJournalResponseSchema,
  listCenterAgentSessionsQuerySchema,
  listCenterAgentSessionsResponseSchema,
  openCenterAgentDirectMessageSpaceResponseSchema,
  openDirectMessageSpaceBodySchema,
  openDirectMessageSpaceResponseSchema,
  organizationDirectoryResponseSchema,
  organizationSpaceDirectoryResponseSchema,
  slackIdentityLinkConsumeBodySchema,
  slackIdentityLinkConsumeResponseSchema,
  slackIdentityLinkPreviewBodySchema,
  slackIdentityLinkPreviewResponseSchema,
  updateCenterAgentModelBodySchema,
  updateCenterAgentModelResponseSchema,
  updateCenterAgentOperatingStateBodySchema,
  updateCenterAgentOperatingStateResponseSchema,
} from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { normalizeCenterAgentAvatarImage } from "../lib/center-agent-avatar-image";
import { projectOrganizationPublicWakeabilityReason } from "../lib/organization-directory-projection";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  parseJsonBody,
  respondBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";

const CENTER_AGENT_BASE_ROUTE = "/v1/organizations/current/center-agent";
const CENTER_AGENT_DESIGNATION_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/designation`;
const CENTER_AGENT_MODEL_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/model`;
const CENTER_AGENT_OPERATING_STATE_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/operating-state`;
const CENTER_AGENT_PROFILE_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/profile`;
const CENTER_AGENT_AUDIT_JOURNAL_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/audit-journal`;
const CENTER_AGENT_CONTEXT_MANIFEST_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/context-manifests`;
const CENTER_AGENT_CONTEXT_LOAD_RECEIPT_ROUTE = `${CENTER_AGENT_CONTEXT_MANIFEST_ROUTE}/:manifestId/load-receipt`;
const CENTER_AGENT_SPACES_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/spaces`;
const CENTER_AGENT_DIRECTORY_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/directory`;
const CENTER_AGENT_AGENT_PROFILES_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/agent-profiles`;
const CENTER_AGENT_INVITATIONS_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/invitations`;
const CENTER_AGENT_DM_SPACE_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/dm-space`;
const CENTER_AGENT_SESSIONS_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/sessions`;
const CENTER_AGENT_SESSION_ROUTE = `${CENTER_AGENT_SESSIONS_ROUTE}/:spaceId`;
const CENTER_AGENT_SLACK_CONNECTION_ROUTE = `${CENTER_AGENT_BASE_ROUTE}/slack-connection`;
const SLACK_IDENTITY_LINK_PREVIEW_ROUTE = "/v1/slack/identity-link/preview";
const SLACK_IDENTITY_LINK_CONSUME_ROUTE = "/v1/slack/identity-link/consume";
const DIRECT_MESSAGE_SPACE_ROUTE = "/v1/organizations/current/dm-space";
const DIRECT_MESSAGE_CONVERSION_ROUTE =
  "/v1/spaces/:spaceId/direct-message-conversion";
const CENTER_AGENT_MANAGED_ROLE = "center_agent";
const CENTER_AGENT_PROFILE_NAME = "Center Agent";

export function registerCenterAgentRoutes(app: Hono<HonoBindings>): void {
  app.get(CENTER_AGENT_DESIGNATION_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_DESIGNATION_ROUTE,
      method: "GET",
      responseSchema: getCenterAgentDesignationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentDesignation({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CENTER_AGENT_DESIGNATION_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, designateCenterAgentBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const context = buildCoreRpcContext(c);
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_DESIGNATION_ROUTE,
      method: "PUT",
      responseSchema: designateCenterAgentResponseSchema,
      execute: async () => {
        const agentProfileId = await resolveCenterAgentProfileIdForDesignation({
          c,
          context,
          requestedAgentProfileId: parsed.data.agentProfileId,
        });
        return await c.var.coreRpc.designateCenterAgent({
          agentProfileId,
          runtime: parsed.data.runtime,
          context,
        });
      },
    });
  });

  app.get(CENTER_AGENT_MODEL_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_MODEL_ROUTE,
      method: "GET",
      responseSchema: centerAgentModelConfigurationResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentModel({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CENTER_AGENT_MODEL_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, updateCenterAgentModelBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_MODEL_ROUTE,
      method: "PUT",
      responseSchema: updateCenterAgentModelResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateCenterAgentModel({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(CENTER_AGENT_OPERATING_STATE_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_OPERATING_STATE_ROUTE,
      method: "GET",
      responseSchema: getCenterAgentOperatingStateResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentOperatingState({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.put(CENTER_AGENT_OPERATING_STATE_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      updateCenterAgentOperatingStateBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_OPERATING_STATE_ROUTE,
      method: "PUT",
      responseSchema: updateCenterAgentOperatingStateResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateCenterAgentOperatingState({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(CENTER_AGENT_SLACK_CONNECTION_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      centerAgentSlackWorkspaceConnectBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_SLACK_CONNECTION_ROUTE,
      method: "POST",
      responseSchema: centerAgentSlackWorkspaceConnectionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.connectCenterAgentSlackWorkspace({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.delete(CENTER_AGENT_SLACK_CONNECTION_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_SLACK_CONNECTION_ROUTE,
      method: "DELETE",
      responseSchema: centerAgentSlackWorkspaceDisconnectResponseSchema,
      execute: async () =>
        await c.var.coreRpc.disconnectCenterAgentSlackWorkspace({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post(SLACK_IDENTITY_LINK_PREVIEW_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, slackIdentityLinkPreviewBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: SLACK_IDENTITY_LINK_PREVIEW_ROUTE,
      method: "POST",
      responseSchema: slackIdentityLinkPreviewResponseSchema,
      execute: async () =>
        await c.var.coreRpc.previewSlackIdentityLink({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(SLACK_IDENTITY_LINK_CONSUME_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, slackIdentityLinkConsumeBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: SLACK_IDENTITY_LINK_CONSUME_ROUTE,
      method: "POST",
      responseSchema: slackIdentityLinkConsumeResponseSchema,
      execute: async () =>
        await c.var.coreRpc.consumeSlackIdentityLink({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.patch(CENTER_AGENT_PROFILE_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, centerAgentUpdateProfileBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    if (parsed.data.avatar?.kind === "image") {
      try {
        if (!c.env.OPENMELD_IMAGES) {
          throw new Error("Image upload is temporarily unavailable.");
        }
        parsed.data.avatar = await normalizeCenterAgentAvatarImage(
          parsed.data.avatar,
          c.env.OPENMELD_IMAGES
        );
      } catch (error) {
        return respondBadRequest({
          c,
          route: CENTER_AGENT_PROFILE_ROUTE,
          method: "PATCH",
          code: "invalid_payload",
          message:
            error instanceof Error
              ? error.message
              : "This image could not be processed.",
        });
      }
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_PROFILE_ROUTE,
      method: "PATCH",
      responseSchema: centerAgentUpdateProfileResponseSchema,
      execute: async () =>
        await c.var.coreRpc.updateCenterAgentProfile({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(CENTER_AGENT_AUDIT_JOURNAL_ROUTE, (c) => {
    const parsed = listCenterAgentAuditJournalQuerySchema.safeParse({
      actionSet: c.req.query("actionSet"),
      limit: c.req.query("limit"),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: CENTER_AGENT_AUDIT_JOURNAL_ROUTE,
        method: "GET",
        code: "invalid_payload",
        message:
          parsed.error.issues[0]?.message ??
          "Invalid Center Agent audit journal query.",
      });
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_AUDIT_JOURNAL_ROUTE,
      method: "GET",
      responseSchema: listCenterAgentAuditJournalResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listCenterAgentAuditJournal({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(CENTER_AGENT_SPACES_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, centerAgentCreateSpaceBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_SPACES_ROUTE,
      method: "POST",
      responseSchema: centerAgentCreateSpaceResponseSchema,
      execute: async () =>
        await c.var.coreRpc.centerAgentCreateSpace({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(CENTER_AGENT_DIRECTORY_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_DIRECTORY_ROUTE,
      method: "GET",
      responseSchema: organizationDirectoryResponseSchema.transform(
        (response) =>
          projectOrganizationPublicWakeabilityReason(
            response,
            c.req.query(
              ORGANIZATION_DIRECTORY_INCLUDE_PUBLIC_WAKEABILITY_REASON_QUERY_PARAMETER
            ) === "true"
          )
      ),
      execute: async () =>
        await c.var.coreRpc.centerAgentGetOrganizationDirectory({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.get(CENTER_AGENT_SPACES_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_SPACES_ROUTE,
      method: "GET",
      responseSchema: organizationSpaceDirectoryResponseSchema,
      execute: async () =>
        await c.var.coreRpc.centerAgentGetOrganizationSpaceDirectory({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post(CENTER_AGENT_AGENT_PROFILES_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      centerAgentCreateAgentProfileBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    const context = buildCoreRpcContext(c);
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_AGENT_PROFILES_ROUTE,
      method: "POST",
      responseSchema: centerAgentCreateAgentProfileResponseSchema,
      execute: async () =>
        await c.var.coreRpc.centerAgentCreateAgentProfile({
          ...parsed.data,
          context,
        }),
    });
  });

  app.post(
    `${CENTER_AGENT_AGENT_PROFILES_ROUTE}/:agentProfileId/enable`,
    async (c) => {
      const parsed = await parseJsonBody(
        c,
        centerAgentEnableAgentProfileBodySchema
      );
      if (!parsed.ok) {
        return parsed.response;
      }
      const agentProfileId = c.req.param("agentProfileId");
      return executeRpcRoute({
        c,
        route: `${CENTER_AGENT_AGENT_PROFILES_ROUTE}/:agentProfileId/enable`,
        method: "POST",
        responseSchema: centerAgentEnableAgentProfileResponseSchema,
        execute: async () =>
          await c.var.coreRpc.centerAgentEnableAgentProfile({
            agentProfileId,
            ...parsed.data,
            context: buildCoreRpcContext(c),
          }),
      });
    }
  );

  app.post(CENTER_AGENT_INVITATIONS_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, centerAgentInviteMemberBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    const context = buildCoreRpcContext(c);
    return executeRpcRoute({
      c,
      route: CENTER_AGENT_INVITATIONS_ROUTE,
      method: "POST",
      responseSchema: centerAgentInviteMemberResponseSchema,
      execute: async () => {
        const designation =
          await c.var.coreRpc.assertCurrentDesignatedCenterAgent({ context });
        const authResponse = await c.var.authRpc.fetch(
          new Request(
            "https://openmeld-auth.internal/api/auth/organization/invite-member",
            {
              body: JSON.stringify({
                email: parsed.data.email,
                organizationId: designation.organizationId,
                role: parsed.data.role,
              }),
              headers: {
                ...toHeaderRecord(c.req.raw.headers),
                "content-type": "application/json",
              },
              method: "POST",
            }
          )
        );
        if (!authResponse.ok) {
          throw new Error("Failed to send Organization invitation.");
        }
        const attribution = await c.var.coreRpc.recordCenterAgentAudit({
          action: "invite_member",
          context,
          onBehalfOf: parsed.data.onBehalfOf ?? null,
          resource: { type: "invitation_email", id: parsed.data.email },
        });
        return {
          organizationId: designation.organizationId,
          attribution,
          invited: true,
          resource: { type: "invitation_email", id: parsed.data.email },
        };
      },
    });
  });

  app.get(CENTER_AGENT_DM_SPACE_ROUTE, (c) =>
    executeRpcRoute({
      c,
      route: CENTER_AGENT_DM_SPACE_ROUTE,
      method: "GET",
      responseSchema: getCenterAgentDirectMessageSpaceProjectionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentDirectMessageSpaceProjection({
          context: buildCoreRpcContext(c),
        }),
    })
  );

  app.post(CENTER_AGENT_SESSIONS_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, createCenterAgentSessionBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_SESSIONS_ROUTE,
      method: "POST",
      responseSchema: openCenterAgentDirectMessageSpaceResponseSchema,
      execute: async () =>
        await c.var.coreRpc.openCenterAgentDirectMessageSpace({
          context: buildCoreRpcContext(c),
          sessionCreationId: parsed.data.creationId,
        }),
    });
  });

  app.get(CENTER_AGENT_SESSIONS_ROUTE, async (c) => {
    const cursor = c.req.query("cursor");
    const limit = c.req.query("limit");
    const parsed = listCenterAgentSessionsQuerySchema.safeParse({
      ...(cursor === undefined ? {} : { cursor }),
      ...(limit === undefined ? {} : { limit: Number(limit) }),
    });
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: CENTER_AGENT_SESSIONS_ROUTE,
        method: "GET",
        message: "Provide a valid chat-list cursor and limit.",
      });
    }
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_SESSIONS_ROUTE,
      method: "GET",
      responseSchema: listCenterAgentSessionsResponseSchema,
      execute: async () =>
        await c.var.coreRpc.listCenterAgentSessions({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.get(CENTER_AGENT_SESSION_ROUTE, async (c) => {
    const selector = centerAgentSessionSelectorSchema.safeParse({
      spaceId: c.req.param("spaceId"),
    });
    if (!selector.success) {
      return respondBadRequest({
        c,
        route: CENTER_AGENT_SESSION_ROUTE,
        method: "GET",
        message: "Provide a valid session ID.",
      });
    }
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_SESSION_ROUTE,
      method: "GET",
      responseSchema: getCenterAgentDirectMessageSpaceProjectionResponseSchema,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentDirectMessageSpaceProjection({
          context: buildCoreRpcContext(c),
          spaceId: selector.data.spaceId,
        }),
    });
  });

  app.post(CENTER_AGENT_DM_SPACE_ROUTE, async (c) => {
    const context = buildCoreRpcContext(c);
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_DM_SPACE_ROUTE,
      method: "POST",
      responseSchema: openCenterAgentDirectMessageSpaceResponseSchema,
      resolveErrorSurface: (error) => ({
        code: "center_agent.dm_open_failed",
        ...(error.code ? { upstreamCode: error.code } : {}),
      }),
      execute: async () =>
        await c.var.coreRpc.openCenterAgentDirectMessageSpace({
          context,
        }),
    });
  });

  app.post(CENTER_AGENT_CONTEXT_MANIFEST_ROUTE, async (c) => {
    const parsed = await parseJsonBody(
      c,
      createCenterAgentContextManifestBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_CONTEXT_MANIFEST_ROUTE,
      method: "POST",
      responseSchema: createCenterAgentContextManifestResponseSchema,
      execute: async () =>
        await c.var.coreRpc.createCenterAgentContextManifest({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(CENTER_AGENT_CONTEXT_LOAD_RECEIPT_ROUTE, async (c) => {
    const manifestId = centerAgentContextManifestIdSchema.safeParse(
      c.req.param("manifestId")
    );
    if (!manifestId.success) {
      return respondBadRequest({
        c,
        code: "invalid_payload",
        message: "Invalid Center Agent Context Manifest ID.",
        method: "POST",
        route: CENTER_AGENT_CONTEXT_LOAD_RECEIPT_ROUTE,
      });
    }
    const parsed = await parseJsonBody(
      c,
      createCenterAgentContextLoadReceiptBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return await executeRpcRoute({
      c,
      route: CENTER_AGENT_CONTEXT_LOAD_RECEIPT_ROUTE,
      method: "POST",
      responseSchema: createCenterAgentContextLoadReceiptResponseSchema,
      execute: async () =>
        await c.var.coreRpc.createCenterAgentContextLoadReceipt({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          manifestId: manifestId.data,
        }),
    });
  });

  app.post(DIRECT_MESSAGE_SPACE_ROUTE, async (c) => {
    const parsed = await parseJsonBody(c, openDirectMessageSpaceBodySchema);
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      route: DIRECT_MESSAGE_SPACE_ROUTE,
      method: "POST",
      responseSchema: openDirectMessageSpaceResponseSchema,
      resolveErrorSurface: (error) => ({
        code: "direct_message.open_failed",
        ...(error.code ? { upstreamCode: error.code } : {}),
      }),
      execute: async () =>
        await c.var.coreRpc.openDirectMessageSpace({
          ...parsed.data,
          context: buildCoreRpcContext(c),
        }),
    });
  });

  app.post(DIRECT_MESSAGE_CONVERSION_ROUTE, async (c) => {
    const parsedSpace = parseSpaceRouteParams(c.req.param("spaceId"));
    if (!parsedSpace.ok) {
      return respondBadRequest({
        c,
        code: "invalid_space_id",
        message: parsedSpace.message,
        method: "POST",
        reason: "invalid Direct Message conversion Space ID",
        route: DIRECT_MESSAGE_CONVERSION_ROUTE,
      });
    }
    const parsed = await parseJsonBody(
      c,
      convertDirectMessageToSpaceBodySchema
    );
    if (!parsed.ok) {
      return parsed.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.convertDirectMessageToSpace({
          context: buildCoreRpcContext(c),
          includeMemberSnapshots: parsed.data.includeMemberSnapshots,
          name: parsed.data.name,
          profileIds: parsed.data.profileIds,
          spaceId: parsedSpace.value.spaceId,
        }),
      method: "POST",
      responseSchema: convertDirectMessageToSpaceResponseSchema,
      route: DIRECT_MESSAGE_CONVERSION_ROUTE,
      spaceId: parsedSpace.value.spaceId,
    });
  });
}

function toHeaderRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function resolveCenterAgentProfileIdForDesignation(input: {
  c: Context<HonoBindings>;
  context: ReturnType<typeof buildCoreRpcContext>;
  requestedAgentProfileId?: string;
}): Promise<string> {
  if (input.requestedAgentProfileId) {
    return input.requestedAgentProfileId;
  }

  const ensured = await input.c.var.authRpc.ensureManagedAgentProfile({
    headers: toHeaderRecord(input.c.req.raw.headers),
    managedRole: CENTER_AGENT_MANAGED_ROLE,
    profileName: CENTER_AGENT_PROFILE_NAME,
    creatorProfileId: input.context.actorContext.openMeldProfileId,
  });
  if (!ensured.ok) {
    throw new Error("Failed to ensure the Center Agent profile.");
  }
  return ensured.profile.openMeldProfileId;
}
