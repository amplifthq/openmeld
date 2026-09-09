import {
  buildSpaceFileEntryIdForMutation,
  buildSpaceFileRevisionIdForMutation,
  SPACE_FILE_MAX_SIZE_BYTES,
  spaceFileDescriptorSchema,
  spaceMessageFileReferenceSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import {
  appendRemoteAgentOutputFile,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
} from "./callback-context";
import { callCoreRpc } from "./core-rpc";

/** Publish selected bytes through Space Files and attach the exact revision. */
export async function publishRemoteAgentOutputFile(input: {
  bytes: ArrayBuffer;
  clientMutationId: string;
  context: OpenMeldRequestContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  mimeType: string;
  name: string;
  spaceId: string;
  storage: RemoteAgentStorage;
  submissionId: string;
}) {
  if (input.bytes.byteLength > SPACE_FILE_MAX_SIZE_BYTES) {
    throw new Error("Space files must be 10 MiB or smaller.");
  }
  const fileId = await buildSpaceFileEntryIdForMutation(input.clientMutationId);
  const revisionId = await buildSpaceFileRevisionIdForMutation({
    ...input,
    baseRevision: null,
    parentId: null,
  });
  const descriptor = spaceFileDescriptorSchema.parse(
    await callCoreRpc(
      input.coreWorker,
      "writeSpaceFileContent",
      {
        bytes: input.bytes,
        context: input.context,
        spaceId: input.spaceId,
        write: {
          baseRevision: null,
          clientMutationId: input.clientMutationId,
          fileId,
          mimeType: input.mimeType,
          name: input.name,
          parentId: null,
          revisionId,
          sizeBytes: input.bytes.byteLength,
          spaceId: input.spaceId,
        },
      },
      (binding, request) => binding.writeSpaceFileContent?.(request)
    )
  );
  const file = spaceMessageFileReferenceSchema.parse({
    fileId: descriptor.id,
    mimeType: descriptor.latestRevision.mimeType,
    name: descriptor.name,
    revision: descriptor.latestRevision.revision,
    sizeBytes: descriptor.latestRevision.sizeBytes,
  });
  await appendRemoteAgentOutputFile({
    file,
    storage: input.storage,
    submissionId: input.submissionId,
  });
  return { addedToSpaceFiles: true, attachedToFinalReply: true, file };
}
