import type { WorkspaceClient } from "@cloudflare/computer";
import { OPENMELD_SPACE_FILES_ORIGIN_VERSION } from "@openmeld/gateway-contract";
import {
  SPACE_FILE_UPLOAD_PART_BYTES,
  spaceFileDescriptorSchema,
  spaceFileUploadIdForMutation,
  spaceFileUploadResponseSchema,
} from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  SpaceFileUploadMetadata,
} from "@openmeld/schemas/types";
import type { RemoteAgentCoreWorkerBinding } from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";

/** Upload a selected Computer file without buffering more than one R2 part. */
export async function uploadComputerSpaceFile(input: {
  clientMutationId: string;
  context: OpenMeldRequestContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  mimeType: string;
  path: string;
  sizeBytes: number;
  spaceId: string;
  target: SpaceFileUploadMetadata["target"];
  workspace: Pick<WorkspaceClient, "fs">;
}) {
  const uploadId = await spaceFileUploadIdForMutation(input.clientMutationId);
  const request = async (
    command: import("@openmeld/schemas/types").SpaceFileUploadCommand,
    body?: ReadableStream<Uint8Array>
  ) =>
    spaceFileUploadResponseSchema.parse(
      await callCoreRpc(
        input.coreWorker,
        "spaceFileUpload",
        {
          context: input.context,
          spaceId: input.spaceId,
          uploadId,
          command,
          body,
        },
        (binding, payload) =>
          binding.spaceFileUpload?.(
            payload,
            OPENMELD_SPACE_FILES_ORIGIN_VERSION
          )
      )
    );
  const partDigests: string[] = [];
  let totalBytes = 0;
  for await (const part of readComputerParts(
    input.workspace,
    input.path,
    input.sizeBytes
  )) {
    totalBytes += part.byteLength;
    partDigests.push(await sha256(part));
  }
  if (totalBytes !== input.sizeBytes) {
    throw new Error("The Computer file changed while OpenMeld was reading it.");
  }
  let session = await request({
    action: "start",
    metadata: {
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      partDigests,
      target: input.target,
    },
  });
  if (!session.file) {
    let partNumber = 0;
    for await (const part of readComputerParts(
      input.workspace,
      input.path,
      input.sizeBytes
    )) {
      partNumber += 1;
      if ((await sha256(part)) !== partDigests[partNumber - 1]) {
        throw new Error(
          "The Computer file changed during upload. Retry with a new clientMutationId."
        );
      }
      if (
        session.parts.some((uploaded) => uploaded.partNumber === partNumber)
      ) {
        continue;
      }
      session = await request(
        { action: "part", partNumber },
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(part);
            controller.close();
          },
        })
      );
    }
    if (partNumber !== partDigests.length) {
      throw new Error(
        "The Computer file changed during upload. Retry with a new clientMutationId."
      );
    }
    session = await request({ action: "complete" });
  }
  if (!session.file) {
    throw new Error("The Space file upload completed without a file.");
  }
  return spaceFileDescriptorSchema.parse(session.file);
}

async function* readComputerParts(
  workspace: Pick<WorkspaceClient, "fs">,
  path: string,
  expectedSize: number
): AsyncGenerator<Uint8Array> {
  const reader = (await workspace.fs.readFile(path)).getReader();
  let total = 0;
  let completed = false;
  let part = new Uint8Array(SPACE_FILE_UPLOAD_PART_BYTES);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > expectedSize) {
        throw new Error("The Computer file grew during upload.");
      }
      let cursor = 0;
      while (cursor < value.byteLength) {
        const count = Math.min(
          part.byteLength - offset,
          value.byteLength - cursor
        );
        part.set(value.subarray(cursor, cursor + count), offset);
        offset += count;
        cursor += count;
        if (offset === part.byteLength) {
          yield part;
          part = new Uint8Array(SPACE_FILE_UPLOAD_PART_BYTES);
          offset = 0;
        }
      }
    }
    if (offset > 0) {
      yield part.subarray(0, offset);
    }
    if (total !== expectedSize) {
      throw new Error("The Computer file changed during upload.");
    }
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
