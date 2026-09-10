// biome-ignore-all lint/performance/noBarrelFile: Shared schema package intentionally exposes stable contract entrypoints.

export type {
  SpaceMessageMutationBody,
  SpaceMessageMutationResponse,
} from "../schemas/http/space-message-mutation";
export type {
  OrganizationMemberPresenceBody,
  OrganizationMemberPresenceResponse,
} from "./http/organization-member-presence";
export type {
  SpaceHistoryNavigation,
  SpaceHistoryNavigationQuery,
} from "./http/space-history-navigation";

// Type-query import keeps this entrypoint type-only while locking the version type to the schema export.
export type OpenMeldSchemaVersion =
  typeof import("../schemas/index")["OPENMELD_SCHEMA_VERSION"];

export type * from "./agent-controller-collaboration-mode";
export type * from "./agent-controller-permission-mode";
export type * from "./agent-view/index";
export type * from "./common/index";
export type * from "./config/index";
export type * from "./daemon/index";
export type * from "./db/index";
export type * from "./eval-report";
export type * from "./http/index";
export type * from "./http/space-file-upload";
export type * from "./local-components";
export type * from "./open-code-permission";
export type * from "./prepare/index";
export type * from "./profile-details";
export type * from "./protocol/index";
export type {
  WakeDeviceWait,
  WakeDeviceWaitAccessRequest,
  WakeDeviceWaitAccessResponse,
  WakeDeviceWaitTarget,
} from "./protocol/wake-device-wait";
export type { AgentControllerSessionTitle } from "./runtime/agent-controller-session";
export type * from "./runtime/index";
export type * from "./space-mesh/index";
export type * from "./space-mesh/message-reaction";
export type * from "./start/index";
