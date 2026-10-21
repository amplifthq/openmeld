// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

export type {
  AccountAvatarMutationRecord,
  AccountAvatarMutationRepository,
} from "./account/account-avatar-repository";
export { createDrizzleAccountAvatarMutationRepository } from "./account/account-avatar-repository";
export { createAccountAvatarService } from "./account/account-avatar-service";
export {
  AccountDisplayNameInvariantError,
  AccountDisplayNameValidationError,
} from "./account/account-display-name-errors";
export type {
  AccountDisplayNameRepository,
  DefaultHumanProfileRecord,
} from "./account/account-display-name-repository";
export { createDrizzleAccountDisplayNameRepository } from "./account/account-display-name-repository";
export type {
  AccountDisplayNameService,
  AccountDisplayNameUpdate,
  UpdateAccountDisplayNameInput,
} from "./account/account-display-name-service";
export { createAccountDisplayNameService } from "./account/account-display-name-service";
export type { AccountOrganizationPreferenceRepository } from "./account/account-organization-preference-repository";
export { createDrizzleAccountOrganizationPreferenceRepository } from "./account/account-organization-preference-repository";
export type { AccountOrganizationPreferenceService } from "./account/account-organization-preference-service";
export {
  AccountOrganizationMembershipRequiredError,
  createAccountOrganizationPreferenceService,
} from "./account/account-organization-preference-service";
export type {
  CreateAuthClientConfigInput,
  OpenMeldAuthClientConfig,
} from "./configs/auth.client.config";
export { createAuthClientConfig } from "./configs/auth.client.config";
export type { AuthConfigEnv } from "./configs/auth.config";
export { createAuthConfig } from "./configs/auth.config";
export {
  AUTH_COOKIE_CACHE_CONFIG,
  AUTH_RATE_LIMIT_CUSTOM_RULES,
  AUTH_SECRET_MIN_LENGTH,
  AUTH_SERVICE_NAME,
  AUTHENTICATION_RATE_LIMIT_CONFIG,
  DEFAULT_AUTH_BASE_URL,
  DEFAULT_AUTH_BRAND_NAME,
  DEFAULT_AUTH_FROM_EMAIL,
  DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
  DEFAULT_MAGIC_LINK_EXPIRES_IN_SECONDS,
  DEFAULT_OTT_EXPIRES_IN_MINUTES,
  LAST_USED_LOGIN_METHOD_COOKIE_NAME,
} from "./configs/constants";

export { createAuthDatabase } from "./db";
export type {
  OpenMeldProfileSpaceCreatorKind,
  OpenMeldProfileSpaceHistoryStatus,
} from "./db/profile-space-history.schema";
export { schema } from "./db/schema";
export { openMeldSpaceDeletionTombstones } from "./db/space-deletion-tombstone.schema";
export { openMeldWaitlistEmails } from "./db/waitlist-email.schema";
export {
  buildAuthClaimsHeaders,
  OPENMELD_AUTH_HEADER_AUTHENTICATED,
  OPENMELD_AUTH_HEADER_METHOD,
  OPENMELD_AUTH_HEADER_OWNER_IDS,
  OPENMELD_AUTH_HEADER_PROFILE_ID,
  OPENMELD_AUTH_HEADER_PROFILE_KIND,
  OPENMELD_AUTH_HEADER_REQUEST_ID,
  readAuthClaimsHeaders,
} from "./headers/auth-headers";
export type { OrganizationPermissionCheck } from "./organization/access-control";
export {
  admin as organizationAdminRole,
  canCreateOrganizationJoinLinkForRole,
  canUpdateOrganizationLogoForRole,
  member as organizationMemberRole,
  memberRoleHasOrganizationPermission,
  organizationAccessControl,
  organizationRoles,
  owner as organizationOwnerRole,
} from "./organization/access-control";
export {
  AdditionalHumanProfileCreationDisabledError,
  PrimaryHumanProfileDeleteForbiddenError,
  ProfileCreationIdempotencyConflictError,
  ProfileNotFoundError,
  ProfileValidationError,
} from "./profiles/profile-errors";
export type {
  OpenMeldProfileRecord,
  OpenMeldProfileRepository,
} from "./profiles/profile-repository";
export { createDrizzleOpenMeldProfileRepository } from "./profiles/profile-repository";
export type {
  CreateAgentProfileInput,
  CreateHumanProfileInput,
  DeleteProfileForOwnerInput,
  EnsurePrimaryHumanProfileInput,
  ListProfileSpaceHistoryInput,
  ListProfilesForOwnerEnsuringPrimaryHumanProfileInput,
  OpenMeldProfileService,
  QuerySpaceDeletionTombstonesInput,
  RequestedProfileResolution,
  ResolvePrimaryHumanAndRequestedProfileInput,
  ResolveProfileForOwnerInput,
  UpdateAgentProfileDefaultProjectForOwnerInput,
  UpdateProfileForOwnerInput,
  UpdateProfileNameForOwnerInput,
  UpdateProfileSpaceHistoryStatusInput,
  UpsertProfileSpaceHistoryInput,
  UpsertSpaceDeletionTombstoneInput,
} from "./profiles/profile-service";
export { createOpenMeldProfileService } from "./profiles/profile-service";
export type {
  ProfileSpaceHistoryRecord,
  ProfileSpaceHistoryRepository,
} from "./profiles/profile-space-history-repository";
export { createDrizzleProfileSpaceHistoryRepository } from "./profiles/profile-space-history-repository";
export type {
  ListProfileSpaceHistoryInput as ListProfileSpaceHistoryServiceInput,
  UpdateProfileSpaceHistoryStatusInput as UpdateProfileSpaceHistoryStatusServiceInput,
  UpsertProfileSpaceHistoryServiceInput,
} from "./profiles/profile-space-history-service";
export { createProfileSpaceHistoryService } from "./profiles/profile-space-history-service";
export type {
  QuerySpaceDeletionTombstonesInput as QuerySpaceDeletionTombstonesRepositoryInput,
  SpaceDeletionTombstoneRecord,
  SpaceDeletionTombstoneRepository,
  UpsertSpaceDeletionTombstoneInput as UpsertSpaceDeletionTombstoneRepositoryInput,
} from "./profiles/space-deletion-tombstone-repository";
export { createDrizzleSpaceDeletionTombstoneRepository } from "./profiles/space-deletion-tombstone-repository";
export type {
  QuerySpaceDeletionTombstonesServiceInput,
  SpaceDeletionTombstoneService,
  UpsertSpaceDeletionTombstoneServiceInput,
} from "./profiles/space-deletion-tombstone-service";
export { createSpaceDeletionTombstoneService } from "./profiles/space-deletion-tombstone-service";
export type { VerificationEmailProps } from "./templates/email-verification";
export { VerificationEmail } from "./templates/email-verification";
export type { MagicLinkEmailProps } from "./templates/magic-link";
export { MagicLinkEmail } from "./templates/magic-link";
export type {
  AuthClaims,
  AuthMethod,
  AuthProfileKind,
} from "./types/auth-claims";
export { createUnauthenticatedClaims } from "./types/auth-claims";
export type {
  ResolveRequestAuthInput,
  ResolveRequestAuthResult,
} from "./types/auth-rpc";
export { normalizeAuthHeaderValue } from "./utils/auth-header-value";
export { normalizeAuthBaseUrl } from "./utils/auth-url";
export type {
  AuthConfigInput,
  AuthWorkerNodeEnv,
  ValidatedAuthConfig,
} from "./utils/config-validator";
export { validateAuthConfig } from "./utils/config-validator";
export {
  inferCookieDomain,
  isCookieDomainSuffixOfHost,
  normalizeCookieDomain,
} from "./utils/cookie-domain";
export type { CloudflareEmailSender, SendEmailOptions } from "./utils/email";
export { sendCloudflareEmail } from "./utils/email";
export type { ResolveTrustedOriginsInput } from "./utils/trusted-origins";
export { resolveTrustedOrigins } from "./utils/trusted-origins";
export type {
  WaitlistEmailRecord,
  WaitlistRepository,
} from "./waitlist/waitlist-repository";
export { createDrizzleWaitlistRepository } from "./waitlist/waitlist-repository";
export type {
  JoinWaitlistInput,
  JoinWaitlistResult,
  JoinWaitlistStatus,
} from "./waitlist/waitlist-service";
export {
  createWaitlistService,
  normalizeWaitlistEmail,
} from "./waitlist/waitlist-service";
