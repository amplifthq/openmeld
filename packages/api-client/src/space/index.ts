// biome-ignore-all lint/performance/noBarrelFile: This folder intentionally exposes a small shared module surface.

export { setSpaceAccessMode } from "./access-mode";
export { respondToSpaceAgentInteraction } from "./agent-interaction";
export { createSpaceApi } from "./api";
export {
  buildSpaceAttachmentDownloadPath,
  type SpaceAttachmentUploadBytes,
  type UploadSpaceAttachmentInput,
  uploadSpaceAttachment,
} from "./attachments";
export { buildSpaceBootstrapReadPath } from "./bootstrap";
export { createSpaceDiagnosticReport } from "./diagnostic-report";
export { resolveSpaceEntry } from "./entry-resolution";
export {
  executeSpaceExecutionRecovery,
  inspectSpaceExecutionRecovery,
} from "./execution-recovery";
export {
  createSpaceFolder,
  downloadSpaceFileContent,
  getSpaceFile,
  listSpaceFileRevisions,
  listSpaceFiles,
  restoreSpaceFileEntry,
  restoreSpaceFileRevision,
  type SpaceFileContent,
  type SpaceFileContentBytes,
  trashSpaceFileEntry,
  updateSpaceFileContent,
  updateSpaceFileEntry,
  uploadSpaceFile,
} from "./files";
export { updateSpaceMeta } from "./meta";
export {
  buildSpaceSignalsReadPath,
  buildSpaceSignalsReadSearchParams,
} from "./signals";
export type {
  AddSpaceMembersInput,
  CreateSpaceApi,
  CreateSpaceDiagnosticReportBody,
  CreateSpaceDiagnosticReportResponse,
  CreateSpaceInput,
  RemoveSpaceMembersInput,
  ResolveSpaceEntryInput,
  SetSpaceAccessModeInput,
  SpaceApi,
  SpaceHistorySignalKind,
  SpaceRequestInput,
  SpaceSignalsReadQuery,
  UpdateSpaceMetaInput,
} from "./types";
export { buildSpaceUpdatesReadPath } from "./updates";
export { postSpaceWakeStop } from "./wake-stop";
