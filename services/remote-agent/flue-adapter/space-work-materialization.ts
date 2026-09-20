import {
  resolveSpaceFileContentResponseSchema,
  SPACE_FILE_RAW_UPLOAD_MAX_BYTES,
  spaceWorkHandoffSchema,
} from "@openmeld/schemas";
import type {
  RemoteAgentCallbackContext,
  RemoteAgentCoreWorkerBinding,
  RemoteAgentStorage,
} from "../agent-core/callback-context";
import { callCoreRpc } from "../agent-core/core-rpc";
import { buildRemoteAgentCoreContext } from "../agent-core/tool-context";
import type { AgentComputerWorkspaceAccess } from "./agent-computer-workspace-access";

/** Prepare the complete pinned set before exposing the Computer to this turn. */
export async function materializeSpaceWork(input: {
  context: RemoteAgentCallbackContext;
  coreWorker: RemoteAgentCoreWorkerBinding;
  storage: RemoteAgentStorage;
  workspaceAccess: AgentComputerWorkspaceAccess;
  workingDirectory: string;
}): Promise<string> {
  if (!input.context.workHandoff) {
    return input.workingDirectory;
  }
  const handoff = spaceWorkHandoffSchema.parse(input.context.workHandoff);
  const key = `space-work:${input.context.submissionId}`;
  const previous = await input.storage.get<string>(key);
  if (previous) {
    await input.workspaceAccess.withWorkspace(async (workspace) => {
      const stat = await workspace.fs.lstat(previous);
      if (!stat.isDirectory || stat.isSymbolicLink) {
        throw new Error("The prepared handoff directory is unavailable.");
      }
    });
    return previous;
  }
  // A failed preparation never overwrites a previous copy or starts execution.
  const root = `${input.workingDirectory}/handoffs/${crypto.randomUUID()}`;
  const context = buildRemoteAgentCoreContext(input.context, key);
  for (const selected of handoff.files) {
    const response = await callCoreRpc(
      input.coreWorker,
      "readSpaceFileContent",
      {
        context,
        spaceId: input.context.spaceId,
        content: {
          spaceId: input.context.spaceId,
          fileId: selected.fileId,
          revision: selected.revision,
        },
      },
      (binding, request) => binding.readSpaceFileContent?.(request)
    );
    const { bytes, ...rawMetadata } = response;
    const metadata = resolveSpaceFileContentResponseSchema.parse(rawMetadata);
    if (
      metadata.file.id !== selected.fileId ||
      metadata.revision.revision !== selected.revision ||
      bytes.byteLength !== metadata.revision.sizeBytes ||
      bytes.byteLength > SPACE_FILE_RAW_UPLOAD_MAX_BYTES
    ) {
      throw new Error(
        "The handoff file does not match its selected revision or transfer limit."
      );
    }
    await input.workspaceAccess.withWorkspace(async (workspace) => {
      const path = `${root}/${selected.relativePath}`;
      const parent = path.slice(0, path.lastIndexOf("/"));
      let directory = "";
      for (const segment of parent.split("/").filter(Boolean)) {
        directory += `/${segment}`;
        await workspace.fs.mkdir(directory, { recursive: true });
        const stat = await workspace.fs.lstat(directory);
        if (!stat.isDirectory || stat.isSymbolicLink) {
          throw new Error(
            "A handoff path crosses a symbolic link or non-directory."
          );
        }
      }
      await workspace.fs.writeFile(path, new Uint8Array(bytes));
    });
  }
  if (await input.storage.putIfAbsent(key, root)) {
    return root;
  }
  const admitted = await input.storage.get<string>(key);
  if (!admitted) {
    throw new Error("The prepared handoff directory is unavailable.");
  }
  return admitted;
}
