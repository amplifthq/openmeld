import {
  CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE,
  centerAgentCreateOrganizationInviteLinkResponseSchema,
  centerAgentCreateOrganizationInviteLinkToolRpcInputSchema,
  centerAgentGetOrganizationInviteLinkResponseSchema,
  centerAgentGetOrganizationInviteLinkToolRpcInputSchema,
  ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentCreateOrganizationInviteLinkResponse,
  CenterAgentCreateOrganizationInviteLinkToolRpcInput,
  CenterAgentGetOrganizationInviteLinkResponse,
  CenterAgentGetOrganizationInviteLinkToolRpcInput,
} from "@openmeld/schemas/types";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import { requireCurrentDesignatedCenterAgentCaller } from "../center-agent/current-designated-center-agent";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import { callRequiredAuthWorkerRpc } from "../rpc/required-auth-worker-rpc";
import {
  buildOrganizationJoinLinkUrl,
  readActiveOrganizationJoinLink,
} from "./organization-join-link-read-service";

export async function rpcCenterAgentCreateOrganizationInviteLink(
  env: CoreBindings,
  input: CenterAgentCreateOrganizationInviteLinkToolRpcInput
): Promise<CenterAgentCreateOrganizationInviteLinkResponse> {
  const request =
    centerAgentCreateOrganizationInviteLinkToolRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        "Center Agent Organization invite-link ensure request is invalid.",
      status: 400,
    });
  }

  const { authorization, representedHuman } =
    await prepareCenterAgentRepresentedMemberRequest(
      env,
      request.data.context,
      request.data.speakerMember
    );
  const authResult = await callRequiredAuthWorkerRpc({
    authWorker: env.OPENMELD_AUTH_WORKER,
    call: (authWorker) =>
      authWorker.ensureOrganizationJoinLinkOnBehalfOf({
        actorUserId: representedHuman.userId,
        organizationId: authorization.activeOrganization.organizationId,
      }),
    unavailable: {
      code: "organization.join_link.ensure_unavailable",
      reason: "Organization invite-link creation is unavailable.",
    },
  });
  const parsedAuthResult =
    ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema.safeParse(authResult);
  if (!parsedAuthResult.success) {
    throw createCoreRpcHttpError({
      code: "organization.join_link.ensure_invalid_response",
      reason: "Auth returned an invalid Organization invite-link response.",
      status: 502,
    });
  }
  if (!parsedAuthResult.data.ok) {
    return parseOrganizationInviteLinkCreateResponse({
      error: {
        code: parsedAuthResult.data.code,
        message: parsedAuthResult.data.message,
      },
      ok: false,
    });
  }
  return parseOrganizationInviteLinkCreateResponse({
    ok: true,
    organizationName: parsedAuthResult.data.organizationName,
    url: parsedAuthResult.data.joinLink.url,
  });
}

export async function rpcCenterAgentGetOrganizationInviteLink(
  env: CoreBindings,
  input: CenterAgentGetOrganizationInviteLinkToolRpcInput
): Promise<CenterAgentGetOrganizationInviteLinkResponse> {
  const request =
    centerAgentGetOrganizationInviteLinkToolRpcInputSchema.safeParse(input);
  if (!request.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason: "Center Agent Organization invite-link query is invalid.",
      status: 400,
    });
  }

  const authorization = await requireCurrentDesignatedCenterAgentCaller({
    context: request.data.context,
    env,
  });
  const activeLink = await readActiveOrganizationJoinLink({
    db: authorization.db,
    organizationId: authorization.activeOrganization.organizationId,
  });
  if (!activeLink) {
    return parseOrganizationInviteLinkResponse({
      active: false,
      generationGuidance:
        CENTER_AGENT_ORGANIZATION_INVITE_LINK_GENERATION_GUIDANCE,
    });
  }

  const webAppUrl = env.WEB_APP_URL?.trim();
  if (!webAppUrl) {
    throw new Error(
      "Core WEB_APP_URL is required to build an Organization invite link."
    );
  }
  return parseOrganizationInviteLinkResponse({
    active: true,
    organizationName: activeLink.organizationName,
    url: buildOrganizationJoinLinkUrl({
      token: activeLink.token,
      webAppUrl,
    }),
  });
}

function parseOrganizationInviteLinkResponse(
  value: unknown
): CenterAgentGetOrganizationInviteLinkResponse {
  const response =
    centerAgentGetOrganizationInviteLinkResponseSchema.safeParse(value);
  if (!response.success) {
    throw new Error(
      `Failed to build a valid Center Agent Organization invite-link response: ${response.error.message}`
    );
  }
  return response.data;
}

function parseOrganizationInviteLinkCreateResponse(
  value: unknown
): CenterAgentCreateOrganizationInviteLinkResponse {
  const response =
    centerAgentCreateOrganizationInviteLinkResponseSchema.safeParse(value);
  if (!response.success) {
    throw new Error(
      `Failed to build a valid Center Agent Organization invite-link create response: ${response.error.message}`
    );
  }
  return response.data;
}
