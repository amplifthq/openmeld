import { OPENMELD_SPACE_FILES_ORIGIN_VERSION } from "@openmeld/gateway-contract";
import {
  resolveSpaceFileContentResponseSchema,
  SPACE_FILE_MAX_SIZE_BYTES,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceMessageFileReferenceSchema,
} from "@openmeld/schemas";
import {
  integer,
  maxLength,
  minLength,
  minValue,
  number,
  optional,
  parse,
  pipe,
  strictObject,
  string,
} from "valibot";
import {
  appendRemoteAgentOutputFile,
  type RemoteAgentCallbackContext,
  type RemoteAgentCoreWorkerBinding,
  type RemoteAgentStorage,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import {
  publishRemoteAgentOutputFile,
  saveRemoteAgentSpaceFile,
} from "../agent-core/space-file-output";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import {
  createAgentComputerFileHandoff,
  inspectComputerFileForTransfer,
} from "./computer-file-handoff";
import { uploadComputerSpaceFile } from "./computer-space-file-upload";

const identifier = pipe(string(), minLength(1), maxLength(256));
const downloadInput = strictObject({
  fileId: identifier,
  revision: optional(pipe(number(), integer(), minValue(1))),
});
const uploadInput = strictObject({
  path: pipe(string(), minLength(1), maxLength(1024)),
  mimeType: pipe(string(), minLength(1), maxLength(255)),
  clientMutationId: identifier,
});
const saveInput = strictObject({
  ...uploadInput.entries,
  fileId: identifier,
  baseRevision: pipe(number(), integer(), minValue(1)),
});
const attachInput = strictObject({
  fileId: identifier,
  revision: pipe(number(), integer(), minValue(1)),
});

export function getComputerSpaceFileTools(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
}): RemoteAgentToolDefinition[] {
  const spaceId = input.context.spaceId;
  if (!spaceId) {
    return [];
  }
  const context = buildRemoteAgentCoreContext(
    input.context,
    `computer-files:${input.context.submissionId}`
  );
  return [
    {
      name: "openmeld_download_space_file",
      description:
        "Download an exact file from the current Space into your Computer, including video and other files up to 1 GiB. Use a fileId and optional revision from the message attachment or openmeld_list_space_files. Returns a local path for Computer tools; file contents are not injected into the prompt. Large downloads use Computer storage and may take time.",
      input: downloadInput,
      execute: async (rawInput) => {
        const request = parse(downloadInput, rawInput);
        const response = await callCoreRpc(
          input.coreWorker,
          "streamSpaceFileContent",
          {
            context,
            spaceId,
            content: { ...request, spaceId },
          },
          (binding, payload) =>
            binding.streamSpaceFileContent?.(
              payload,
              OPENMELD_SPACE_FILES_ORIGIN_VERSION
            )
        );
        const { bytes, ...rawMetadata } = response;
        const metadata =
          resolveSpaceFileContentResponseSchema.parse(rawMetadata);
        if (metadata.revision.sizeBytes > SPACE_FILE_MAX_SIZE_BYTES) {
          await bytes.cancel();
          throw new Error(
            "The Space file exceeds the Computer download limit."
          );
        }
        const path = `${input.workingDirectory}/downloads/${encodeURIComponent(metadata.file.id)}/${metadata.revision.revision}/${encodeURIComponent(metadata.file.name)}`;
        await input.workspaceAccess.withWorkspace(async (workspace) => {
          await workspace.fs.mkdir(path.slice(0, path.lastIndexOf("/")), {
            recursive: true,
          });
          let received = 0;
          const checked = bytes.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                received += chunk.byteLength;
                if (received > metadata.revision.sizeBytes) {
                  throw new Error(
                    "The downloaded file exceeds its declared size."
                  );
                }
                controller.enqueue(chunk);
              },
            })
          );
          try {
            await workspace.fs.writeFile(path, checked);
            if (received !== metadata.revision.sizeBytes) {
              throw new Error(
                "The downloaded file does not match its declared size."
              );
            }
          } catch (error) {
            await workspace.fs.rm(path, { force: true }).catch(() => undefined);
            throw error;
          }
        });
        return {
          path,
          fileId: metadata.file.id,
          revision: metadata.revision.revision,
          sizeBytes: metadata.revision.sizeBytes,
        };
      },
    },
    {
      name: "openmeld_upload_computer_file",
      description:
        "Publish one selected file from your current working directory to this Space's Files and attach it to your final reply. Supports files up to 1 GiB. Specify the correct mimeType and a stable clientMutationId; reuse that ID only when retrying the exact same upload. This creates a file, not an overwrite. Never publish unrelated private files.",
      input: uploadInput,
      execute: async (rawInput) => {
        const request = parse(uploadInput, rawInput);
        return await input.workspaceAccess.withWorkspace(async (workspace) => {
          const selected = await inspectComputerFileForTransfer({
            path: request.path,
            workingDirectory: input.workingDirectory,
            workspace,
          });
          if (selected.sizeBytes <= SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
            const file = await createAgentComputerFileHandoff({
              workspace,
              workingDirectory: input.workingDirectory,
              maxBinaryFileBytes: SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
            }).readBinaryFile(request.path);
            return await publishRemoteAgentOutputFile({
              bytes: Uint8Array.from(file.bytes).buffer,
              clientMutationId: request.clientMutationId,
              context,
              coreWorker: input.coreWorker,
              mimeType: request.mimeType,
              name: file.fileName,
              spaceId,
              storage: input.storage,
              submissionId: input.context.submissionId,
            });
          }
          const descriptor = await uploadComputerSpaceFile({
            clientMutationId: request.clientMutationId,
            context,
            coreWorker: input.coreWorker,
            mimeType: request.mimeType,
            path: selected.absolutePath,
            sizeBytes: selected.sizeBytes,
            spaceId,
            target: {
              kind: "file",
              clientMutationId: request.clientMutationId,
              name: selected.fileName,
              origin: "artifact",
              parentId: null,
            },
            workspace,
          });
          const file = spaceMessageFileReferenceSchema.parse({
            fileId: descriptor.id,
            revision: descriptor.latestRevision.revision,
            name: descriptor.name,
            mimeType: descriptor.latestRevision.mimeType,
            sizeBytes: descriptor.latestRevision.sizeBytes,
          });
          await appendRemoteAgentOutputFile({
            file,
            storage: input.storage,
            submissionId: input.context.submissionId,
          });
          return { addedToSpaceFiles: true, attachedToFinalReply: true, file };
        });
      },
    },
    {
      name: "openmeld_save_computer_file",
      description:
        "Save a selected Computer file as a new revision of an existing Space file, without attaching it to your final reply. Supply the original fileId and baseRevision you edited. A stale base conflicts; preserve your edits and review the incoming version instead of substituting a newer base. Reuse clientMutationId only for the exact same bytes and request. Supports files up to 1 GiB.",
      input: saveInput,
      execute: async (rawInput) => {
        const request = parse(saveInput, rawInput);
        return await input.workspaceAccess.withWorkspace(async (workspace) => {
          const selected = await inspectComputerFileForTransfer({
            path: request.path,
            workingDirectory: input.workingDirectory,
            workspace,
          });
          if (selected.sizeBytes <= SPACE_FILE_RAW_UPLOAD_MAX_BYTES) {
            const file = await createAgentComputerFileHandoff({
              workspace,
              workingDirectory: input.workingDirectory,
              maxBinaryFileBytes: SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
            }).readBinaryFile(request.path);
            return await saveRemoteAgentSpaceFile({
              baseRevision: request.baseRevision,
              bytes: Uint8Array.from(file.bytes).buffer,
              clientMutationId: request.clientMutationId,
              context,
              coreWorker: input.coreWorker,
              fileId: request.fileId,
              mimeType: request.mimeType,
              spaceId,
            });
          }
          const file = await uploadComputerSpaceFile({
            clientMutationId: request.clientMutationId,
            context,
            coreWorker: input.coreWorker,
            mimeType: request.mimeType,
            path: selected.absolutePath,
            sizeBytes: selected.sizeBytes,
            spaceId,
            target: {
              kind: "revision",
              clientMutationId: request.clientMutationId,
              fileId: request.fileId,
              baseRevision: request.baseRevision,
            },
            workspace,
          });
          return { file, attachedToFinalReply: false };
        });
      },
    },
    {
      name: "openmeld_attach_space_file",
      description:
        "Select an existing exact Space file revision for your final reply. This does not save Computer changes or publish a message yet. Use the revision returned by a successful save; never substitute the latest version for the result you intend to deliver.",
      input: attachInput,
      execute: async (rawInput) => {
        const request = parse(attachInput, rawInput);
        const response = await callCoreRpc(
          input.coreWorker,
          "resolveSpaceFileContent",
          { context, spaceId, content: { ...request, spaceId } },
          (binding, payload) => binding.resolveSpaceFileContent?.(payload)
        );
        const metadata = resolveSpaceFileContentResponseSchema.parse(response);
        const file = spaceMessageFileReferenceSchema.parse({
          fileId: metadata.file.id,
          revision: metadata.revision.revision,
          name: metadata.file.name,
          mimeType: metadata.revision.mimeType,
          sizeBytes: metadata.revision.sizeBytes,
        });
        await appendRemoteAgentOutputFile({
          file,
          storage: input.storage,
          submissionId: input.context.submissionId,
        });
        return { attachedToFinalReply: true, file };
      },
    },
  ];
}
