export function buildCreateSpacePath(): string {
  return "/v1/spaces";
}

export function buildSpaceDeletePath(spaceId: string): string {
  return `/v1/spaces/${encodeURIComponent(spaceId)}`;
}

export function buildSpaceStatusPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "status");
}

export function buildSpaceMetaPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "meta");
}

export function buildSpaceAccessModePath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "access-mode");
}

export function buildSpaceBootstrapPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "bootstrap");
}

export function buildSpaceMembersPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "members");
}

export function buildSpaceRemoveMembersPath(spaceId: string): string {
  return `${buildSpaceMembersPath(spaceId)}/remove`;
}

export function buildSpaceMemberDirectoryPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "member-directory");
}

export function buildSpaceIdentityDirectoryPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "identity-directory");
}

export function buildSpaceViewerMembershipPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "viewer-membership");
}

export function buildSpaceJoinPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "join");
}

export function buildSpaceCenterAgentMemberPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "center-agent");
}

export function buildSpaceOrganizationDirectoryProfilesPath(
  spaceId: string
): string {
  return buildSpaceRoutePath(spaceId, "organization-directory-profiles");
}

export function buildSpaceLeavePath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "leave");
}

export function buildSpaceSignalsPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "signals");
}

export function buildSpaceAttachmentsPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "attachments");
}

export function buildSpaceFilesPath(
  spaceId: string,
  query?: { includeTrashed?: boolean; parentId?: string | null }
): string {
  const path = buildSpaceRoutePath(spaceId, "files");
  const searchParams = new URLSearchParams();
  if (query?.parentId) {
    searchParams.set("parentId", query.parentId);
  }
  if (query?.includeTrashed !== undefined) {
    searchParams.set("includeTrashed", String(query.includeTrashed));
  }
  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function buildSpaceFileFoldersPath(spaceId: string): string {
  return `${buildSpaceFilesPath(spaceId)}/folders`;
}

export function buildSpaceFileEntryPath(
  spaceId: string,
  entryId: string
): string {
  return `${buildSpaceFilesPath(spaceId)}/${encodeURIComponent(entryId)}`;
}

export function buildSpaceFileRevisionsPath(
  spaceId: string,
  fileId: string
): string {
  return `${buildSpaceFileEntryPath(spaceId, fileId)}/revisions`;
}

export function buildSpaceFileContentPath(
  spaceId: string,
  fileId: string,
  query?: {
    baseRevision?: number;
    clientMutationId?: string;
    revision?: number;
  }
): string {
  const path = `${buildSpaceFileEntryPath(spaceId, fileId)}/content`;
  const searchParams = new URLSearchParams();
  if (query?.revision !== undefined) {
    searchParams.set("revision", String(query.revision));
  }
  if (query?.baseRevision !== undefined) {
    searchParams.set("baseRevision", String(query.baseRevision));
  }
  if (query?.clientMutationId !== undefined) {
    searchParams.set("clientMutationId", query.clientMutationId);
  }
  const queryString = searchParams.toString();
  return queryString ? `${path}?${queryString}` : path;
}

export function buildSpaceFileUploadPath(input: {
  clientMutationId: string;
  name: string;
  parentId?: string | null;
  spaceId: string;
}): string {
  const searchParams = new URLSearchParams({
    clientMutationId: input.clientMutationId,
    name: input.name,
  });
  if (input.parentId) {
    searchParams.set("parentId", input.parentId);
  }
  return `${buildSpaceFilesPath(input.spaceId)}?${searchParams.toString()}`;
}

export function buildSpaceAttachmentUploadPath(
  spaceId: string,
  query?: { fileName?: string; width?: number; height?: number }
): string {
  const path = buildSpaceAttachmentsPath(spaceId);
  const searchParams = new URLSearchParams();
  if (query?.fileName !== undefined) {
    searchParams.set("fileName", query.fileName);
  }
  if (query?.width !== undefined) {
    searchParams.set("width", String(query.width));
  }
  if (query?.height !== undefined) {
    searchParams.set("height", String(query.height));
  }
  const queryString = searchParams.toString();
  return queryString.length > 0 ? `${path}?${queryString}` : path;
}

export function buildSpaceUpdatesPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "updates");
}

export function buildSpaceWakeProgressPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "wake-progress");
}

export function buildActiveSpaceWakeProgressPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "active-wake-progress");
}

export function buildSpaceWakeStopPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "wake-stop");
}

export function buildSpaceExecutionRecoveryPath(
  spaceId: string,
  dispatchId: string
): string {
  return `${buildSpaceRoutePath(spaceId, "dispatches")}/${encodeURIComponent(
    dispatchId
  )}/recovery`;
}

export function buildSpaceAgentInteractionResponsePath(
  spaceId: string
): string {
  return buildSpaceRoutePath(spaceId, "agent-interactions/respond");
}

export function buildSpaceWakeTraceWaterfallPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "wake-trace-waterfall");
}

export function buildSpaceMessageDetailsPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "message-details");
}

export function buildSpaceDiagnosticReportsPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "diagnostic-reports");
}

export function buildSpaceThreadsPath(spaceId: string): string {
  return buildSpaceRoutePath(spaceId, "threads");
}

export function buildSpaceThreadPath(
  spaceId: string,
  threadId: string
): string {
  return `${buildSpaceThreadsPath(spaceId)}/${encodeURIComponent(threadId)}`;
}

export function buildSpaceThreadEventsPath(
  spaceId: string,
  threadId: string
): string {
  return `${buildSpaceThreadPath(spaceId, threadId)}/events`;
}

export function buildSpaceThreadSignalsPath(
  spaceId: string,
  threadId: string,
  query?: { afterSignalId: string; limit: number }
): string {
  const path = `${buildSpaceThreadPath(spaceId, threadId)}/signals`;
  if (!query) {
    return path;
  }
  const searchParams = new URLSearchParams({
    afterSignalId: query.afterSignalId,
    limit: String(query.limit),
  });
  return `${path}?${searchParams.toString()}`;
}

function buildSpaceRoutePath(
  spaceId: string,
  segment:
    | "status"
    | "meta"
    | "access-mode"
    | "bootstrap"
    | "members"
    | "member-directory"
    | "identity-directory"
    | "viewer-membership"
    | "attachments"
    | "files"
    | "join"
    | "center-agent"
    | "organization-directory-profiles"
    | "leave"
    | "signals"
    | "updates"
    | "wake-progress"
    | "active-wake-progress"
    | "wake-stop"
    | "dispatches"
    | "agent-interactions/respond"
    | "wake-trace-waterfall"
    | "message-details"
    | "diagnostic-reports"
    | "threads"
): string {
  return `/v1/spaces/${encodeURIComponent(spaceId)}/${segment}`;
}
