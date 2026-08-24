import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/space-files");

export type SpaceFileActor = z.infer<Schemas["spaceFileActorSchema"]>;
export type SpaceFileAuditEvent = z.infer<Schemas["spaceFileAuditEventSchema"]>;
export type SpaceFileAuditOperation = z.infer<
  Schemas["spaceFileAuditOperationSchema"]
>;
export type SpaceFileAuditResult = z.infer<
  Schemas["spaceFileAuditResultSchema"]
>;
export type SpaceFileRevision = z.infer<Schemas["spaceFileRevisionSchema"]>;
export type SpaceMessageFileReference = z.infer<
  Schemas["spaceMessageFileReferenceSchema"]
>;
export type SpaceFolderDescriptor = z.infer<
  Schemas["spaceFolderDescriptorSchema"]
>;
export type SpaceFileDescriptor = z.infer<Schemas["spaceFileDescriptorSchema"]>;
export type SpaceFileEntry = z.infer<Schemas["spaceFileEntrySchema"]>;
export type SpaceFileBreadcrumb = z.infer<Schemas["spaceFileBreadcrumbSchema"]>;
export type SpaceFileCapabilities = z.infer<
  Schemas["spaceFileCapabilitiesSchema"]
>;
export type ListSpaceFilesQuery = z.infer<Schemas["listSpaceFilesQuerySchema"]>;
export type ListSpaceFilesResponse = z.infer<
  Schemas["listSpaceFilesResponseSchema"]
>;
export type GetSpaceFileResponse = z.infer<
  Schemas["getSpaceFileResponseSchema"]
>;
export type ListSpaceFileRevisionsResponse = z.infer<
  Schemas["listSpaceFileRevisionsResponseSchema"]
>;
export type CreateSpaceFolderBody = z.infer<
  Schemas["createSpaceFolderBodySchema"]
>;
export type CreateSpaceFolderResponse = z.infer<
  Schemas["createSpaceFolderResponseSchema"]
>;
export type UpdateSpaceFileEntryBody = z.infer<
  Schemas["updateSpaceFileEntryBodySchema"]
>;
export type UpdateSpaceFileEntryResponse = z.infer<
  Schemas["updateSpaceFileEntryResponseSchema"]
>;
export type TrashSpaceFileEntryBody = z.infer<
  Schemas["trashSpaceFileEntryBodySchema"]
>;
export type TrashSpaceFileEntryResponse = z.infer<
  Schemas["trashSpaceFileEntryResponseSchema"]
>;
export type RestoreSpaceFileEntryBody = z.infer<
  Schemas["restoreSpaceFileEntryBodySchema"]
>;
export type RestoreSpaceFileEntryResponse = z.infer<
  Schemas["restoreSpaceFileEntryResponseSchema"]
>;
export type RestoreSpaceFileRevisionBody = z.infer<
  Schemas["restoreSpaceFileRevisionBodySchema"]
>;
export type RestoreSpaceFileRevisionResponse = z.infer<
  Schemas["restoreSpaceFileRevisionResponseSchema"]
>;
export type CreateSpaceFileUploadQuery = z.infer<
  Schemas["createSpaceFileUploadQuerySchema"]
>;
export type UpdateSpaceFileContentQuery = z.infer<
  Schemas["updateSpaceFileContentQuerySchema"]
>;
export type UploadSpaceFileResponse = z.infer<
  Schemas["uploadSpaceFileResponseSchema"]
>;
export type SpaceFileContentQuery = z.infer<
  Schemas["spaceFileContentQuerySchema"]
>;
export type SpaceFileMutationErrorCode = z.infer<
  Schemas["spaceFileMutationErrorCodeSchema"]
>;
export type PrepareSpaceFileWriteInput = z.infer<
  Schemas["prepareSpaceFileWriteInputSchema"]
>;
export type PrepareSpaceFileWriteResponse = z.infer<
  Schemas["prepareSpaceFileWriteResponseSchema"]
>;
export type CommitSpaceFileWriteInput = z.infer<
  Schemas["commitSpaceFileWriteInputSchema"]
>;
export type ResolveSpaceFileContentInput = z.infer<
  Schemas["resolveSpaceFileContentInputSchema"]
>;
export type ResolveSpaceFileContentResponse = z.infer<
  Schemas["resolveSpaceFileContentResponseSchema"]
>;
