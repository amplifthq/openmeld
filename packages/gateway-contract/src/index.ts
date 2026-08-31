// biome-ignore-all lint/performance/noBarrelFile: This package intentionally exposes a single public entrypoint.

export type {
  AuditContextFields,
  AuditEvent,
  AuditEventName,
} from "./audit";
export { contextAuditFields } from "./audit";

export type {
  GatewayErrorCode,
  GatewayErrorEnvelope,
} from "./errors";

export {
  jsonErrorResponse,
  readUpstreamErrorMessage,
  toErrorMessage,
  withRequestIdHeader,
  wsErrorFrame,
} from "./errors";

export type {
  OpenMeldRequestContextHeadersInput,
  OpenMeldRequestedOrganizationSelector,
} from "./headers";
export {
  applyOpenMeldRequestContextHeaders,
  buildOpenMeldRequestContextHeaders,
  decodeOpenMeldHeaderText,
  encodeOpenMeldHeaderText,
  OPENMELD_EXPECTED_FORWARDED_BY,
  OPENMELD_HEADER_ACTIVE_ORGANIZATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_CONVERSATION_ID,
  OPENMELD_HEADER_AGENT_CONTROLLER_REF,
  OPENMELD_HEADER_AUTO_RELAY_DEPTH,
  OPENMELD_HEADER_AVATAR_URL,
  OPENMELD_HEADER_CALLER_PRINCIPAL_ID,
  OPENMELD_HEADER_DISPATCH_CHAIN_ID,
  OPENMELD_HEADER_FORWARDED_BY,
  OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
  OPENMELD_HEADER_OWNER_NAME,
  OPENMELD_HEADER_OWNER_USER_ID,
  OPENMELD_HEADER_PROFILE_HANDLE,
  OPENMELD_HEADER_PROFILE_ID,
  OPENMELD_HEADER_PROFILE_KIND,
  OPENMELD_HEADER_PROFILE_NAME,
  OPENMELD_HEADER_REQUEST_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_ID,
  OPENMELD_HEADER_REQUESTED_ORGANIZATION_SLUG,
  OPENMELD_HEADER_SPACE_PASSWORD,
  OPENMELD_HEADER_VISITED_PROFILE_IDS,
  OPENMELD_HEADER_VISITED_PROFILE_IDS_HASH,
  OPENMELD_INBOX_SOURCE_TARGET_THREAD_UNAWARE_VERSION,
  OPENMELD_INBOX_SOURCE_TARGET_VERSION,
  readOpenMeldRequestContext,
  readOpenMeldRequestedOrganizationSelector,
} from "./headers";
export {
  ORGANIZATION_DIRECTORY_AGENT_PROFILE_WORK_RECOVERY_VERSION_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_HUMAN_PROFILE_LAST_USED_AT_QUERY_PARAMETER,
  ORGANIZATION_DIRECTORY_INCLUDE_MEMBER_LAST_ACTIVE_AT_QUERY_PARAMETER,
} from "./query-parameters";
