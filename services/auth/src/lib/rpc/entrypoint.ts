import { WorkerEntrypoint } from "cloudflare:workers";
import {
  AUTH_SERVICE_NAME,
  type AuthClaims,
  type AuthProfileKind,
  createAccountAvatarService,
  createD1Db,
  createD1OrganizationLogoMutationRepository,
  createDrizzleAccountAvatarMutationRepository,
  createDrizzleOrganizationJoinLinkRepository,
  createOrganizationJoinLinkService,
  createOrganizationLogoService,
  createUnauthenticatedClaims,
  DEFAULT_AUTH_BASE_URL,
  normalizeAuthHeaderValue,
  type OpenMeldProfileManagedRole,
  type OpenMeldProfileSource,
  type OpenMeldProfileSpaceCreatorKind,
  type OpenMeldProfileSpaceHistoryStatus,
  OrganizationJoinLinkServiceError,
  ProfileNotFoundError,
  ProfileValidationError,
  type ResolveRequestAuthInput,
  type ResolveRequestAuthResult,
} from "@openmeld/auth/server";
import {
  accountAvatarCommitRpcInputSchema,
  accountAvatarPrepareRpcInputSchema,
  authRpcResolveOrganizationAccountIdentityInputSchema,
  authRpcResolveOrganizationAccountIdentityResultSchema,
  authRpcResolveOrganizationDirectoryAgentProfilesInputSchema,
  authRpcResolveOrganizationDirectoryAgentProfilesResultSchema,
  authRpcResolveOrganizationDirectoryMembersInputSchema,
  authRpcResolveOrganizationDirectoryMembersResultSchema,
  authRpcResolveProfileInputSchema,
  authRpcResolveProfileResultSchema,
  authRpcResolveRequestAuthInputSchema,
  authRpcResolveRequestAuthResultSchema,
  authRpcResolveRequestAuthWithProfileInputSchema,
  authRpcResolveRequestAuthWithProfileResultSchema,
  authRpcResolveUserDisplayNameInputSchema,
  authRpcResolveUserDisplayNameResultSchema,
  authRpcSendInboxUrgentEmailInputSchema,
  authRpcSendInboxUrgentEmailResultSchema,
  buildDefaultCenterAgentProfileName,
  ensureMessageChannelMemberOrganizationMembershipRpcInputSchema,
  ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema,
  ensureOrganizationJoinLinkOnBehalfOfRpcInputSchema,
  ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema,
  ensureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema,
  ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema,
  organizationLogoCommitRpcInputSchema,
  organizationLogoPrepareRpcInputSchema,
  resolvedOpenMeldProfileSchema,
  slackOAuthOrganizationMembershipInputSchema,
} from "@openmeld/schemas";
import type {
  AccountAvatarCommitRpcResponse,
  AccountAvatarPrepareRpcResponse,
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
  AuthRpcResolveOrganizationDirectoryAgentProfilesInput,
  AuthRpcResolveOrganizationDirectoryAgentProfilesResult,
  AuthRpcResolveOrganizationDirectoryMembersInput,
  AuthRpcResolveOrganizationDirectoryMembersResult,
  AuthRpcResolveProfileInput,
  AuthRpcResolveProfileResult,
  AuthRpcResolveRequestAuthWithProfileInput,
  AuthRpcResolveRequestAuthWithProfileResult,
  AuthRpcResolveUserDisplayNameInput,
  AuthRpcResolveUserDisplayNameResult,
  AuthRpcSendInboxUrgentEmailResult,
  EnsureMessageChannelMemberOrganizationMembershipRpcInput,
  EnsureMessageChannelMemberOrganizationMembershipRpcResponse,
  EnsureOrganizationJoinLinkOnBehalfOfRpcInput,
  EnsureOrganizationJoinLinkOnBehalfOfRpcResponse,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput,
  EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse,
  OrganizationLogoCommitRpcResponse,
  OrganizationLogoPrepareRpcResponse,
  ProfileErrorResponse,
  ProfileRpcErrorResponse,
  ResolvedOpenMeldProfile,
  SlackOAuthOrganizationMembershipInput,
  SlackOAuthOrganizationMembershipResult,
} from "@openmeld/schemas/types";
import { loadBetterAuthRuntime } from "../../lazy-runtime-modules";
import { getLocalAuthUserStore } from "../better-auth/local-auth-user-store";
import { getOrganizationServerApi } from "../better-auth/organization-server-api";
import { readRefreshedAuthSessionCookies } from "../better-auth/refresh-session-cookie";
import {
  AUTH_UPSTREAM_UNREACHABLE_CODE,
  AUTH_UPSTREAM_UNREACHABLE_MESSAGE,
  resolveSessionFromHeaders,
  toSessionResolutionErrorLog,
} from "../better-auth/session-resolver";
import type { AuthBindings } from "../bindings";
import { buildAuthRuntimeDbFactSnapshot } from "../db/fact-snapshots";
import { app } from "../hono/create-hono-app";
import {
  buildInboxItemUrl,
  buildInboxUrgentEmail,
  classifyInboxEmailError,
} from "../inbox/urgent-email";
import {
  type AuthenticatedOrganizationContext,
  resolveAuthenticatedOrganizationContext,
} from "../organization/authenticated-organization-context";
import { reconcileDeletedAgentProfileMemberships } from "../profiles/deleted-profile-reconcile";
import { listMembershipSpaceIdsForProfiles } from "../profiles/membership-space-access";
import {
  projectSpaceIndexMembershipOverlay,
  type SpaceIndexOverlayProjectionResult,
} from "../profiles/overlay-reconcile";
import {
  toProfileHttpErrorResponse,
  toProfileRpcErrorResponse,
} from "../profiles/profile-error-response";
import { getOpenMeldProfileService } from "../profiles/service";
import { logError, logWarn } from "../utils/loggers";

const OPENMELD_REQUEST_ID_HEADER = "x-openmeld-request-id";
const INTEGER_TEXT_RE = /^-?\d+$/;

// Guardrail: do not reintroduce `profileId` in this RPC item.
// OpenMeld profile identity must stay on `openMeldProfileId` only.
type OpenMeldProfileRpcItem = {
  openMeldProfileId: string;
  profileName: string;
  profileHandle: string;
  profileKind: AuthProfileKind;
  isDefault: boolean;
  status: "active" | "disabled";
  ownerUserId: string;
  ownerName?: string;
  avatarUrl?: string;
  source: string;
  managedRole: OpenMeldProfileManagedRole | null;
  defaultProjectId?: string | null;
  createdByUserId: string | null;
  creationActorProfileId: string | null;
  creatorProfileId: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const HTTPS_USER_IMAGE_URL_PATTERN = /^https?:\/\//i;
const MAX_USER_IMAGE_URL_LENGTH = 2048;

/**
 * Avatar/user image URLs travel with the Profile as a public identity field.
 * Only http(s) URLs are accepted so the value is safe to render as an
 * `<img src>` on clients (rejects javascript:/data: injection vectors).
 */
function normalizeOptionalUserImageUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_USER_IMAGE_URL_LENGTH) {
    return null;
  }
  return HTTPS_USER_IMAGE_URL_PATTERN.test(trimmed) ? trimmed : null;
}

type ListProfilesRpcResult =
  | {
      ok: true;
      profiles: OpenMeldProfileRpcItem[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type ResolveProfileByIdRpcInput = {
  openMeldProfileId?: string | null;
};

type ResolveProfileByIdRpcResult =
  | {
      ok: true;
      profile: {
        profileId: string;
        profileName: string;
        profileHandle: string;
        profileKind: AuthProfileKind;
        status: "active" | "disabled";
        ownerUserId: string;
        organizationId: string | null;
        defaultProjectId?: string | null;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type ListProfileLineageRpcInput = {
  ownerUserId?: string | null;
};

type ListProfileLineageRpcResult =
  | {
      ok: true;
      profiles: Array<{
        profileId: string;
        creatorProfileId: string | null;
      }>;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type CreateAgentProfileRpcInput = ResolveRequestAuthInput & {
  profileName: string;
  creatorProfileId?: string | null;
  idempotencyKey?: string | null;
};

type CreateAgentProfileRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type CreateAgentProfileInOrganizationRpcInput = {
  organizationId?: string | null;
  ownerUserId?: string | null;
  createdByUserId?: string | null;
  creationActorProfileId?: string | null;
  creatorProfileId?: string | null;
  idempotencyKey?: string | null;
  profileName: string;
  source?: OpenMeldProfileSource;
};

type CreateAgentProfileInOrganizationRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type EnsureManagedAgentProfileRpcInput = ResolveRequestAuthInput & {
  profileName: string;
  managedRole: OpenMeldProfileManagedRole;
  creatorProfileId?: string | null;
};

type EnsureCenterAgentProfileInOrganizationRpcInput = {
  organizationId?: string | null;
  ownerUserId?: string | null;
};

type UpdateCenterAgentProfileInOrganizationRpcInput = {
  organizationId?: string | null;
  profileId?: string | null;
  profileName?: string | null;
};

type EnsureManagedAgentProfileRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type CreateHumanProfileRpcInput = ResolveRequestAuthInput & {
  profileName: string;
  creatorProfileId?: string | null;
};

type CreateHumanProfileRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | Extract<ResolveRequestAuthResult, { ok: false }>
  | ProfileRpcErrorResponse;

type UpdateProfileRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  profileName?: string;
};

type UpdateProfileRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type UpdateAgentProfileDefaultProjectInOrganizationRpcInput = {
  defaultProjectId: string | null;
  organizationId?: string | null;
  ownerUserId?: string | null;
  profileId?: string | null;
};

type DeleteProfileRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
};

type DeleteProfileRpcResult =
  | {
      ok: true;
      profile: OpenMeldProfileRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type OpenMeldProfileSpaceHistoryRpcItem = {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  spaceName: string | null;
  creatorProfileId: string | null;
  creatorKind: OpenMeldProfileSpaceCreatorKind | null;
  spaceCreatedAt: string | null;
  spaceUpdatedAt: string | null;
  lastJoinedAt: string;
  lastSeenTs: number | null;
  pinnedAt: string | null;
  status: OpenMeldProfileSpaceHistoryStatus;
  createdAt: string;
  updatedAt: string;
};

type ListProfileSpaceHistoryRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  gatewayHost: string;
  status?: OpenMeldProfileSpaceHistoryStatus[];
  pinned?: boolean;
  limit?: number;
};

type ListProfileSpaceHistoryRpcResult =
  | {
      ok: true;
      items: OpenMeldProfileSpaceHistoryRpcItem[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type UpsertProfileSpaceHistoryRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  spaceId: string;
  gatewayHost: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  spaceCreatedAt?: string | null;
  spaceUpdatedAt?: string | null;
  lastJoinedAt?: string;
  lastSeenTs?: number | null;
  pinnedAt?: string | null;
  status?: OpenMeldProfileSpaceHistoryStatus;
};

type UpsertProfileSpaceHistoryRpcResult =
  | {
      ok: true;
      item: OpenMeldProfileSpaceHistoryRpcItem;
      spaceIndexOverlay: SpaceIndexOverlayProjectionResult;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type UpdateProfileSpaceHistoryStatusRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  spaceId: string;
  gatewayHost: string;
  status: OpenMeldProfileSpaceHistoryStatus;
  reason?: string;
};

type UpdateProfileSpaceHistoryStatusRpcResult =
  | {
      ok: true;
      item: {
        profileId: string;
        gatewayHost: string;
        spaceId: string;
        status: OpenMeldProfileSpaceHistoryStatus;
        updatedAt: string;
      };
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type OpenMeldSpaceDeletionTombstoneRpcItem = {
  gatewayHost: string;
  spaceId: string;
  spaceName: string | null;
  creatorProfileId: string | null;
  creatorKind: OpenMeldProfileSpaceCreatorKind | null;
  deletedByProfileId: string | null;
  deletedByProfileName: string | null;
  deletedByOwnerUserId: string | null;
  deletedAt: string;
  createdAt: string;
  updatedAt: string;
};

type QuerySpaceDeletionTombstonesRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  gatewayHost: string;
  spaceIds: string[];
};

type QuerySpaceDeletionTombstonesRpcResult =
  | {
      ok: true;
      items: OpenMeldSpaceDeletionTombstoneRpcItem[];
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type UpsertSpaceDeletionTombstoneRpcInput = ResolveRequestAuthInput & {
  openMeldProfileId?: string;
  spaceId: string;
  gatewayHost: string;
  spaceName?: string | null;
  creatorProfileId?: string | null;
  creatorKind?: OpenMeldProfileSpaceCreatorKind | null;
  deletedByProfileId?: string | null;
  deletedByProfileName?: string | null;
  deletedByOwnerUserId?: string | null;
  deletedAt?: string;
};

type UpsertSpaceDeletionTombstoneRpcResult =
  | {
      ok: true;
      item: OpenMeldSpaceDeletionTombstoneRpcItem;
    }
  | {
      ok: false;
      code: string;
      message: string;
    };

type ResolveSessionClaimsResult =
  | {
      status: "authenticated";
      claims: AuthClaims;
    }
  | {
      status: "unauthenticated";
    }
  | {
      status: "error";
      code: string;
      message: string;
    };

type OrganizationMembershipRow = {
  organization_id: string;
  organization_name: string;
  role: string;
};

type UserDisplayNameRow = {
  email: string | null;
  id: string;
  name: string | null;
};

type InboxUrgentEmailRecipientRow = {
  email_verified: boolean | number;
  organization_slug: string;
  user_email: string;
};

type OrganizationAccountIdentityRow = {
  human_profile_id: string | null;
  human_profile_name: string | null;
  member_count: number;
  member_id: string | null;
  member_role: string | null;
  organization_id: string;
  organization_metadata: string | null;
  organization_name: string;
  organization_slug: string;
  user_email: string | null;
  user_id: string | null;
  user_name: string | null;
};

type OrganizationDirectoryMemberIdentityRow = {
  human_profile_handle: string | null;
  human_profile_id: string | null;
  human_profile_last_used_at: number | null;
  human_profile_name: string | null;
  human_profile_status: "active" | "disabled" | null;
  member_created_at: number;
  member_id: string;
  organization_id: string;
  role: string;
  user_email: string;
  user_id: string;
  user_image: string | null;
  user_name: string | null;
};

type OrganizationDirectoryAgentProfileIdentityRow = {
  created_at: number;
  created_by_user_id: string | null;
  creator_profile_id: string | null;
  last_used_at: number | null;
  managed_role: OpenMeldProfileManagedRole | null;
  organization_id: string;
  owner_name: string | null;
  owner_user_id: string;
  profile_handle: string;
  profile_id: string;
  profile_name: string;
  source: string;
  status: "active" | "disabled";
  updated_at: number;
};

export class AuthRpcEntrypoint extends WorkerEntrypoint<AuthBindings> {
  fetch(request: Request): Promise<Response> {
    return Promise.resolve(app.fetch(request, this.env, this.ctx));
  }

  ping() {
    return { ok: true, service: AUTH_SERVICE_NAME } as const;
  }

  inspectDbState() {
    return buildAuthRuntimeDbFactSnapshot(this.env);
  }

  async prepareAccountAvatarMutation(
    input: unknown
  ): Promise<AccountAvatarPrepareRpcResponse> {
    const parsed = accountAvatarPrepareRpcInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        code: "account.avatar.invalid_input",
        message: "Account avatar request is invalid.",
        ok: false,
      };
    }
    try {
      return await this.getAccountAvatarService().prepare(parsed.data);
    } catch (error) {
      logAccountAvatarRpcFailure({
        actorUserId: parsed.data.actorUserId,
        error,
        operation: "prepare",
      });
      return {
        code: "account.avatar.internal_error",
        message: "Account avatar settings are temporarily unavailable.",
        ok: false,
      };
    }
  }

  async commitAccountAvatarMutation(
    input: unknown
  ): Promise<AccountAvatarCommitRpcResponse> {
    const parsed = accountAvatarCommitRpcInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        code: "account.avatar.invalid_input",
        message: "Account avatar request is invalid.",
        ok: false,
      };
    }
    try {
      const committed = await this.getAccountAvatarService().commit(
        parsed.data
      );
      if (!(committed.ok && parsed.data.headers)) {
        return committed;
      }
      let sessionCookies: string[] = [];
      try {
        sessionCookies = await readRefreshedAuthSessionCookies({
          auth: await this.getAuth(),
          headers: new Headers(parsed.data.headers),
        });
      } catch (error) {
        // The compare-and-set above is authoritative once it succeeds. A
        // secondary cookie refresh must never turn that committed write into a
        // reported failure that causes Gateway to delete the referenced asset.
        logAccountAvatarRpcFailure({
          actorUserId: parsed.data.actorUserId,
          error,
          operation: "refresh_session",
        });
      }
      return {
        ...committed,
        ...(sessionCookies.length > 0 ? { sessionCookies } : {}),
      };
    } catch (error) {
      logAccountAvatarRpcFailure({
        actorUserId: parsed.data.actorUserId,
        error,
        operation: "commit",
      });
      return {
        code: "account.avatar.internal_error",
        message: "Account avatar settings are temporarily unavailable.",
        ok: false,
      };
    }
  }

  async prepareOrganizationLogoMutation(
    input: unknown
  ): Promise<OrganizationLogoPrepareRpcResponse> {
    const parsed = organizationLogoPrepareRpcInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        code: "organization.logo.invalid_input",
        message: "Organization logo request is invalid.",
        ok: false,
      };
    }
    try {
      return await this.getOrganizationLogoService().prepare(parsed.data);
    } catch (error) {
      logOrganizationLogoRpcFailure({
        error,
        operation: "prepare",
        organizationId: parsed.data.organizationId,
      });
      return {
        code: "organization.logo.internal_error",
        message: "Organization logo settings are temporarily unavailable.",
        ok: false,
      };
    }
  }

  async commitOrganizationLogoMutation(
    input: unknown
  ): Promise<OrganizationLogoCommitRpcResponse> {
    const parsed = organizationLogoCommitRpcInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        code: "organization.logo.invalid_input",
        message: "Organization logo request is invalid.",
        ok: false,
      };
    }
    try {
      return await this.getOrganizationLogoService().commit(parsed.data);
    } catch (error) {
      logOrganizationLogoRpcFailure({
        error,
        operation: "commit",
        organizationId: parsed.data.organizationId,
      });
      return {
        code: "organization.logo.internal_error",
        message: "Organization logo settings are temporarily unavailable.",
        ok: false,
      };
    }
  }

  async resolveOrganizationMembership(
    input: SlackOAuthOrganizationMembershipInput
  ): Promise<SlackOAuthOrganizationMembershipResult> {
    const parsed = slackOAuthOrganizationMembershipInputSchema.safeParse(input);
    if (!parsed.success) {
      return { status: "not_member" };
    }
    const { organizationId, userId } = parsed.data;

    const row = await this.env.OPENMELD_DB.prepare(
      `
        SELECT
          organizations.id AS organization_id,
          organizations.name AS organization_name,
          members.role AS role
        FROM members
        INNER JOIN organizations
          ON organizations.id = members.organization_id
        WHERE members.organization_id = ?
          AND members.user_id = ?
        LIMIT 1
      `
    )
      .bind(organizationId, userId)
      .first<OrganizationMembershipRow>();
    const organizationName = normalizeOptionalText(row?.organization_name);
    const role = normalizeOptionalText(row?.role);
    if (
      !(row?.organization_id === organizationId && organizationName && role)
    ) {
      return { status: "not_member" };
    }
    return {
      organizationId,
      organizationName,
      role,
      status: "member",
    };
  }

  async sendInboxUrgentEmail(
    input: unknown
  ): Promise<AuthRpcSendInboxUrgentEmailResult> {
    const parsed = authRpcSendInboxUrgentEmailInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        code: "email_request_invalid",
        deliveryId: readInboxEmailDeliveryId(input),
        retryable: false,
        status: "failed",
      });
    }
    const request = parsed.data;

    let recipient: InboxUrgentEmailRecipientRow | null;
    try {
      recipient = await this.env.OPENMELD_DB.prepare(
        `
          SELECT
            organizations.slug AS organization_slug,
            users.email AS user_email,
            users.email_verified AS email_verified
          FROM members
          INNER JOIN organizations
            ON organizations.id = members.organization_id
          INNER JOIN users
            ON users.id = members.user_id
          WHERE members.organization_id = ?
            AND members.user_id = ?
          LIMIT 1
        `
      )
        .bind(request.organizationId, request.userId)
        .first<InboxUrgentEmailRecipientRow>();
    } catch (error) {
      logInboxUrgentEmailFailure({
        code: "email_send_transient",
        deliveryId: request.deliveryId,
        error,
        itemId: request.itemId,
        organizationId: request.organizationId,
        phase: "recipient_lookup",
        retryable: true,
      });
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        code: "email_send_transient",
        deliveryId: request.deliveryId,
        retryable: true,
        status: "failed",
      });
    }

    if (!recipient) {
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        deliveryId: request.deliveryId,
        reason: "recipient_not_member",
        status: "suppressed",
      });
    }

    const recipientEmail = normalizeOptionalText(recipient.user_email);
    const isVerified =
      recipient.email_verified === true || recipient.email_verified === 1;
    if (!(recipientEmail && isVerified)) {
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        deliveryId: request.deliveryId,
        reason: "recipient_has_no_email",
        status: "suppressed",
      });
    }

    const organizationSlug = normalizeOptionalText(recipient.organization_slug);
    const inboxUrl = organizationSlug
      ? buildInboxItemUrl({
          itemId: request.itemId,
          organizationSlug,
          webAppUrl: this.env.WEB_APP_URL,
        })
      : null;
    if (!inboxUrl) {
      logInboxUrgentEmailFailure({
        code: "email_send_rejected",
        deliveryId: request.deliveryId,
        itemId: request.itemId,
        organizationId: request.organizationId,
        phase: "link_construction",
        retryable: false,
      });
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        code: "email_send_rejected",
        deliveryId: request.deliveryId,
        retryable: false,
        status: "failed",
      });
    }

    const from = normalizeOptionalText(this.env.AUTH_FROM_EMAIL);
    if (!from) {
      logInboxUrgentEmailFailure({
        code: "email_sender_not_verified",
        deliveryId: request.deliveryId,
        itemId: request.itemId,
        organizationId: request.organizationId,
        phase: "sender_configuration",
        retryable: false,
      });
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        code: "email_sender_not_verified",
        deliveryId: request.deliveryId,
        retryable: false,
        status: "failed",
      });
    }
    const email = buildInboxUrgentEmail({
      from,
      inboxUrl,
      preview: request.preview,
      title: request.title,
    });
    try {
      const sendResult = await this.env.AUTH_EMAIL.send({
        ...email,
        to: recipientEmail,
      });
      const messageId = normalizeOptionalText(sendResult.messageId);
      if (!(messageId && messageId.length <= 998)) {
        logInboxUrgentEmailFailure({
          code: "email_send_rejected",
          deliveryId: request.deliveryId,
          itemId: request.itemId,
          organizationId: request.organizationId,
          phase: "provider_response",
          retryable: false,
        });
        return authRpcSendInboxUrgentEmailResultSchema.parse({
          code: "email_send_rejected",
          deliveryId: request.deliveryId,
          retryable: false,
          status: "failed",
        });
      }
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        deliveryId: request.deliveryId,
        messageId,
        status: "sent",
      });
    } catch (error) {
      const failure = classifyInboxEmailError(error);
      logInboxUrgentEmailFailure({
        ...failure,
        deliveryId: request.deliveryId,
        error,
        itemId: request.itemId,
        organizationId: request.organizationId,
        phase: "provider_send",
      });
      return authRpcSendInboxUrgentEmailResultSchema.parse({
        code: failure.code,
        deliveryId: request.deliveryId,
        retryable: failure.retryable,
        status: "failed",
      });
    }
  }

  async resolveUserDisplayName(
    input: AuthRpcResolveUserDisplayNameInput
  ): Promise<AuthRpcResolveUserDisplayNameResult> {
    const parsed = authRpcResolveUserDisplayNameInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveUserDisplayNameResultSchema.parse({
        code: "bad_request",
        message: "User identity request is invalid.",
        ok: false,
      });
    }

    try {
      const row = await this.env.OPENMELD_DB.prepare(
        `
          SELECT id, name, email
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
        .bind(parsed.data.userId)
        .first<UserDisplayNameRow>();
      const displayName =
        normalizeOptionalText(row?.name) ?? normalizeOptionalText(row?.email);
      if (!(row?.id === parsed.data.userId && displayName)) {
        return authRpcResolveUserDisplayNameResultSchema.parse({
          code: "auth.user_identity_unavailable",
          message: "User identity is unavailable.",
          ok: false,
        });
      }
      return authRpcResolveUserDisplayNameResultSchema.parse({
        displayName,
        ok: true,
        userId: row.id,
      });
    } catch (error) {
      logError("[auth.rpc.user_display_name_resolution_failed]", {
        error,
        userId: parsed.data.userId,
      });
      return authRpcResolveUserDisplayNameResultSchema.parse({
        code: "auth.user_identity_unavailable",
        message: "User identity is temporarily unavailable.",
        ok: false,
      });
    }
  }

  async resolveOrganizationAccountIdentity(
    input: AuthRpcResolveOrganizationAccountIdentityInput
  ): Promise<AuthRpcResolveOrganizationAccountIdentityResult> {
    const parsed =
      authRpcResolveOrganizationAccountIdentityInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveOrganizationAccountIdentityResultSchema.parse({
        code: "bad_request",
        message: "Organization account identity request is invalid.",
        ok: false,
      });
    }

    const account = parsed.data.account;
    const accountSelection = resolveOrganizationAccountSelection(account);
    try {
      const statement = this.env.OPENMELD_DB.prepare(
        `
          SELECT
            organizations.id AS organization_id,
            organizations.name AS organization_name,
            organizations.slug AS organization_slug,
            organizations.metadata AS organization_metadata,
            (
              SELECT COUNT(*)
              FROM members AS organization_members
              WHERE organization_members.organization_id = organizations.id
            ) AS member_count,
            users.id AS user_id,
            users.name AS user_name,
            users.email AS user_email,
            members.id AS member_id,
            members.role AS member_role,
            human_profiles.profile_id AS human_profile_id,
            human_profiles.profile_name AS human_profile_name
          FROM organizations
          LEFT JOIN users
            ON ${accountSelection.joinCondition}
          LEFT JOIN members
            ON members.organization_id = organizations.id
            AND members.user_id = users.id
          LEFT JOIN openmeld_profiles AS human_profiles
            ON human_profiles.owner_user_id = users.id
            AND human_profiles.organization_id IS NULL
            AND human_profiles.profile_kind = 'human'
            AND human_profiles.is_default = 1
            AND human_profiles.status = 'active'
          WHERE organizations.id = ?
          LIMIT 1
        `
      );
      const row = await (accountSelection.value
        ? statement.bind(accountSelection.value, parsed.data.organizationId)
        : statement.bind(parsed.data.organizationId)
      ).first<OrganizationAccountIdentityRow>();
      if (!row) {
        return authRpcResolveOrganizationAccountIdentityResultSchema.parse({
          code: "auth.organization_identity_unavailable",
          message: "Organization identity is unavailable.",
          ok: false,
        });
      }
      return authRpcResolveOrganizationAccountIdentityResultSchema.parse({
        ...mapOrganizationAccountIdentityRow(row),
        ok: true,
      });
    } catch (error) {
      logError("[auth.rpc.organization_account_identity_resolution_failed]", {
        accountKind: account?.kind ?? null,
        error,
        organizationId: parsed.data.organizationId,
      });
      return authRpcResolveOrganizationAccountIdentityResultSchema.parse({
        code: "auth.organization_identity_unavailable",
        message: "Organization identity is temporarily unavailable.",
        ok: false,
      });
    }
  }

  async resolveOrganizationDirectoryMembers(
    input: AuthRpcResolveOrganizationDirectoryMembersInput
  ): Promise<AuthRpcResolveOrganizationDirectoryMembersResult> {
    const parsed =
      authRpcResolveOrganizationDirectoryMembersInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveOrganizationDirectoryMembersResultSchema.parse({
        code: "bad_request",
        message: "Organization Directory member request is invalid.",
        ok: false,
      });
    }

    try {
      const result = await this.env.OPENMELD_DB.prepare(
        `
          SELECT
            members.id AS member_id,
            members.organization_id AS organization_id,
            members.user_id AS user_id,
            members.role AS role,
            members.created_at AS member_created_at,
            users.name AS user_name,
            users.email AS user_email,
            users.image AS user_image,
            human_profiles.profile_id AS human_profile_id,
            human_profiles.profile_name AS human_profile_name,
            human_profiles.profile_handle AS human_profile_handle,
            human_profiles.last_used_at AS human_profile_last_used_at,
            human_profiles.status AS human_profile_status
          FROM members
          INNER JOIN users
            ON users.id = members.user_id
          LEFT JOIN openmeld_profiles AS human_profiles
            ON human_profiles.owner_user_id = members.user_id
            AND human_profiles.organization_id IS NULL
            AND human_profiles.profile_kind = 'human'
            AND human_profiles.is_default = 1
          WHERE members.organization_id = ?
          ORDER BY lower(users.name) ASC, users.id ASC
        `
      )
        .bind(parsed.data.organizationId)
        .all<OrganizationDirectoryMemberIdentityRow>();
      return authRpcResolveOrganizationDirectoryMembersResultSchema.parse({
        members: (result.results ?? []).map(
          mapOrganizationDirectoryMemberIdentityRow
        ),
        ok: true,
        organizationId: parsed.data.organizationId,
      });
    } catch (error) {
      logError("[auth.rpc.organization_directory_members_failed]", {
        error,
        organizationId: parsed.data.organizationId,
      });
      return authRpcResolveOrganizationDirectoryMembersResultSchema.parse({
        code: "auth.organization_directory_unavailable",
        message: "Organization Directory members are temporarily unavailable.",
        ok: false,
      });
    }
  }

  async resolveOrganizationDirectoryAgentProfiles(
    input: AuthRpcResolveOrganizationDirectoryAgentProfilesInput
  ): Promise<AuthRpcResolveOrganizationDirectoryAgentProfilesResult> {
    const parsed =
      authRpcResolveOrganizationDirectoryAgentProfilesInputSchema.safeParse(
        input
      );
    if (!parsed.success) {
      return authRpcResolveOrganizationDirectoryAgentProfilesResultSchema.parse(
        {
          code: "bad_request",
          message: "Organization Directory Agent Profile request is invalid.",
          ok: false,
        }
      );
    }

    const additionalAgentProfileIds = [
      ...new Set(parsed.data.additionalAgentProfileIds),
    ];
    try {
      const organizationProfilesPromise = this.env.OPENMELD_DB.prepare(
        buildOrganizationDirectoryAgentProfileIdentitySql("organization")
      )
        .bind(parsed.data.organizationId)
        .all<OrganizationDirectoryAgentProfileIdentityRow>();
      const additionalProfilesPromise =
        additionalAgentProfileIds.length === 0
          ? Promise.resolve({ results: [] })
          : this.env.OPENMELD_DB.prepare(
              buildOrganizationDirectoryAgentProfileIdentitySql("additional")
            )
              .bind(
                parsed.data.organizationId,
                JSON.stringify(additionalAgentProfileIds)
              )
              .all<OrganizationDirectoryAgentProfileIdentityRow>();
      const [organizationProfiles, additionalProfiles] = await Promise.all([
        organizationProfilesPromise,
        additionalProfilesPromise,
      ]);
      return authRpcResolveOrganizationDirectoryAgentProfilesResultSchema.parse(
        {
          additionalAgentProfiles: (additionalProfiles.results ?? []).map(
            mapOrganizationDirectoryAgentProfileIdentityRow
          ),
          ok: true,
          organizationAgentProfiles: (organizationProfiles.results ?? []).map(
            mapOrganizationDirectoryAgentProfileIdentityRow
          ),
          organizationId: parsed.data.organizationId,
        }
      );
    } catch (error) {
      logError("[auth.rpc.organization_directory_agent_profiles_failed]", {
        additionalAgentProfileCount: additionalAgentProfileIds.length,
        error,
        organizationId: parsed.data.organizationId,
      });
      return authRpcResolveOrganizationDirectoryAgentProfilesResultSchema.parse(
        {
          code: "auth.organization_directory_unavailable",
          message:
            "Organization Directory Agent Profiles are temporarily unavailable.",
          ok: false,
        }
      );
    }
  }

  async listProfiles(
    input: ResolveRequestAuthInput = {}
  ): Promise<ListProfilesRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profiles =
        await this.getProfileService().listProfilesForOwnerEnsuringPrimaryHumanProfile(
          {
            ownerUserId: resolved.userId,
            userName: resolved.userName,
            userEmail: resolved.userEmail,
          }
        );

      return {
        ok: true,
        profiles: profiles.map((profile) =>
          toOpenMeldProfileRpcItem(profile, {
            ownerName: resolved.userName,
            avatarUrl: resolved.userImage,
          })
        ),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async resolveProfile(
    input: AuthRpcResolveProfileInput = {}
  ): Promise<AuthRpcResolveProfileResult> {
    const parsed = authRpcResolveProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveProfileResultSchema.parse({
        code: "bad_request",
        message: "Auth request is invalid.",
        ok: false,
      });
    }
    const resolved = await this.resolveAuthenticatedUser(parsed.data);
    if (!resolved.ok) {
      return authRpcResolveProfileResultSchema.parse(resolved);
    }

    try {
      const profile = await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId: parsed.data.openMeldProfileId,
        profileKind: parsed.data.profileKind,
        fallbackUserName: resolved.userName,
        fallbackUserEmail: resolved.userEmail,
      });

      return authRpcResolveProfileResultSchema.parse({
        ok: true,
        resolvedProfile: toResolvedOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      });
    } catch (error) {
      return authRpcResolveProfileResultSchema.parse(toProfileRpcError(error));
    }
  }

  async resolveProfileById(
    input: ResolveProfileByIdRpcInput = {}
  ): Promise<ResolveProfileByIdRpcResult> {
    try {
      const profileId = normalizeOptionalText(input.openMeldProfileId);
      if (!profileId) {
        return {
          ok: false,
          code: "profile.invalid",
          message: "openMeldProfileId is required",
        };
      }

      const profile =
        await this.getProfileService().resolveProfileById(profileId);
      if (!profile) {
        return {
          ok: false,
          code: "profile.not_found",
          message: "profile not found",
        };
      }

      return {
        ok: true,
        profile: {
          profileId: profile.profileId,
          profileName: profile.profileName,
          profileHandle: profile.profileHandle,
          profileKind: profile.profileKind,
          status: profile.status,
          ownerUserId: profile.ownerUserId,
          organizationId: normalizeOptionalText(profile.organizationId),
          ...(profile.profileKind === "agent" &&
          normalizeProfileManagedRole(profile.managedRole) === null
            ? {
                defaultProjectId: normalizeOptionalText(
                  profile.defaultProjectId
                ),
              }
            : {}),
        },
      };
    } catch (error) {
      const profileError = toProfileRpcError(error);
      return {
        ok: false,
        code: profileError.code,
        message: profileError.message,
      };
    }
  }

  async listProfileLineage(
    input: ListProfileLineageRpcInput = {}
  ): Promise<ListProfileLineageRpcResult> {
    const ownerUserId = normalizeOptionalText(input.ownerUserId);
    if (!ownerUserId) {
      return {
        ok: false,
        code: "profile.owner_user_id_required",
        message: "ownerUserId is required",
      };
    }

    try {
      const profiles =
        await this.getProfileService().listResolvedProfileLineageForOwner(
          ownerUserId
        );
      return {
        ok: true,
        profiles: profiles.map((profile) => ({
          profileId: profile.profileId,
          creatorProfileId: profile.creatorProfileId ?? null,
        })),
      };
    } catch (error) {
      return {
        ok: false,
        code: "profile.list_lineage_failed",
        message:
          normalizeOptionalText(
            error instanceof Error ? error.message : null
          ) ?? "failed to list profile lineage",
      };
    }
  }

  async createAgentProfile(
    input: CreateAgentProfileRpcInput
  ): Promise<CreateAgentProfileRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const activeOrganizationId =
        requireActiveOrganizationIdForAgentProfileRpc(resolved);
      if (!activeOrganizationId.ok) {
        return activeOrganizationId;
      }
      const idempotencyKey = normalizeOptionalText(input.idempotencyKey);
      const profile = await this.getProfileService().createAgentProfile({
        ownerUserId: resolved.userId,
        organizationId: activeOrganizationId.value,
        createdByUserId: resolved.userId,
        creationActorProfileId: normalizeOptionalText(input.creatorProfileId),
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        profileName: input.profileName,
        source: "cli_create",
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async createAgentProfileInOrganization(
    input: CreateAgentProfileInOrganizationRpcInput
  ): Promise<CreateAgentProfileInOrganizationRpcResult> {
    const organizationId = normalizeOptionalText(input.organizationId);
    const ownerUserId = normalizeOptionalText(input.ownerUserId);
    const createdByUserId =
      normalizeOptionalText(input.createdByUserId) ?? ownerUserId;
    const idempotencyKey = normalizeOptionalText(input.idempotencyKey);
    if (!(organizationId && ownerUserId && createdByUserId)) {
      return {
        ok: false,
        code: "organization.context_required",
        message:
          "organizationId, ownerUserId, and createdByUserId are required",
      };
    }

    try {
      const profile = await this.getProfileService().createAgentProfile({
        ownerUserId,
        organizationId,
        createdByUserId,
        creationActorProfileId: normalizeOptionalText(
          input.creationActorProfileId
        ),
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
        ...(idempotencyKey ? { idempotencyKey } : {}),
        profileName: input.profileName,
        source: input.source ?? "center_agent_create",
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async ensureOrganizationJoinLinkOnBehalfOf(
    input: EnsureOrganizationJoinLinkOnBehalfOfRpcInput
  ): Promise<EnsureOrganizationJoinLinkOnBehalfOfRpcResponse> {
    const request =
      ensureOrganizationJoinLinkOnBehalfOfRpcInputSchema.safeParse(input);
    if (!request.success) {
      return ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema.parse({
        code: "organization.join_link.invalid_input",
        message: "Organization invite-link ensure request is invalid.",
        ok: false,
      });
    }

    try {
      return ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema.parse({
        ...(await this.getOrganizationJoinLinkService().ensure(request.data)),
        ok: true,
      });
    } catch (error) {
      if (!(error instanceof OrganizationJoinLinkServiceError)) {
        throw error;
      }
      const response =
        ensureOrganizationJoinLinkOnBehalfOfRpcResponseSchema.safeParse({
          code: error.code,
          message: error.message,
          ok: false,
        });
      if (!response.success) {
        throw error;
      }
      return response.data;
    }
  }

  async ensureSlackWorkspaceMemberOrganizationMembership(
    input: EnsureSlackWorkspaceMemberOrganizationMembershipRpcInput
  ): Promise<EnsureSlackWorkspaceMemberOrganizationMembershipRpcResponse> {
    const request =
      ensureSlackWorkspaceMemberOrganizationMembershipRpcInputSchema.safeParse(
        input
      );
    if (!request.success) {
      return ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema.parse(
        {
          code: "slack.workspace_member_enrollment.invalid_input",
          message: "Slack workspace member enrollment request is invalid.",
          ok: false,
        }
      );
    }
    const result = await this.enrollMessageChannelMember({
      ...request.data,
      provider: "slack",
    });
    return ensureSlackWorkspaceMemberOrganizationMembershipRpcResponseSchema.parse(
      result.ok
        ? result
        : {
            ...result,
            code: result.code.replace(
              "message_channel.member_enrollment.",
              "slack.workspace_member_enrollment."
            ),
          }
    );
  }

  async ensureMessageChannelMemberOrganizationMembership(
    input: EnsureMessageChannelMemberOrganizationMembershipRpcInput
  ): Promise<EnsureMessageChannelMemberOrganizationMembershipRpcResponse> {
    const request =
      ensureMessageChannelMemberOrganizationMembershipRpcInputSchema.safeParse(
        input
      );
    if (!request.success) {
      return ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema.parse(
        {
          code: "message_channel.member_enrollment.invalid_input",
          message: "Message Channel member enrollment request is invalid.",
          ok: false,
        }
      );
    }
    return await this.enrollMessageChannelMember(request.data);
  }

  async ensureManagedAgentProfile(
    input: EnsureManagedAgentProfileRpcInput
  ): Promise<EnsureManagedAgentProfileRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const activeOrganizationId =
        requireActiveOrganizationIdForAgentProfileRpc(resolved);
      if (!activeOrganizationId.ok) {
        return activeOrganizationId;
      }
      const profile = await this.getProfileService().ensureManagedAgentProfile({
        ownerUserId: resolved.userId,
        organizationId: activeOrganizationId.value,
        createdByUserId: resolved.userId,
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
        managedRole: input.managedRole,
        profileName: input.profileName,
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async ensureCenterAgentProfileInOrganization(
    input: EnsureCenterAgentProfileInOrganizationRpcInput
  ): Promise<EnsureManagedAgentProfileRpcResult> {
    const organizationId = normalizeOptionalText(input.organizationId);
    const ownerUserId = normalizeOptionalText(input.ownerUserId);
    if (!(organizationId && ownerUserId)) {
      return {
        ok: false,
        code: "organization.context_required",
        message: "organizationId and ownerUserId are required",
      };
    }

    try {
      const profileName = await resolveCenterAgentDefaultProfileName({
        db: this.env.OPENMELD_DB,
        organizationId,
      });
      const profile = await this.getProfileService().ensureManagedAgentProfile({
        ownerUserId,
        organizationId,
        createdByUserId: ownerUserId,
        creatorProfileId: null,
        managedRole: "center_agent",
        profileName,
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async updateCenterAgentProfileInOrganization(
    input: UpdateCenterAgentProfileInOrganizationRpcInput
  ): Promise<EnsureManagedAgentProfileRpcResult> {
    const organizationId = normalizeOptionalText(input.organizationId);
    const profileId = normalizeOptionalText(input.profileId);
    const profileName = normalizeOptionalText(input.profileName);
    if (!(organizationId && profileId && profileName)) {
      return {
        ok: false,
        code: "organization.context_required",
        message: "organizationId, profileId, and profileName are required",
      };
    }

    try {
      const profile =
        await this.getProfileService().updateManagedAgentProfileInOrganization({
          managedRole: "center_agent",
          organizationId,
          profileId,
          profileName,
        });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async createHumanProfile(
    input: CreateHumanProfileRpcInput
  ): Promise<CreateHumanProfileRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profile = await this.getProfileService().createHumanProfile({
        ownerUserId: resolved.userId,
        createdByUserId: resolved.userId,
        creatorProfileId: normalizeOptionalText(input.creatorProfileId),
        profileName: input.profileName,
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      };
    } catch (error) {
      return toProfileRpcErrorResponse(error);
    }
  }

  async updateProfile(
    input: UpdateProfileRpcInput
  ): Promise<UpdateProfileRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      const profile = await this.getProfileService().updateProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
        ...(normalizeOptionalText(input.profileName)
          ? { profileName: normalizeOptionalText(input.profileName) }
          : {}),
      });

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async updateAgentProfileDefaultProjectInOrganization(
    input: UpdateAgentProfileDefaultProjectInOrganizationRpcInput
  ): Promise<UpdateProfileRpcResult> {
    const organizationId = normalizeOptionalText(input.organizationId);
    const ownerUserId = normalizeOptionalText(input.ownerUserId);
    const profileId = normalizeOptionalText(input.profileId);
    if (!(organizationId && ownerUserId && profileId)) {
      return {
        ok: false,
        code: "organization.context_required",
        message: "organizationId, ownerUserId, and profileId are required",
      };
    }

    try {
      const profile =
        await this.getProfileService().updateAgentProfileDefaultProjectForOwner(
          {
            defaultProjectId: normalizeOptionalText(input.defaultProjectId),
            organizationId,
            ownerUserId,
            profileId,
          }
        );
      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async deleteProfile(
    input: DeleteProfileRpcInput
  ): Promise<DeleteProfileRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      const profile = await this.getProfileService().deleteProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });
      await reconcileDeletedAgentProfileMemberships(this.env, profile);

      return {
        ok: true,
        profile: toOpenMeldProfileRpcItem(profile, {
          ownerName: resolved.userName,
          avatarUrl: resolved.userImage,
        }),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async listProfileSpaceHistory(
    input: ListProfileSpaceHistoryRpcInput
  ): Promise<ListProfileSpaceHistoryRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });

      const items = await this.getProfileService().listProfileSpaceHistory({
        profileId,
        gatewayHost: input.gatewayHost,
        statuses: input.status,
        pinned: input.pinned,
        limit: input.limit,
      });

      return {
        ok: true,
        items: items.map(toProfileSpaceHistoryRpcItem),
      };
    } catch (error) {
      const profileError = toProfileRpcError(error);
      logProfileSpaceHistoryRpcError({
        error,
        input,
        operation: "listProfileSpaceHistory",
        profileError,
      });
      return profileError;
    }
  }

  async upsertProfileSpaceHistory(
    input: UpsertProfileSpaceHistoryRpcInput
  ): Promise<UpsertProfileSpaceHistoryRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });

      const item = await this.getProfileService().upsertProfileSpaceHistory({
        profileId,
        gatewayHost: input.gatewayHost,
        spaceId: input.spaceId,
        spaceName: input.spaceName,
        creatorProfileId: input.creatorProfileId,
        creatorKind: input.creatorKind,
        spaceCreatedAt: input.spaceCreatedAt ?? undefined,
        spaceUpdatedAt: input.spaceUpdatedAt ?? undefined,
        lastJoinedAt: input.lastJoinedAt,
        lastSeenTs: input.lastSeenTs,
        pinnedAt: input.pinnedAt,
        status: input.status,
      });
      const spaceIndexOverlay = await projectSpaceIndexMembershipOverlay({
        coreWorker: this.env.OPENMELD_CORE_WORKER,
        record: item,
      });

      return {
        ok: true,
        item: toProfileSpaceHistoryRpcItem(item),
        spaceIndexOverlay,
      };
    } catch (error) {
      const profileError = toProfileRpcError(error);
      logProfileSpaceHistoryRpcError({
        error,
        input,
        operation: "upsertProfileSpaceHistory",
        profileError,
      });
      return profileError;
    }
  }

  async updateProfileSpaceHistoryStatus(
    input: UpdateProfileSpaceHistoryStatusRpcInput
  ): Promise<UpdateProfileSpaceHistoryStatusRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });

      const item =
        await this.getProfileService().updateProfileSpaceHistoryStatus({
          profileId,
          gatewayHost: input.gatewayHost,
          spaceId: input.spaceId,
          status: input.status,
          reason: input.reason,
        });

      return {
        ok: true,
        item: {
          profileId: item.profileId,
          gatewayHost: item.gatewayHost,
          spaceId: item.spaceId,
          status: item.status,
          updatedAt: toRequiredIsoString(item.updatedAt, "updatedAt"),
        },
      };
    } catch (error) {
      const profileError = toProfileRpcError(error);
      logProfileSpaceHistoryRpcError({
        error,
        input,
        operation: "updateProfileSpaceHistoryStatus",
        profileError,
      });
      return profileError;
    }
  }

  // History alone misses owner-added members (no visit rows, cascade-deleted
  // with the profile), so space access checks union the Space-truth
  // membership projection. A membership read failure falls back to the
  // stricter history-only behavior instead of widening access.
  private async listOwnerAccessibleSpaceIdsWithMembership(input: {
    gatewayHost: string;
    ownerUserId: string;
    spaceIds: string[];
  }): Promise<string[]> {
    const historySpaceIds =
      await this.getProfileService().listOwnerAccessibleSpaceIds({
        ownerUserId: input.ownerUserId,
        gatewayHost: input.gatewayHost,
        spaceIds: input.spaceIds,
      });
    let membershipSpaceIds: string[] = [];
    try {
      const ownerProfiles = await this.getProfileService().listProfilesForOwner(
        input.ownerUserId
      );
      membershipSpaceIds = await listMembershipSpaceIdsForProfiles({
        coreWorker: this.env.OPENMELD_CORE_WORKER,
        profileIds: ownerProfiles
          .filter((profile) => profile.status === "active")
          .map((profile) => profile.profileId),
        spaceIds: input.spaceIds,
      });
    } catch (error) {
      console.warn("[auth.space_access.membership_lookup_failed]", {
        event: "auth.space_access.membership_lookup_failed",
        error: error instanceof Error ? error.message : String(error),
        ownerUserId: input.ownerUserId,
      });
    }
    return [...new Set([...historySpaceIds, ...membershipSpaceIds])];
  }

  async querySpaceDeletionTombstones(
    input: QuerySpaceDeletionTombstonesRpcInput
  ): Promise<QuerySpaceDeletionTombstonesRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });

      const accessibleSpaceIds =
        await this.listOwnerAccessibleSpaceIdsWithMembership({
          ownerUserId: resolved.userId,
          gatewayHost: input.gatewayHost,
          spaceIds: input.spaceIds,
        });
      if (accessibleSpaceIds.length === 0) {
        return {
          ok: true,
          items: [],
        };
      }

      const items = await this.getProfileService().querySpaceDeletionTombstones(
        {
          gatewayHost: input.gatewayHost,
          spaceIds: accessibleSpaceIds,
        }
      );

      return {
        ok: true,
        items: items.map(toSpaceDeletionTombstoneRpcItem),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async upsertSpaceDeletionTombstone(
    input: UpsertSpaceDeletionTombstoneRpcInput
  ): Promise<UpsertSpaceDeletionTombstoneRpcResult> {
    const resolved = await this.resolveAuthenticatedUser(input);
    if (!resolved.ok) {
      return resolved;
    }

    try {
      const profileId = resolveRequiredProfileId(input);
      await this.getProfileService().resolveProfileForOwner({
        ownerUserId: resolved.userId,
        profileId,
      });
      if (
        !isTrustedDeletedByCurrentProfileInput({
          input,
          currentProfileId: profileId,
          currentOwnerUserId: resolved.userId,
        })
      ) {
        const accessibleSpaceIds =
          await this.listOwnerAccessibleSpaceIdsWithMembership({
            ownerUserId: resolved.userId,
            gatewayHost: input.gatewayHost,
            spaceIds: [input.spaceId],
          });
        if (!accessibleSpaceIds.includes(input.spaceId)) {
          throw new ProfileNotFoundError("space not found");
        }
      }

      const item = await this.getProfileService().upsertSpaceDeletionTombstone({
        gatewayHost: input.gatewayHost,
        spaceId: input.spaceId,
        spaceName: input.spaceName,
        creatorProfileId: input.creatorProfileId,
        creatorKind: input.creatorKind,
        deletedByProfileId: input.deletedByProfileId,
        deletedByProfileName: input.deletedByProfileName,
        deletedByOwnerUserId: input.deletedByOwnerUserId,
        deletedAt: input.deletedAt ?? undefined,
      });

      return {
        ok: true,
        item: toSpaceDeletionTombstoneRpcItem(item),
      };
    } catch (error) {
      return toProfileRpcError(error);
    }
  }

  async resolveRequestAuth(
    input: ResolveRequestAuthInput = {}
  ): Promise<ResolveRequestAuthResult> {
    const parsed = authRpcResolveRequestAuthInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveRequestAuthResultSchema.parse({
        code: "bad_request",
        message: "Auth request is invalid.",
        ok: false,
      });
    }
    const validatedInput = parsed.data;
    const headers = toHeaders(validatedInput.headers);
    const requestId =
      normalizeAuthHeaderValue(validatedInput.requestId) ??
      normalizeAuthHeaderValue(headers.get(OPENMELD_REQUEST_ID_HEADER)) ??
      crypto.randomUUID();

    const claimsFromSession = await this.resolveClaimsFromSession(
      headers,
      requestId,
      validatedInput
    );
    if (claimsFromSession.status === "authenticated") {
      return authRpcResolveRequestAuthResultSchema.parse({
        ok: true,
        claims: claimsFromSession.claims,
      });
    }
    if (claimsFromSession.status === "error") {
      return authRpcResolveRequestAuthResultSchema.parse({
        ok: false,
        code: claimsFromSession.code,
        message: claimsFromSession.message,
      });
    }

    return authRpcResolveRequestAuthResultSchema.parse({
      ok: true,
      claims: createUnauthenticatedClaims(requestId),
    });
  }

  // One round trip for the gateway hot path: request auth + profile
  // resolution in a single RPC. Pure orchestration of the two existing
  // methods, so auth/profile semantics cannot drift. When the request is
  // not authenticated (or auth fails) the result mirrors resolveRequestAuth
  // exactly and carries no profile.
  async resolveRequestAuthWithProfile(
    input: AuthRpcResolveRequestAuthWithProfileInput = {}
  ): Promise<AuthRpcResolveRequestAuthWithProfileResult> {
    const parsed =
      authRpcResolveRequestAuthWithProfileInputSchema.safeParse(input);
    if (!parsed.success) {
      return authRpcResolveRequestAuthWithProfileResultSchema.parse({
        code: "bad_request",
        message: "Auth request is invalid.",
        ok: false,
      });
    }
    const {
      profileKind,
      requestedOrganization,
      openMeldProfileId,
      ...requestInput
    } = parsed.data;
    const auth = await this.resolveRequestAuth({
      ...requestInput,
      ...(requestedOrganization ? { requestedOrganization } : {}),
    });
    if (!(auth.ok && auth.claims?.authenticated)) {
      return auth;
    }
    return authRpcResolveRequestAuthWithProfileResultSchema.parse({
      ...auth,
      // The request Organization was already verified above. Profile identity is
      // user-owned and does not need a second membership read on this hot path.
      profile: await this.resolveProfile({
        ...requestInput,
        ...(profileKind ? { profileKind } : {}),
        ...(openMeldProfileId ? { openMeldProfileId } : {}),
      }),
    });
  }

  private async resolveClaimsFromSession(
    headers: Headers,
    requestId: string,
    input: ResolveRequestAuthInput
  ): Promise<ResolveSessionClaimsResult> {
    const sessionResolution = await resolveSessionFromHeaders({
      auth: await this.getAuth(),
      headers,
      verifyLocalUserExists: (userId) =>
        getLocalAuthUserStore(this.env).hasUserById(userId),
    });
    if (sessionResolution.status === "unauthenticated") {
      if (sessionResolution.reason === "stale_local_user") {
        logWarn(
          this.env.AUTH_WORKER_NODE_ENV,
          "[auth.rpc.stale_local_session]",
          {
            operation: "resolveClaimsFromSession",
            userId: sessionResolution.userId,
          }
        );
      }
      return {
        status: "unauthenticated",
      };
    }
    if (sessionResolution.status === "local_state_error") {
      logError("[auth.rpc.local_session_state_failed]", {
        error: toSessionResolutionErrorLog(sessionResolution.cause),
        operation: "resolveClaimsFromSession",
      });
      return {
        status: "error",
        code: "auth.internal_error",
        message: "internal error",
      };
    }
    if (sessionResolution.status === "upstream_error") {
      logError("[auth.rpc.session_resolution_failed]", {
        error: toSessionResolutionErrorLog(sessionResolution.cause),
        operation: "resolveClaimsFromSession",
      });
      return {
        status: "error",
        code: AUTH_UPSTREAM_UNREACHABLE_CODE,
        message: AUTH_UPSTREAM_UNREACHABLE_MESSAGE,
      };
    }

    const userId = String(sessionResolution.user.id);
    let organizationContext: AuthenticatedOrganizationContext;
    try {
      organizationContext = await resolveAuthenticatedOrganizationContext({
        db: this.env.OPENMELD_DB,
        requestedOrganization: input.requestedOrganization,
        sessionActiveOrganizationId: (
          sessionResolution.session as { activeOrganizationId?: unknown }
        ).activeOrganizationId,
        userId,
      });
    } catch (error) {
      logError("[auth.rpc.organization_context_resolution_failed]", {
        error: toSessionResolutionErrorLog(error),
        operation: "resolveClaimsFromSession",
        userId,
      });
      return {
        status: "error",
        code: "auth.internal_error",
        message: "internal error",
      };
    }
    if (!organizationContext.ok) {
      return {
        status: "error",
        code: organizationContext.code,
        message: organizationContext.message,
      };
    }

    try {
      const primaryProfile =
        await this.getProfileService().ensurePrimaryHumanProfile({
          userId,
          userName:
            typeof sessionResolution.user.name === "string"
              ? sessionResolution.user.name
              : "",
          userEmail:
            typeof sessionResolution.user.email === "string"
              ? sessionResolution.user.email
              : "",
        });
      return {
        status: "authenticated",
        claims: {
          authenticated: true,
          requestId,
          callerPrincipalId: userId,
          profileId: primaryProfile.profileId,
          profileKind: primaryProfile.profileKind,
          ownerIds: [],
          authMethod: headers.has("x-api-key") ? "api_key" : "session",
          ...(organizationContext.activeOrganizationId
            ? {
                activeOrganizationId: organizationContext.activeOrganizationId,
              }
            : {}),
          ...(organizationContext.source
            ? { organizationContextSource: organizationContext.source }
            : {}),
        },
      };
    } catch (error) {
      logError("[auth.rpc.primary_profile_resolution_failed]", {
        error: toSessionResolutionErrorLog(error),
        operation: "resolveClaimsFromSession",
      });
      const profileError = toProfileRpcError(error);
      return {
        status: "error",
        code: profileError.code,
        message: profileError.message,
      };
    }
  }

  private async resolveAuthenticatedUser(
    input: ResolveRequestAuthInput = {}
  ): Promise<
    | {
        ok: true;
        userId: string;
        activeOrganizationId: string | null;
        userName: string | null;
        userEmail: string | null;
        userImage: string | null;
      }
    | {
        ok: false;
        code: string;
        message: string;
      }
  > {
    const headers = toHeaders(input.headers);
    const sessionResolution = await resolveSessionFromHeaders({
      auth: await this.getAuth(),
      headers,
      verifyLocalUserExists: (userId) =>
        getLocalAuthUserStore(this.env).hasUserById(userId),
    });
    if (sessionResolution.status === "unauthenticated") {
      if (sessionResolution.reason === "stale_local_user") {
        logWarn(
          this.env.AUTH_WORKER_NODE_ENV,
          "[auth.rpc.stale_local_session]",
          {
            operation: "resolveAuthenticatedUser",
            userId: sessionResolution.userId,
          }
        );
      }
      return {
        ok: false,
        code: "auth.unauthenticated",
        message: "authentication required",
      };
    }

    if (sessionResolution.status === "local_state_error") {
      logError("[auth.rpc.local_session_state_failed]", {
        error: toSessionResolutionErrorLog(sessionResolution.cause),
        operation: "resolveAuthenticatedUser",
      });
      return {
        ok: false,
        code: "auth.internal_error",
        message: "internal error",
      };
    }

    if (sessionResolution.status === "upstream_error") {
      logError("[auth.rpc.session_resolution_failed]", {
        error: toSessionResolutionErrorLog(sessionResolution.cause),
        operation: "resolveAuthenticatedUser",
      });
      return {
        ok: false,
        code: AUTH_UPSTREAM_UNREACHABLE_CODE,
        message: AUTH_UPSTREAM_UNREACHABLE_MESSAGE,
      };
    }

    const userId = String(sessionResolution.user.id);
    let organizationContext: AuthenticatedOrganizationContext;
    try {
      organizationContext = await resolveAuthenticatedOrganizationContext({
        db: this.env.OPENMELD_DB,
        requestedOrganization: input.requestedOrganization,
        sessionActiveOrganizationId: (
          sessionResolution.session as { activeOrganizationId?: unknown }
        ).activeOrganizationId,
        userId,
      });
    } catch (error) {
      logError("[auth.rpc.organization_context_resolution_failed]", {
        error: toSessionResolutionErrorLog(error),
        operation: "resolveAuthenticatedUser",
        userId,
      });
      return {
        ok: false,
        code: "auth.internal_error",
        message: "internal error",
      };
    }
    if (!organizationContext.ok) {
      return organizationContext;
    }

    return {
      ok: true,
      userId,
      activeOrganizationId: organizationContext.activeOrganizationId,
      userName: normalizeAuthHeaderValue(
        String(sessionResolution.user.name ?? "")
      ),
      userEmail: normalizeAuthHeaderValue(
        String(sessionResolution.user.email ?? "")
      ),
      userImage: normalizeOptionalUserImageUrl(sessionResolution.user.image),
    };
  }

  private getProfileService() {
    return getOpenMeldProfileService(this.env);
  }

  private getAccountAvatarService() {
    return createAccountAvatarService({
      repository: createDrizzleAccountAvatarMutationRepository(
        createD1Db(this.env.OPENMELD_DB)
      ),
    });
  }

  private getOrganizationJoinLinkService() {
    return createOrganizationJoinLinkService({
      repository: createDrizzleOrganizationJoinLinkRepository(
        createD1Db(this.env.OPENMELD_DB)
      ),
      webAppUrl:
        this.env.WEB_APP_URL ??
        this.env.BETTER_AUTH_URL ??
        DEFAULT_AUTH_BASE_URL,
    });
  }

  private getOrganizationLogoService() {
    return createOrganizationLogoService({
      repository: createD1OrganizationLogoMutationRepository(
        this.env.OPENMELD_DB
      ),
    });
  }

  private async enrollMessageChannelMember(
    input: EnsureMessageChannelMemberOrganizationMembershipRpcInput
  ): Promise<EnsureMessageChannelMemberOrganizationMembershipRpcResponse> {
    const user = await this.env.OPENMELD_DB.prepare(
      `
        SELECT email_verified
        FROM users
        WHERE id = ?
        LIMIT 1
      `
    )
      .bind(input.userId)
      .first<{ email_verified: boolean | number }>();
    if (!user) {
      return ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema.parse(
        {
          code: "message_channel.member_enrollment.account_unavailable",
          message: "Sign in with an OpenMeld account before joining.",
          ok: false,
        }
      );
    }

    try {
      return ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema.parse(
        {
          ...(await this.getOrganizationJoinLinkService().enrollVerifiedWorkspaceMember(
            {
              addMember: async (memberInput) =>
                getOrganizationServerApi(await this.getAuth()).addMember({
                  body: memberInput,
                }),
              emailVerified:
                user.email_verified === true || user.email_verified === 1,
              organizationId: input.organizationId,
              userId: input.userId,
            }
          )),
          ok: true,
        }
      );
    } catch (error) {
      if (!(error instanceof OrganizationJoinLinkServiceError)) {
        throw error;
      }
      return ensureMessageChannelMemberOrganizationMembershipRpcResponseSchema.parse(
        {
          ...mapMessageChannelMemberEnrollmentError(error),
          ok: false,
        }
      );
    }
  }

  private async getAuth() {
    const { createAuth } = await loadBetterAuthRuntime();
    return createAuth(this.env);
  }
}

function mapMessageChannelMemberEnrollmentError(
  error: OrganizationJoinLinkServiceError
): {
  code:
    | "message_channel.member_enrollment.email_verification_required"
    | "message_channel.member_enrollment.organization_inactive"
    | "message_channel.member_enrollment.personal_organization";
  message: string;
} {
  switch (error.code) {
    case "organization.join_link.email_verification_required":
      return {
        code: "message_channel.member_enrollment.email_verification_required",
        message: error.message,
      };
    case "organization.join_link.inactive":
      return {
        code: "message_channel.member_enrollment.organization_inactive",
        message: error.message,
      };
    case "organization.metadata_invalid":
    case "organization.personal_no_members":
      return {
        code: "message_channel.member_enrollment.personal_organization",
        message:
          "This organization does not allow Message Channel member enrollment.",
      };
    case "organization.join_link.forbidden":
      throw error;
    default:
      throw error;
  }
}

function logAccountAvatarRpcFailure(input: {
  actorUserId: string;
  error: unknown;
  operation: "commit" | "prepare" | "refresh_session";
}): void {
  logError("[auth.rpc.account_avatar_failed]", {
    actorUserId: input.actorUserId,
    error: toSafeRpcErrorLog(input.error),
    operation: input.operation,
  });
}

function logOrganizationLogoRpcFailure(input: {
  error: unknown;
  operation: "commit" | "prepare";
  organizationId: string;
}): void {
  logError("[auth.rpc.organization_logo_failed]", {
    error: toSafeRpcErrorLog(input.error),
    operation: input.operation,
    organizationId: input.organizationId,
  });
}

function requireActiveOrganizationIdForAgentProfileRpc(input: {
  activeOrganizationId: string | null;
}): { ok: true; value: string } | { ok: false; code: string; message: string } {
  if (input.activeOrganizationId) {
    return { ok: true, value: input.activeOrganizationId };
  }
  return {
    ok: false,
    code: "organization.context_required",
    message: "active organization required",
  };
}

function toHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers();

  if (!input) {
    return headers;
  }

  for (const [key, value] of Object.entries(input)) {
    headers.set(key, String(value));
  }

  return headers;
}

function toProfileSpaceHistoryRpcItem(item: {
  profileId: string;
  gatewayHost: string;
  spaceId: string;
  spaceName: string | null;
  creatorProfileId: string | null;
  creatorKind: OpenMeldProfileSpaceCreatorKind | null;
  spaceCreatedAt: Date | string | number | null;
  spaceUpdatedAt: Date | string | number | null;
  lastJoinedAt: Date | string | number;
  lastSeenTs: number | null;
  pinnedAt: Date | string | number | null;
  status: OpenMeldProfileSpaceHistoryStatus;
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
}): OpenMeldProfileSpaceHistoryRpcItem {
  return {
    profileId: item.profileId,
    gatewayHost: item.gatewayHost,
    spaceId: item.spaceId,
    spaceName: item.spaceName,
    creatorProfileId: item.creatorProfileId,
    creatorKind: item.creatorKind,
    spaceCreatedAt: toIsoString(item.spaceCreatedAt),
    spaceUpdatedAt: toIsoString(item.spaceUpdatedAt),
    lastJoinedAt: toRequiredIsoString(item.lastJoinedAt, "lastJoinedAt"),
    lastSeenTs: item.lastSeenTs,
    pinnedAt: toIsoString(item.pinnedAt),
    status: item.status,
    createdAt: toRequiredIsoString(item.createdAt, "createdAt"),
    updatedAt: toRequiredIsoString(item.updatedAt, "updatedAt"),
  };
}

function toSpaceDeletionTombstoneRpcItem(item: {
  gatewayHost: string;
  spaceId: string;
  spaceName: string | null;
  creatorProfileId: string | null;
  creatorKind: OpenMeldProfileSpaceCreatorKind | null;
  deletedByProfileId: string | null;
  deletedByProfileName: string | null;
  deletedByOwnerUserId: string | null;
  deletedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): OpenMeldSpaceDeletionTombstoneRpcItem {
  return {
    gatewayHost: item.gatewayHost,
    spaceId: item.spaceId,
    spaceName: item.spaceName ?? null,
    creatorProfileId: item.creatorProfileId ?? null,
    creatorKind: item.creatorKind ?? null,
    deletedByProfileId: item.deletedByProfileId ?? null,
    deletedByProfileName: item.deletedByProfileName ?? null,
    deletedByOwnerUserId: item.deletedByOwnerUserId ?? null,
    deletedAt: toRequiredIsoString(item.deletedAt, "deletedAt"),
    createdAt: toRequiredIsoString(item.createdAt, "createdAt"),
    updatedAt: toRequiredIsoString(item.updatedAt, "updatedAt"),
  };
}

function toOpenMeldProfileRpcItem(
  profile: {
    profileId: string;
    profileName: string;
    profileHandle: string;
    profileKind: AuthProfileKind;
    isDefault: boolean;
    status: "active" | "disabled";
    ownerUserId: string;
    source: string;
    managedRole?: unknown;
    defaultProjectId?: string | null;
    createdByUserId: string | null;
    creationActorProfileId: string | null;
    creatorProfileId: string | null;
    lastUsedAt: Date | string | number | null;
    createdAt: Date | string | number;
    updatedAt: Date | string | number;
  },
  options?: { ownerName?: string | null; avatarUrl?: string | null }
): OpenMeldProfileRpcItem {
  const ownerName = normalizeOptionalText(options?.ownerName);
  const managedRole = normalizeProfileManagedRole(profile.managedRole);
  const avatarUrl =
    profile.profileKind === "human"
      ? normalizeOptionalText(options?.avatarUrl)
      : undefined;
  return {
    openMeldProfileId: profile.profileId,
    profileName: profile.profileName,
    profileHandle: profile.profileHandle,
    profileKind: profile.profileKind,
    isDefault: profile.isDefault,
    status: profile.status,
    ownerUserId: profile.ownerUserId,
    ...(ownerName ? { ownerName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    source: profile.source,
    managedRole,
    ...(profile.profileKind === "agent" && managedRole === null
      ? { defaultProjectId: normalizeOptionalText(profile.defaultProjectId) }
      : {}),
    createdByUserId: profile.createdByUserId,
    creationActorProfileId: profile.creationActorProfileId,
    creatorProfileId: profile.creatorProfileId,
    lastUsedAt: toIsoString(profile.lastUsedAt),
    createdAt: toIsoString(profile.createdAt),
    updatedAt: toIsoString(profile.updatedAt),
  };
}

function toResolvedOpenMeldProfileRpcItem(
  profile: {
    profileId: string;
    profileName: string;
    profileHandle: string;
    profileKind: AuthProfileKind;
    ownerUserId: string;
  },
  options?: { ownerName?: string | null; avatarUrl?: string | null }
): ResolvedOpenMeldProfile {
  const avatarUrl =
    profile.profileKind === "human"
      ? normalizeOptionalText(options?.avatarUrl)
      : undefined;
  const parsed = resolvedOpenMeldProfileSchema.safeParse({
    openMeldProfileId: profile.profileId,
    profileKind: profile.profileKind,
    profileName: profile.profileName,
    ownerUserId: profile.ownerUserId,
    ...(profile.profileHandle ? { profileHandle: profile.profileHandle } : {}),
    ...(normalizeOptionalText(options?.ownerName)
      ? { ownerName: normalizeOptionalText(options?.ownerName) }
      : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  });
  if (!parsed.success) {
    throw new ProfileValidationError(
      parsed.error.issues[0]?.message ?? "resolved profile is invalid"
    );
  }
  return parsed.data;
}

function normalizeProfileManagedRole(
  value: unknown
): OpenMeldProfileManagedRole | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value === "openmeld_assistant" || value === "center_agent") {
    return value;
  }
  throw new ProfileValidationError("managedRole is invalid");
}

function toIsoString(
  value: Date | string | number | null | undefined
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = resolveDateValue(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function toRequiredIsoString(
  value: Date | string | number | null | undefined,
  field: string
): string {
  const iso = toIsoString(value);
  if (!iso) {
    throw new Error(`invalid ${field}`);
  }
  return iso;
}

function resolveDateValue(value: Date | string | number): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }

  const normalized = String(value).trim();
  if (normalized.length === 0) {
    return new Date(Number.NaN);
  }

  if (INTEGER_TEXT_RE.test(normalized)) {
    const asNumber = Number(normalized);
    if (Number.isFinite(asNumber)) {
      return new Date(asNumber);
    }
  }

  return new Date(normalized);
}

function resolveRequiredProfileId(input: {
  openMeldProfileId?: string;
}): string {
  const primary = String(input.openMeldProfileId ?? "").trim();
  if (primary.length > 0) {
    return primary;
  }
  throw new ProfileValidationError("openMeldProfileId is required");
}

function isTrustedDeletedByCurrentProfileInput(input: {
  input: UpsertSpaceDeletionTombstoneRpcInput;
  currentProfileId: string;
  currentOwnerUserId: string;
}): boolean {
  const deletedByProfileId = normalizeOptionalText(
    input.input.deletedByProfileId
  );
  const deletedByOwnerUserId = normalizeOptionalText(
    input.input.deletedByOwnerUserId
  );
  if (!(deletedByProfileId && deletedByOwnerUserId)) {
    return false;
  }
  return (
    deletedByProfileId === input.currentProfileId &&
    deletedByOwnerUserId === input.currentOwnerUserId
  );
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function readInboxEmailDeliveryId(input: unknown): string {
  if (!(typeof input === "object" && input !== null && "deliveryId" in input)) {
    return "invalid_delivery";
  }
  const deliveryId = normalizeOptionalText(
    (input as { deliveryId?: unknown }).deliveryId
  );
  return deliveryId && deliveryId.length <= 256
    ? deliveryId
    : "invalid_delivery";
}

function logInboxUrgentEmailFailure(input: {
  code: string;
  deliveryId: string;
  error?: unknown;
  itemId: string;
  organizationId: string;
  phase: string;
  providerCode?: string | null;
  retryable: boolean;
}) {
  const errorKind = input.error instanceof Error ? "error" : typeof input.error;
  logError("[auth.rpc.inbox_urgent_email_failed]", {
    code: input.code,
    deliveryId: input.deliveryId,
    errorKind,
    itemId: input.itemId,
    organizationId: input.organizationId,
    phase: input.phase,
    providerCode: input.providerCode ?? null,
    retryable: input.retryable,
  });
}

function buildOrganizationDirectoryAgentProfileIdentitySql(
  scope: "additional" | "organization"
): string {
  const identityScopePredicate =
    scope === "organization"
      ? "profiles.organization_id = ?"
      : `profiles.organization_id <> ?
        AND profiles.profile_id IN (
          SELECT value
          FROM json_each(?)
        )`;
  return `
    SELECT
      profiles.organization_id,
      profiles.profile_id,
      profiles.profile_name,
      profiles.profile_handle,
      profiles.status,
      profiles.owner_user_id,
      users.name AS owner_name,
      profiles.source,
      profiles.managed_role,
      profiles.created_by_user_id,
      profiles.creator_profile_id,
      profiles.last_used_at,
      profiles.created_at,
      profiles.updated_at
    FROM openmeld_profiles AS profiles
    LEFT JOIN users
      ON users.id = profiles.owner_user_id
    WHERE profiles.profile_kind = 'agent'
      AND ${identityScopePredicate}
    ORDER BY lower(profiles.profile_name) ASC, profiles.profile_id ASC
  `;
}

function mapOrganizationDirectoryMemberIdentityRow(
  row: OrganizationDirectoryMemberIdentityRow
) {
  const humanProfileId = normalizeOptionalText(row.human_profile_id);
  const humanProfileName = normalizeOptionalText(row.human_profile_name);
  const humanProfileHandle = normalizeOptionalText(row.human_profile_handle);
  const hasAnyHumanProfileField = Boolean(
    humanProfileId ||
      humanProfileName ||
      humanProfileHandle ||
      row.human_profile_status ||
      row.human_profile_last_used_at !== null
  );
  if (
    hasAnyHumanProfileField &&
    !(
      humanProfileId &&
      humanProfileName &&
      humanProfileHandle &&
      row.human_profile_status
    )
  ) {
    throw new Error("Organization Directory Human Profile is incomplete");
  }
  const email = normalizeOptionalText(row.user_email);
  if (!email) {
    throw new Error("Organization Directory member email is unavailable");
  }
  return {
    humanProfile:
      humanProfileId &&
      humanProfileName &&
      humanProfileHandle &&
      row.human_profile_status
        ? {
            lastUsedAt: toIsoString(row.human_profile_last_used_at),
            profileHandle: humanProfileHandle,
            profileId: humanProfileId,
            profileName: humanProfileName,
            status: row.human_profile_status,
          }
        : null,
    joinedAt: toRequiredIsoString(row.member_created_at, "member joinedAt"),
    memberId: row.member_id,
    organizationId: row.organization_id,
    role: row.role,
    user: {
      email,
      id: row.user_id,
      image: normalizeOptionalText(row.user_image),
      name:
        normalizeOptionalText(row.user_name) ??
        resolveEmailLocalPart(email) ??
        "Member",
    },
    userId: row.user_id,
  };
}

function mapOrganizationDirectoryAgentProfileIdentityRow(
  row: OrganizationDirectoryAgentProfileIdentityRow
) {
  const ownerName = normalizeOptionalText(row.owner_name);
  return {
    createdAt: toRequiredIsoString(row.created_at, "Agent Profile createdAt"),
    createdByUserId: normalizeOptionalText(row.created_by_user_id),
    creatorProfileId: normalizeOptionalText(row.creator_profile_id),
    isDefault: false as const,
    lastUsedAt: toIsoString(row.last_used_at),
    managedRole: normalizeProfileManagedRole(row.managed_role),
    organizationId: row.organization_id,
    ...(ownerName ? { ownerName } : {}),
    ownerUserId: row.owner_user_id,
    profileHandle: row.profile_handle,
    profileId: row.profile_id,
    profileKind: "agent" as const,
    profileName: row.profile_name,
    source: row.source,
    status: row.status,
    updatedAt: toRequiredIsoString(row.updated_at, "Agent Profile updatedAt"),
  };
}

function resolveEmailLocalPart(email: string): string | null {
  const separatorIndex = email.indexOf("@");
  return normalizeOptionalText(
    separatorIndex >= 0 ? email.slice(0, separatorIndex) : email
  );
}

function resolveOrganizationAccountSelection(
  account: AuthRpcResolveOrganizationAccountIdentityInput["account"]
): { joinCondition: string; value: string | null } {
  if (account?.kind === "email") {
    return {
      joinCondition: "lower(users.email) = lower(?)",
      value: account.email,
    };
  }
  if (account?.kind === "user_id") {
    return { joinCondition: "users.id = ?", value: account.userId };
  }
  if (account?.kind === "human_profile_id") {
    return {
      joinCondition: `
        users.id = (
          SELECT selected_profile.owner_user_id
          FROM openmeld_profiles AS selected_profile
          WHERE selected_profile.profile_id = ?
            AND selected_profile.organization_id IS NULL
            AND selected_profile.profile_kind = 'human'
          LIMIT 1
        )
      `,
      value: account.profileId,
    };
  }
  return { joinCondition: "0", value: null };
}

function mapOrganizationAccountIdentityRow(
  row: OrganizationAccountIdentityRow
) {
  const organizationName = normalizeOptionalText(row.organization_name);
  const organizationSlug = normalizeOptionalText(row.organization_slug);
  if (!(organizationName && organizationSlug)) {
    throw new Error("Organization identity projection is incomplete");
  }

  const userId = normalizeOptionalText(row.user_id);
  const userEmail = normalizeOptionalText(row.user_email);
  const userName = normalizeOptionalText(row.user_name);
  const humanProfileId = normalizeOptionalText(row.human_profile_id);
  const humanProfileName = normalizeOptionalText(row.human_profile_name);
  const memberId = normalizeOptionalText(row.member_id);
  const memberRole = normalizeOptionalText(row.member_role);
  if (
    (memberId && !isOrganizationMemberRole(memberRole)) ||
    (!memberId && memberRole) ||
    (humanProfileId && !humanProfileName) ||
    (!humanProfileId && humanProfileName)
  ) {
    throw new Error("Organization account identity projection is invalid");
  }

  const defaultHumanProfile =
    humanProfileId && humanProfileName
      ? { profileId: humanProfileId, profileName: humanProfileName }
      : null;
  const membership =
    memberId && isOrganizationMemberRole(memberRole)
      ? { memberId, role: memberRole }
      : null;
  const account =
    userId && userEmail
      ? {
          defaultHumanProfile,
          displayName: humanProfileName ?? userName ?? userEmail,
          email: userEmail,
          membership,
          userId,
        }
      : null;
  return {
    account,
    organization: {
      id: row.organization_id,
      memberCount: Number(row.member_count) || 0,
      name: organizationName,
      personal: isPersonalOrganizationMetadata(row.organization_metadata),
      slug: organizationSlug,
    },
  };
}

function isOrganizationMemberRole(
  value: string | null
): value is "admin" | "member" | "owner" {
  return value === "admin" || value === "member" || value === "owner";
}

function isPersonalOrganizationMetadata(value: string | null): boolean {
  if (!value) {
    return false;
  }
  try {
    return (JSON.parse(value) as { personal?: unknown }).personal === true;
  } catch {
    return false;
  }
}

async function resolveCenterAgentDefaultProfileName(input: {
  db: D1Database;
  organizationId: string;
}): Promise<string> {
  try {
    const row = await input.db
      .prepare(
        `
          SELECT
            name
          FROM organizations
          WHERE id = ?
          LIMIT 1
        `
      )
      .bind(input.organizationId)
      .first<{ name: string | null }>();
    return buildDefaultCenterAgentProfileName(row?.name);
  } catch (error) {
    console.warn("[auth.center_agent.organization_name_lookup_failed]", {
      event: "auth.center_agent.organization_name_lookup_failed",
      error: error instanceof Error ? error.message : String(error),
      organizationId: input.organizationId,
    });
    return buildDefaultCenterAgentProfileName(null);
  }
}

function logProfileSpaceHistoryRpcError(input: {
  error: unknown;
  input: {
    openMeldProfileId?: string | null;
    gatewayHost?: string | null;
    requestId?: string | null;
    spaceId?: string | null;
  };
  operation:
    | "listProfileSpaceHistory"
    | "upsertProfileSpaceHistory"
    | "updateProfileSpaceHistoryStatus";
  profileError: {
    code: string;
    message: string;
  };
}) {
  if (input.profileError.code !== "profile.internal_error") {
    return;
  }

  logError("[auth.rpc.profile_space_history_failed]", {
    error: toSafeRpcErrorLog(input.error),
    gatewayHost: input.input.gatewayHost ?? null,
    operation: input.operation,
    profileId: input.input.openMeldProfileId ?? null,
    requestId: input.input.requestId ?? null,
    spaceId: input.input.spaceId ?? null,
  });
}

function toSafeRpcErrorLog(error: unknown): {
  message: string | null;
  name: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack ?? null,
    };
  }

  return {
    message: null,
    name: typeof error,
    stack: null,
  };
}

function toProfileRpcError(error: unknown): ProfileErrorResponse {
  return toProfileHttpErrorResponse(error).body;
}
