import {
  buildOpenMeldOrganizationWebUrl,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityResult,
  CenterAgentModelRoute,
  ChannelContext,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import { readPrimaryAgentProfileBindingRecord } from "../../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import {
  CenterAgentModelResolutionError,
  resolveCenterAgentModelRouteForBinding,
} from "../../center-agent/application/center-agent-model-service";
import { readCenterAgentDesignationRecord } from "../../center-agent/center-agent-repository";
import { readModelCatalog } from "../../config/model-catalog";
import type { CoreBindings } from "../../lib/bindings";
import { readOrganizationAccountIdentityProjection } from "../../organizations/organization-context";
import {
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  readRemoteAgentLarkPlatformChannelConnection,
} from "../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  deleteRemoteAgentLarkPlatformIdentityLinkIfMatches,
  readRemoteAgentLarkPlatformIdentityLink,
} from "../infrastructure/d1/lark-platform-identity-link-repo";
import { parseCoreOwnedRemoteAgentTurnEnvelope } from "./center-agent-context-scope";
import type { LarkPlatformMessageChannelProvider } from "./message-channel-adapters";

export type MessageChannelMemberIdentity = {
  humanProfileId: string | null;
  memberCount: number;
  memberId: string;
  organizationId: string;
  organizationName: string;
  organizationPersonal: boolean;
  organizationSlug: string;
  role: string | null;
  userDisplayName: string;
  userEmail: string;
  userId: string;
};

export type MessageChannelOrganizationIdentity = Pick<
  MessageChannelMemberIdentity,
  | "memberCount"
  | "organizationId"
  | "organizationName"
  | "organizationPersonal"
  | "organizationSlug"
>;

export type MessageChannelTurnParticipant =
  | {
      kind: "anonymous_member";
      organization: MessageChannelOrganizationIdentity;
      providerUserDisplayName: string;
      providerUserId: string;
    }
  | {
      kind: "external";
      organization: MessageChannelOrganizationIdentity;
      providerUserDisplayName: string;
      providerUserId: string;
    }
  | {
      kind: "member";
      member: MessageChannelMemberIdentity;
    };

export type MessageChannelCenterAgentTarget = {
  agentProfileId: string;
  bindingId: string;
  modelRoute: CenterAgentModelRoute;
  ownerUserId: string;
  profileHandle: string;
  profileName: string;
};

export type MessageChannelTurnTarget = {
  centerAgent: MessageChannelCenterAgentTarget;
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  participant: MessageChannelTurnParticipant;
};

export type MessageChannelTurnTargetResolution =
  | {
      status: "resolved";
      target: MessageChannelTurnTarget;
    }
  | {
      reasonCode:
        | "message_channel.center_agent_unavailable"
        | "message_channel.center_agent_model_unavailable";
      connection: RemoteAgentLarkPlatformChannelConnectionRecord;
      status: "rejected";
    }
  | {
      reasonCode: "message_channel.connection_unavailable";
      status: "rejected";
    };

type OrganizationAccountIdentityProjection = Extract<
  AuthRpcResolveOrganizationAccountIdentityResult,
  { ok: true }
>;

type MessageChannelCenterAgentProfileRow = {
  owner_user_id: string;
  profile_handle: string;
  profile_name: string;
};

export async function resolveMessageChannelTurnTarget(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  connectionId: string;
  identityDb: D1Database;
  provider: LarkPlatformMessageChannelProvider;
  providerUserDisplayName?: string | null;
  providerUserId: string;
  providerUserTenantKey?: string | null;
  stateDb: D1Database;
}): Promise<MessageChannelTurnTargetResolution> {
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: input.connectionId,
    db: input.stateDb,
  });
  if (
    !connection ||
    connection.provider !== input.provider ||
    connection.status !== "connected"
  ) {
    return {
      reasonCode: "message_channel.connection_unavailable",
      status: "rejected",
    };
  }

  const [identityLink, organization, centerAgentResolution] = await Promise.all(
    [
      readRemoteAgentLarkPlatformIdentityLink({
        connectionId: connection.connectionId,
        db: input.stateDb,
        provider: connection.provider,
        providerUserId: input.providerUserId,
      }),
      readMessageChannelOrganizationIdentity({
        authWorker: input.authWorker,
        organizationId: connection.organizationId,
      }),
      resolveMessageChannelCenterAgentTarget({
        db: input.identityDb,
        organizationId: connection.organizationId,
      }),
    ]
  );
  if (
    identityLink &&
    identityLink.organizationId !== connection.organizationId
  ) {
    throw new Error(
      "Message Channel identity link does not match its connection Organization"
    );
  }
  if (!organization) {
    return {
      reasonCode: "message_channel.connection_unavailable",
      status: "rejected",
    };
  }
  if (centerAgentResolution.status === "model_unavailable") {
    return {
      connection,
      reasonCode: "message_channel.center_agent_model_unavailable",
      status: "rejected",
    };
  }
  const centerAgent = centerAgentResolution.target;
  if (!centerAgent) {
    return {
      connection,
      reasonCode: "message_channel.center_agent_unavailable",
      status: "rejected",
    };
  }
  const member = identityLink
    ? await readMessageChannelMemberByUserId({
        authWorker: input.authWorker,
        organizationId: connection.organizationId,
        userId: identityLink.openmeldUserId,
      })
    : null;
  if (identityLink && !member) {
    await deleteRemoteAgentLarkPlatformIdentityLinkIfMatches({
      connectionId: connection.connectionId,
      db: input.stateDb,
      organizationId: connection.organizationId,
      provider: connection.provider,
      providerUserId: input.providerUserId,
      openmeldUserId: identityLink.openmeldUserId,
    });
  }
  const providerUserDisplayName =
    normalizeOptionalText(input.providerUserDisplayName) ??
    input.providerUserId;
  let participant: MessageChannelTurnParticipant;
  if (member) {
    participant = { kind: "member", member };
  } else if (
    input.providerUserTenantKey !== null &&
    connection.tenantKey !== null &&
    input.providerUserTenantKey === connection.tenantKey
  ) {
    participant = {
      kind: "anonymous_member",
      organization,
      providerUserDisplayName,
      providerUserId: input.providerUserId,
    };
  } else {
    participant = {
      kind: "external",
      organization,
      providerUserDisplayName,
      providerUserId: input.providerUserId,
    };
  }
  return {
    status: "resolved",
    target: { centerAgent, connection, participant },
  };
}

async function resolveMessageChannelCenterAgentTarget(input: {
  db: D1Database;
  organizationId: string;
}): Promise<
  | { status: "model_unavailable"; target: null }
  | { status: "resolved"; target: MessageChannelCenterAgentTarget | null }
> {
  try {
    return {
      status: "resolved",
      target: await readMessageChannelCenterAgentTarget(input),
    };
  } catch (error) {
    if (!(error instanceof CenterAgentModelResolutionError)) {
      throw error;
    }
    console.warn("[core.message_channel.center_agent_model_unavailable]", {
      code: error.code,
      organizationId: input.organizationId,
    });
    return { status: "model_unavailable", target: null };
  }
}

export function buildMessageChannelTurnEnvelope(input: {
  centerAgent: MessageChannelCenterAgentTarget;
  channelContext: ChannelContext;
  connectionId: string;
  conversationId: string;
  conversationName: string | null;
  isDirectMessage: boolean;
  participant: MessageChannelTurnParticipant;
  provider: LarkPlatformMessageChannelProvider;
  providerUserId: string;
  webAppUrl?: string;
}): RemoteAgentTurnEnvelope {
  const webAppUrl = normalizeOptionalText(input.webAppUrl);
  const providerName = input.provider === "lark" ? "Lark" : "Feishu";
  const organization =
    input.participant.kind === "member"
      ? input.participant.member
      : input.participant.organization;
  return parseCoreOwnedRemoteAgentTurnEnvelope({
    interactionEnvironment: input.isDirectMessage
      ? "requester_private"
      : "externally_shared",
    sender:
      input.participant.kind === "member"
        ? {
            kind: "member",
            id: input.participant.member.memberId,
            displayName: input.participant.member.userDisplayName,
            messageChannelIdentity: {
              connectionId: input.connectionId,
              provider: input.provider,
              providerUserId: input.providerUserId,
            },
            ownerUserId: input.participant.member.userId,
            ...(input.participant.member.humanProfileId
              ? { profileId: input.participant.member.humanProfileId }
              : {}),
            ...(input.participant.member.role
              ? { role: input.participant.member.role }
              : {}),
            verified: true,
          }
        : {
            kind: "member",
            id: `${input.provider}:${input.connectionId}:${input.participant.providerUserId}`,
            displayName: input.participant.providerUserDisplayName,
            ...(input.participant.kind === "anonymous_member"
              ? {
                  messageChannelIdentity: {
                    connectionId: input.connectionId,
                    provider: input.provider,
                    providerUserId: input.participant.providerUserId,
                  },
                }
              : {}),
            verified: false,
          },
    space: {
      id: input.conversationId,
      name:
        normalizeOptionalText(input.conversationName) ??
        `${providerName} conversation`,
      kind: input.isDirectMessage ? "dm" : "space",
      isCenterAgentDm: false,
    },
    organization: {
      id: organization.organizationId,
      name: organization.organizationName,
      personal: organization.organizationPersonal,
      memberCount: organization.memberCount,
      ...(webAppUrl
        ? {
            webUrl: buildOpenMeldOrganizationWebUrl({
              organizationSlug: organization.organizationSlug,
              webAppUrl,
            }),
          }
        : {}),
    },
    centerAgent: {
      profileHandle: input.centerAgent.profileHandle,
      profileName: input.centerAgent.profileName,
    },
    trigger: {
      source: "message_channel",
      provider: input.provider,
      connectionId: input.connectionId,
      conversationId: input.conversationId,
    },
    channelContext: input.channelContext,
  });
}

async function readMessageChannelOrganizationIdentity(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
}): Promise<MessageChannelOrganizationIdentity | null> {
  const projection = await readOrganizationAccountIdentityProjection({
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  return projection?.ok
    ? {
        memberCount: projection.organization.memberCount,
        organizationId: projection.organization.id,
        organizationName: projection.organization.name,
        organizationPersonal: projection.organization.personal,
        organizationSlug: projection.organization.slug,
      }
    : null;
}

async function readMessageChannelMemberByUserId(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"];
  organizationId: string;
  userId: string;
}): Promise<MessageChannelMemberIdentity | null> {
  const projection = await readOrganizationAccountIdentityProjection({
    account: { kind: "user_id", userId: input.userId },
    authWorker: input.authWorker,
    organizationId: input.organizationId,
  });
  return projection?.ok
    ? mapMessageChannelMemberIdentityProjection(projection)
    : null;
}

function mapMessageChannelMemberIdentityProjection(
  projection: OrganizationAccountIdentityProjection
): MessageChannelMemberIdentity | null {
  const account = projection.account;
  const membership = account?.membership;
  if (!(account && membership)) {
    return null;
  }
  return {
    humanProfileId: account.defaultHumanProfile?.profileId ?? null,
    memberCount: projection.organization.memberCount,
    memberId: membership.memberId,
    organizationId: projection.organization.id,
    organizationName: projection.organization.name,
    organizationPersonal: projection.organization.personal,
    organizationSlug: projection.organization.slug,
    role: membership.role,
    userDisplayName: account.displayName,
    userEmail: account.email,
    userId: account.userId,
  };
}

async function readMessageChannelCenterAgentTarget(input: {
  db: D1Database;
  organizationId: string;
}): Promise<MessageChannelCenterAgentTarget | null> {
  const designation = await readCenterAgentDesignationRecord({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!designation) {
    return null;
  }
  const profile = await input.db
    .prepare(
      `
        SELECT owner_user_id, profile_name, profile_handle
        FROM openmeld_profiles
        WHERE profile_id = ?
          AND profile_kind = 'agent'
          AND status = 'active'
        LIMIT 1
      `
    )
    .bind(designation.agentProfileId)
    .first<MessageChannelCenterAgentProfileRow>();
  if (!profile) {
    return null;
  }
  const binding = await readPrimaryAgentProfileBindingRecord({
    agentProfileId: designation.agentProfileId,
    db: input.db,
    owner: { id: profile.owner_user_id, kind: "owner_account" },
  });
  if (
    binding?.runtimeKind !== "hosted_center_agent" ||
    binding.agentControllerRef !== HOSTED_CENTER_AGENT_CONTROLLER_REF
  ) {
    return null;
  }
  return {
    agentProfileId: designation.agentProfileId,
    bindingId: binding.bindingId,
    modelRoute: resolveCenterAgentModelRouteForBinding({
      binding,
      catalog: readModelCatalog(),
    }),
    ownerUserId: profile.owner_user_id,
    profileHandle: profile.profile_handle,
    profileName: profile.profile_name,
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
