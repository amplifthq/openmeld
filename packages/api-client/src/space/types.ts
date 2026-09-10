import type { SignalEnvelope } from "@openmeld/protocol";
import type {
  AddCenterAgentToSpaceBody,
  AddOrganizationDirectoryProfilesToSpaceBody,
  CatchupResponse,
  CreateSpaceBody,
  CreateSpaceDiagnosticReportBody as CreateSpaceDiagnosticReportBodyFromSchemas,
  CreateSpaceDiagnosticReportResponse as CreateSpaceDiagnosticReportResponseFromSchemas,
  CreateSpaceFolderBody,
  CreateSpaceFolderResponse,
  CreateSpaceResponse,
  CreateSpaceThreadBody,
  CreateSpaceThreadResponse,
  DeleteSpaceResponse,
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
  GetActiveSpaceWakeProgressResponse,
  GetSpaceEntryResolutionInput,
  GetSpaceEntryResolutionResponse,
  GetSpaceMessageDetailsResponse,
  GetSpaceMessageReactionsResponse,
  GetSpaceStatusResponse,
  GetSpaceThreadResponse,
  GetSpaceUpdatesResponse,
  GetSpaceWakeProgressResponse,
  GetSpaceWakeTraceWaterfallResponse,
  InspectExecutionRecoveryResponse,
  LeaveSpaceResponse,
  ListSpaceFileRevisionsResponse,
  ListSpaceFilesQuery,
  ListSpaceFilesResponse,
  ListSpaceThreadEventsResponse,
  ListSpaceThreadSignalsResponse,
  ListSpaceThreadsResponse,
  OpenMeldRequestContext,
  PatchSpaceMetaBody,
  PostNormalMessageBody,
  PostNormalMessageResponse,
  PostSpaceMembersResponse,
  PostSpaceThreadSignalBody,
  PostSpaceThreadSignalResponse,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  RemoveSpaceMembersBody,
  RemoveSpaceMembersResponse,
  RespondToSpaceAgentInteractionBody,
  RespondToSpaceAgentInteractionResponse,
  SetSpaceAccessModeBody,
  SpaceAccessModeState,
  SpaceAttachmentDescriptor,
  SpaceBootstrapResponse,
  SpaceComposerUploadDescriptor,
  SpaceFileDescriptor,
  SpaceFileEntry,
  SpaceHistoryNavigation,
  SpaceHistoryNavigationQuery,
  SpaceIdentityDirectory,
  SpaceMemberDirectory,
  SpaceMembersSnapshot,
  SpaceMeta,
  SpaceViewerMembershipResponse,
  TrashSpaceFileEntryResponse,
  UpdateSpaceFileEntryBody,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";
import type { UploadSpaceAttachmentInput } from "./attachments";
import type { SpaceFileContent, SpaceFileContentBytes } from "./files";
import type {
  ReadMessageReactionsInput,
  SetMessageReactionInput,
} from "./message-reactions";

export type {
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
} from "@openmeld/schemas/types";

export type SpaceHistorySignalKind = "text" | "status" | "system_notice";

export type SpaceSignalsReadQuery = {
  afterTs?: number;
  cursor?: string;
  recent?: boolean;
  limit?: number;
  afterSignalId?: string;
  aroundSignalId?: string;
  beforeCount?: number;
  afterCount?: number;
  fromProfileIds?: readonly string[];
  kinds?: readonly SpaceHistorySignalKind[];
};

export type SpaceRequestInput = {
  spaceId: string;
  requestContext?: OpenMeldRequestContext;
  spacePassword?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ResolveSpaceEntryInput = SpaceRequestInput &
  Omit<GetSpaceEntryResolutionInput, "spaceId">;

export type CreateSpaceInput = {
  requestContext?: OpenMeldRequestContext;
  name?: CreateSpaceBody["name"];
  purpose?: CreateSpaceBody["purpose"];
  guide?: CreateSpaceBody["guide"];
  visibility?: CreateSpaceBody["visibility"];
  accessMode?: CreateSpaceBody["accessMode"];
  password?: CreateSpaceBody["password"];
};

export type AddSpaceMembersInput = SpaceRequestInput & {
  memberProfileIds: PostSpaceMembersResponse["items"][number]["profileId"][];
};

export type AddCenterAgentToSpaceInput = SpaceRequestInput &
  AddCenterAgentToSpaceBody;

export type AddOrganizationDirectoryProfilesToSpaceInput = SpaceRequestInput &
  AddOrganizationDirectoryProfilesToSpaceBody;

export type RemoveSpaceMembersInput = SpaceRequestInput & {
  memberProfileIds: RemoveSpaceMembersBody["memberProfileIds"];
};

export type SetSpaceAccessModeInput = SpaceRequestInput &
  SetSpaceAccessModeBody;

export type UpdateSpaceMetaInput = SpaceRequestInput & PatchSpaceMetaBody;

export type SpaceApi = {
  getMessageReactions(
    input: ReadMessageReactionsInput
  ): Promise<GetSpaceMessageReactionsResponse>;
  setMessageReaction(
    input: SetMessageReactionInput
  ): Promise<GetSpaceMessageReactionsResponse>;
  createSpace: (input: CreateSpaceInput) => Promise<CreateSpaceResponse>;
  deleteSpace: (input: SpaceRequestInput) => Promise<DeleteSpaceResponse>;
  joinSpace: (input: SpaceRequestInput) => Promise<PostSpaceMembersResponse>;
  addMembers: (
    input: AddSpaceMembersInput
  ) => Promise<PostSpaceMembersResponse>;
  /** @deprecated Use addOrganizationDirectoryProfilesToSpace instead. */
  addCenterAgentToSpace: (
    input: AddCenterAgentToSpaceInput
  ) => Promise<PostSpaceMembersResponse>;
  addOrganizationDirectoryProfilesToSpace: (
    input: AddOrganizationDirectoryProfilesToSpaceInput
  ) => Promise<PostSpaceMembersResponse>;
  uploadAttachment: (
    input: UploadSpaceAttachmentInput
  ) => Promise<SpaceAttachmentDescriptor>;
  listFiles: (
    input: SpaceRequestInput & { query?: ListSpaceFilesQuery }
  ) => Promise<ListSpaceFilesResponse>;
  getFile: (
    input: SpaceRequestInput & { fileId: string }
  ) => Promise<{ file: SpaceFileDescriptor }>;
  listFileRevisions: (
    input: SpaceRequestInput & { fileId: string }
  ) => Promise<ListSpaceFileRevisionsResponse>;
  createFolder: (
    input: SpaceRequestInput & { body: CreateSpaceFolderBody }
  ) => Promise<CreateSpaceFolderResponse>;
  updateFileEntry: (
    input: SpaceRequestInput & {
      body: UpdateSpaceFileEntryBody;
      entryId: string;
    }
  ) => Promise<SpaceFileEntry>;
  trashFileEntry: (
    input: SpaceRequestInput & {
      clientMutationId: string;
      entryId: string;
    }
  ) => Promise<TrashSpaceFileEntryResponse>;
  restoreFileEntry: (
    input: SpaceRequestInput & {
      clientMutationId: string;
      entryId: string;
    }
  ) => Promise<SpaceFileEntry>;
  restoreFileRevision: (
    input: SpaceRequestInput & {
      baseRevision: number;
      clientMutationId: string;
      fileId: string;
      revision: number;
    }
  ) => Promise<SpaceFileDescriptor>;
  uploadFile: (
    input: SpaceRequestInput & {
      bytes: SpaceFileContentBytes;
      clientMutationId: string;
      mimeType: string;
      name: string;
      parentId?: string | null;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    }
  ) => Promise<SpaceFileDescriptor>;
  stageComposerUpload: (
    input: SpaceRequestInput & {
      bytes: SpaceFileContentBytes;
      mimeType: string;
      name: string;
      uploadId: string;
      onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    }
  ) => Promise<SpaceComposerUploadDescriptor>;
  publishComposerUpload: (
    input: SpaceRequestInput & {
      clientMutationId: string;
      uploadId: string;
    }
  ) => Promise<SpaceFileDescriptor>;
  discardComposerUpload: (
    input: SpaceRequestInput & { uploadId: string }
  ) => Promise<void>;
  updateFileContent: (
    input: SpaceRequestInput & {
      baseRevision: number;
      bytes: SpaceFileContentBytes;
      clientMutationId: string;
      fileId: string;
      mimeType: string;
    }
  ) => Promise<SpaceFileDescriptor>;
  downloadFileContent: (
    input: SpaceRequestInput & { fileId: string; revision?: number }
  ) => Promise<SpaceFileContent>;
  streamFileContent: (
    input: SpaceRequestInput & { fileId: string; revision?: number }
  ) => Promise<
    Omit<SpaceFileContent, "bytes"> & { bytes: ReadableStream<Uint8Array> }
  >;
  removeMembers: (
    input: RemoveSpaceMembersInput
  ) => Promise<RemoveSpaceMembersResponse>;
  setAccessMode: (
    input: SetSpaceAccessModeInput
  ) => Promise<SpaceAccessModeState>;
  updateMeta: (input: UpdateSpaceMetaInput) => Promise<SpaceMeta>;
  leaveSpace: (input: SpaceRequestInput) => Promise<LeaveSpaceResponse>;
  getBootstrap: (
    input: SpaceRequestInput & {
      historyQuery?: SpaceSignalsReadQuery;
      includeAgentStreamPresence?: boolean;
    }
  ) => Promise<SpaceBootstrapResponse>;
  getStatus: (input: SpaceRequestInput) => Promise<GetSpaceStatusResponse>;
  resolveEntry: (
    input: ResolveSpaceEntryInput
  ) => Promise<GetSpaceEntryResolutionResponse>;
  getMembersSnapshot: (
    input: SpaceRequestInput
  ) => Promise<SpaceMembersSnapshot>;
  getMemberDirectory: (
    input: SpaceRequestInput
  ) => Promise<SpaceMemberDirectory>;
  getHistoryNavigation: (
    input: SpaceRequestInput & SpaceHistoryNavigationQuery
  ) => Promise<SpaceHistoryNavigation>;
  getIdentityDirectory: (
    input: SpaceRequestInput
  ) => Promise<SpaceIdentityDirectory>;
  getViewerMembership: (
    input: SpaceRequestInput
  ) => Promise<SpaceViewerMembershipResponse>;
  listSignals: (
    input: SpaceRequestInput & { query?: SpaceSignalsReadQuery }
  ) => Promise<CatchupResponse>;
  listSignalEnvelopes: (
    input: SpaceRequestInput & {
      query?: SpaceSignalsReadQuery;
    }
  ) => Promise<{
    envelopes: readonly SignalEnvelope[];
    nextCursor: string | null;
  }>;
  getUpdates: (
    input: SpaceRequestInput & {
      afterSignalId: string;
      limit: number;
    }
  ) => Promise<GetSpaceUpdatesResponse>;
  getActiveWakeProgress: (
    input: SpaceRequestInput & {
      includePageInfo?: boolean;
      includePreviewText?: boolean;
      includeSourceContext?: boolean;
      includeTiming?: boolean;
      includeWaitReason?: boolean;
      includeDeviceWait?: boolean;
      includeWakeStopEligibility?: boolean;
      sourceProfileId?: string;
      targetProfileId?: string;
    }
  ) => Promise<GetActiveSpaceWakeProgressResponse>;
  postWakeStop: (
    input: SpaceRequestInput & {
      body: PostSpaceWakeStopBody;
    }
  ) => Promise<PostSpaceWakeStopResponse>;
  inspectExecutionRecovery: (
    input: SpaceRequestInput & { dispatchId: string }
  ) => Promise<InspectExecutionRecoveryResponse>;
  executeExecutionRecovery: (
    input: SpaceRequestInput & {
      body: ExecuteExecutionRecoveryBody;
      dispatchId: string;
    }
  ) => Promise<ExecuteExecutionRecoveryResponse>;
  respondToAgentInteraction: (
    input: SpaceRequestInput & {
      body: RespondToSpaceAgentInteractionBody;
    }
  ) => Promise<RespondToSpaceAgentInteractionResponse>;
  getWakeProgress: (
    input: SpaceRequestInput & {
      clientMessageId: string;
      includePreviewText?: boolean;
      includeSourceContext?: boolean;
      includeTiming?: boolean;
      includeWaitReason?: boolean;
      includeDeviceWait?: boolean;
      includeWakeStopEligibility?: boolean;
      targetProfileId?: string;
    }
  ) => Promise<GetSpaceWakeProgressResponse>;
  getWakeTraceWaterfall: (
    input: SpaceRequestInput & {
      clientMessageId?: string | null;
      sourceSignalId?: string | null;
      targetProfileId?: string;
    }
  ) => Promise<GetSpaceWakeTraceWaterfallResponse>;
  getMessageDetails: (
    input: SpaceRequestInput & {
      signalId: string;
    }
  ) => Promise<GetSpaceMessageDetailsResponse>;
  createDiagnosticReport: (
    input: SpaceRequestInput & {
      body: CreateSpaceDiagnosticReportBodyFromSchemas;
    }
  ) => Promise<CreateSpaceDiagnosticReportResponseFromSchemas>;
  mutateMessage: (
    input: SpaceRequestInput & {
      signalId: string;
      body: import("@openmeld/schemas/types").SpaceMessageMutationBody;
    }
  ) => Promise<import("@openmeld/schemas/types").SpaceMessageMutationResponse>;
  postNormalMessage: (
    input: SpaceRequestInput & {
      text: PostNormalMessageBody["text"];
      deviceWait?: PostNormalMessageBody["deviceWait"];
      attachments?: PostNormalMessageBody["attachments"];
      files?: PostNormalMessageBody["files"];
      messageEnvelope?: PostNormalMessageBody["messageEnvelope"];
      replyTo?: PostNormalMessageBody["replyTo"];
      meta?: PostNormalMessageBody["meta"];
    }
  ) => Promise<PostNormalMessageResponse>;
  createThread: (
    input: SpaceRequestInput & CreateSpaceThreadBody
  ) => Promise<CreateSpaceThreadResponse>;
  listThreads: (input: SpaceRequestInput) => Promise<ListSpaceThreadsResponse>;
  getThread: (
    input: SpaceRequestInput & { threadId: string }
  ) => Promise<GetSpaceThreadResponse>;
  listThreadEvents: (
    input: SpaceRequestInput & { threadId: string }
  ) => Promise<ListSpaceThreadEventsResponse>;
  listThreadSignals: (
    input: SpaceRequestInput & {
      afterSignalId?: string;
      limit?: number;
      threadId: string;
    }
  ) => Promise<ListSpaceThreadSignalsResponse>;
  postThreadSignal: (
    input: SpaceRequestInput & {
      threadId: string;
      body: PostSpaceThreadSignalBody;
    }
  ) => Promise<PostSpaceThreadSignalResponse>;
};

export type CreateSpaceApi = (client: OpenMeldApiClientFoundation) => SpaceApi;
