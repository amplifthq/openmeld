import {
  resolveSpaceFileContentResponseSchema,
  SPACE_FILE_MAX_SIZE_BYTES,
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
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { publishRemoteAgentOutputFile } from "../agent-core/space-file-output";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { RemoteAgentToolDefinition } from "../agent-core/tool-definition";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";
import { createAgentComputerFileHandoff } from "./computer-file-handoff";

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
        "Download an exact file from the current Space into your Computer, including binary documents and spreadsheets up to 10 MiB. Use a fileId and optional revision from the message attachment or openmeld_list_space_files. Returns a local path for Computer tools; file contents are not injected into the prompt.",
      input: downloadInput,
      execute: async (rawInput) => {
        const request = parse(downloadInput, rawInput);
        const response = await callCoreRpc(
          input.coreWorker,
          "readSpaceFileContent",
          {
            context,
            spaceId,
            content: { ...request, spaceId },
          },
          (binding, payload) => binding.readSpaceFileContent?.(payload)
        );
        const { bytes, ...rawMetadata } = response;
        const metadata =
          resolveSpaceFileContentResponseSchema.parse(rawMetadata);
        if (
          bytes.byteLength > SPACE_FILE_MAX_SIZE_BYTES ||
          bytes.byteLength !== metadata.revision.sizeBytes
        ) {
          throw new Error(
            "The downloaded file does not match its declared size."
          );
        }
        const path = `${input.workingDirectory}/downloads/${encodeURIComponent(metadata.file.id)}/${metadata.revision.revision}/${encodeURIComponent(metadata.file.name)}`;
        await input.workspaceAccess.withWorkspace(async (workspace) => {
          await workspace.fs.mkdir(path.slice(0, path.lastIndexOf("/")), {
            recursive: true,
          });
          await workspace.fs.writeFile(path, new Uint8Array(bytes));
        });
        return {
          path,
          fileId: metadata.file.id,
          revision: metadata.revision.revision,
          sizeBytes: bytes.byteLength,
        };
      },
    },
    {
      name: "openmeld_upload_computer_file",
      description:
        "Publish one selected file from your current working directory to this Space's Files and attach it to your final reply. Supports binary and text files up to 10 MiB. Specify the correct mimeType and a stable clientMutationId; reuse that ID only when retrying the exact same upload. This creates a file, not an overwrite. Never publish unrelated private files.",
      input: uploadInput,
      execute: async (rawInput) => {
        const request = parse(uploadInput, rawInput);
        const file = await input.workspaceAccess.withWorkspace(
          async (workspace) =>
            await createAgentComputerFileHandoff({
              workspace,
              workingDirectory: input.workingDirectory,
              maxBinaryFileBytes: SPACE_FILE_MAX_SIZE_BYTES,
            }).readBinaryFile(request.path)
        );
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
      },
    },
  ];
}
