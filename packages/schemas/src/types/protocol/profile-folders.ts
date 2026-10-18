import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/protocol/profile-folders");
export type ProfileFolderKind = z.infer<Schemas["profileFolderKindSchema"]>;
export type ProfileFolderProjectionEntry = z.infer<
  Schemas["profileFolderProjectionEntrySchema"]
>;
export type ProfileFolderProjection = z.infer<
  Schemas["profileFolderProjectionSchema"]
>;
export type ProfileFolderOperation = z.infer<
  Schemas["profileFolderOperationSchema"]
>;
export type ProfileFolderOperationReasonCode = z.infer<
  Schemas["profileFolderOperationReasonCodeSchema"]
>;

type ControlSchemas =
  typeof import("../../schemas/daemon/profile-folder-control");
export type OpenMeldDaemonManageProfileFoldersRequestPayload = z.infer<
  ControlSchemas["openMeldDaemonManageProfileFoldersRequestPayloadSchema"]
>;
export type OpenMeldDaemonManageProfileFoldersPayload = z.infer<
  ControlSchemas["openMeldDaemonManageProfileFoldersPayloadSchema"]
>;
export type ProfileFolderProjectionRecord = z.infer<
  ControlSchemas["profileFolderProjectionRecordSchema"]
>;

type TransportSchemas = typeof import("../../schemas/daemon/runtime-transport");
export type RuntimeTransportManageProfileFoldersRequest = z.infer<
  TransportSchemas["runtimeTransportManageProfileFoldersRequestSchema"]
>;
export type RuntimeTransportManageProfileFoldersResponse = z.infer<
  TransportSchemas["runtimeTransportManageProfileFoldersResponseSchema"]
>;
export type RuntimeTransportReadProfileFolderProjectionResponse = z.infer<
  TransportSchemas["runtimeTransportReadProfileFolderProjectionResponseSchema"]
>;
export type RuntimeTransportLocalAgentControlManageProfileFoldersFramePayload =
  z.infer<
    TransportSchemas["runtimeTransportLocalAgentControlManageProfileFoldersFramePayloadSchema"]
  >;
