import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
  isSpaceFileTextEditable,
  listFileRootResponseSchema,
  remoteAgentListTeamFilesRpcInputSchema,
  remoteAgentReadTeamFileResponseSchema,
  remoteAgentReadTeamFileRpcInputSchema,
  remoteAgentSaveTeamFileResponseSchema,
  remoteAgentSaveTeamFileRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CommitSpaceFileWriteInput,
  ListFileRootResponse,
  RemoteAgentListTeamFilesRpcInput,
  RemoteAgentReadTeamFileResponse,
  RemoteAgentReadTeamFileRpcInput,
  RemoteAgentSaveTeamFileResponse,
  RemoteAgentSaveTeamFileRpcInput,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../lib/bindings";
import { requireRemoteAgentToolCaller } from "../remote-agent/application/remote-agent-tool-caller";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  buildOrganizationFileObjectKey,
  organizationFileRootName,
} from "./file-root-identity";

async function teamTarget(
  env: CoreBindings,
  context: RemoteAgentListTeamFilesRpcInput["context"],
  speakerMember: RemoteAgentListTeamFilesRpcInput["speakerMember"]
) {
  const authorization = await requireRemoteAgentToolCaller({ context, env });
  const root = {
    kind: "team" as const,
    organizationId: authorization.activeOrganization.organizationId,
  };
  const namespace = env.OPENMELD_FILE_ROOTS;
  if (!namespace) {
    throw createCoreRpcHttpError({
      code: "file_root.storage_unavailable",
      reason: "Files are temporarily unavailable.",
      status: 503,
    });
  }
  const id = namespace.idFromName(organizationFileRootName(root));
  return {
    context: authorization.context,
    speakerMember,
    root,
    rootId: id.toString(),
    stub: namespace.get(id),
  };
}

export async function rpcRemoteAgentSaveTeamFile(
  env: CoreBindings,
  input: RemoteAgentSaveTeamFileRpcInput
): Promise<RemoteAgentSaveTeamFileResponse> {
  const request = remoteAgentSaveTeamFileRpcInputSchema.parse(input);
  const target = await teamTarget(env, request.context, request.speakerMember);
  const encoded = new TextEncoder().encode(request.content);
  if (
    !isSpaceFileTextEditable({
      mimeType: request.mimeType,
      sizeBytes: encoded.byteLength,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "file_root.type_unsupported",
      reason: "This tool saves UTF-8 text files up to 1 MiB.",
      status: 415,
    });
  }
  const bytes = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(bytes).set(encoded);
  const fileId =
    request.action === "create"
      ? await buildSpaceFileEntryIdForMutation(request.clientMutationId)
      : request.fileId;
  const revisionId = await buildSpaceFileRevisionIdForMutation({
    baseRevision: request.action === "create" ? null : request.baseRevision,
    bytes,
    clientMutationId: request.clientMutationId,
    mimeType: request.mimeType,
    ...(request.action === "create"
      ? { name: request.name, parentId: request.parentId ?? null }
      : {}),
  });
  const write: CommitSpaceFileWriteInput = {
    baseRevision: request.action === "create" ? null : request.baseRevision,
    clientMutationId: request.clientMutationId,
    fileId,
    mimeType: request.mimeType,
    ...(request.action === "create"
      ? { name: request.name, parentId: request.parentId ?? null }
      : {}),
    revisionId,
    sizeBytes: encoded.byteLength,
    spaceId: target.rootId,
  };
  const file = await target.stub.writeContent({
    context: target.context,
    speakerMember: target.speakerMember,
    root: target.root,
    bytes,
    write,
  });
  const { spaceId: _internalRootId, ...details } = file;
  return remoteAgentSaveTeamFileResponseSchema.parse({
    file: { ...details, root: target.root },
  });
}

export async function rpcRemoteAgentListTeamFiles(
  env: CoreBindings,
  input: RemoteAgentListTeamFilesRpcInput
): Promise<ListFileRootResponse> {
  const request = remoteAgentListTeamFilesRpcInputSchema.parse(input);
  const target = await teamTarget(env, request.context, request.speakerMember);
  const result = await target.stub.list({
    context: target.context,
    speakerMember: target.speakerMember,
    root: target.root,
    query: {
      parentId: request.parentId ?? null,
      view: request.view ?? "active",
    },
  });
  return listFileRootResponseSchema.parse({
    root: target.root,
    parentId: result.parentId,
    view: result.view,
    breadcrumbs: result.breadcrumbs,
    entries: result.entries.map(({ spaceId: _internalRootId, ...entry }) => ({
      ...entry,
      root: target.root,
    })),
    capabilities: result.capabilities,
  });
}

export async function rpcRemoteAgentReadTeamFile(
  env: CoreBindings,
  input: RemoteAgentReadTeamFileRpcInput
): Promise<RemoteAgentReadTeamFileResponse> {
  const request = remoteAgentReadTeamFileRpcInputSchema.parse(input);
  const target = await teamTarget(env, request.context, request.speakerMember);
  const resolved = await target.stub.resolveRevision({
    context: target.context,
    speakerMember: target.speakerMember,
    root: target.root,
    fileId: request.fileId,
    ...(request.revision === undefined ? {} : { revision: request.revision }),
  });
  if (
    !isSpaceFileTextEditable({
      mimeType: resolved.revision.mimeType,
      sizeBytes: resolved.revision.sizeBytes,
    })
  ) {
    throw createCoreRpcHttpError({
      code: "file_root.type_unsupported",
      reason:
        "This tool reads UTF-8 text files up to 1 MiB. Open other files in Files.",
      status: 415,
    });
  }
  const bucket = env.OPENMELD_SPACE_ATTACHMENTS;
  if (!bucket) {
    throw storageUnavailable();
  }
  const key = buildOrganizationFileObjectKey({
    root: target.root,
    fileId: request.fileId,
    revisionId: resolved.revision.id,
  });
  const operationId = crypto.randomUUID();
  let bytes: ArrayBuffer;
  try {
    const object = await bucket.get(key);
    if (!object || object.size !== resolved.revision.sizeBytes) {
      throw storageUnavailable();
    }
    bytes = await object.arrayBuffer();
  } catch (error) {
    await target.stub.recordContentAudit({
      context: target.context,
      speakerMember: target.speakerMember,
      root: target.root,
      entryId: request.fileId,
      revisionId: resolved.revision.id,
      operation: "content_read",
      operationId,
      errorCode: "file_root.storage_failed",
    });
    throw error;
  }
  let content: string;
  try {
    content = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
  } catch {
    await target.stub.recordContentAudit({
      context: target.context,
      speakerMember: target.speakerMember,
      root: target.root,
      entryId: request.fileId,
      revisionId: resolved.revision.id,
      operation: "content_read",
      operationId,
      errorCode: "file_root.type_unsupported",
    });
    throw createCoreRpcHttpError({
      code: "file_root.type_unsupported",
      reason: "This file is not valid UTF-8 text. Open it in Files.",
      status: 415,
    });
  }
  await target.stub.recordContentAudit({
    context: target.context,
    speakerMember: target.speakerMember,
    root: target.root,
    entryId: request.fileId,
    revisionId: resolved.revision.id,
    operation: "content_read",
    operationId,
  });
  const file = await target.stub.getFile({
    context: target.context,
    speakerMember: target.speakerMember,
    root: target.root,
    fileId: request.fileId,
  });
  const { spaceId: _internalRootId, ...details } = file;
  const revisions = request.includeHistory
    ? await target.stub.listRevisions({
        context: target.context,
        speakerMember: target.speakerMember,
        root: target.root,
        fileId: request.fileId,
      })
    : undefined;
  return remoteAgentReadTeamFileResponseSchema.parse({
    content,
    file: { ...details, root: target.root },
    revision: resolved.revision,
    ...(revisions ? { revisions } : {}),
  });
}

function storageUnavailable(): Error {
  return createCoreRpcHttpError({
    code: "file_root.storage_unavailable",
    reason: "Files are temporarily unavailable.",
    status: 503,
  });
}
