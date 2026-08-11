import type { WorkspaceClient } from "@cloudflare/computer";
import type { RemoteAgentComputerFileHandoff } from "../agent-core/tools";

const MAX_HANDOFF_FILE_BYTES = 32_000;
const MAX_HANDOFF_TOTAL_BYTES = 64_000;
const WORKING_COPY_METADATA_SUFFIX = ".openmeld.json";
const TRAILING_SLASHES_PATTERN = /\/+$/u;

/**
 * Read an explicitly selected, bounded text snapshot for one Local Agent Wake.
 * The receiving workstation never mounts or receives access to the Computer.
 */
export function createAgentComputerFileHandoff(input: {
  workingDirectory: string;
  workspace: Pick<WorkspaceClient, "fs">;
}): RemoteAgentComputerFileHandoff {
  const workingDirectory = input.workingDirectory.replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );
  return {
    async readTextFiles(paths) {
      const files: Array<{ content: string; path: string }> = [];
      let totalBytes = 0;
      for (const selectedPath of paths) {
        const resolved = resolveSelectedPath({
          selectedPath,
          workingDirectory,
        });
        const declaredSize = await requireRegularFileWithoutSymlink({
          relativePath: resolved.relativePath,
          workingDirectory,
          workspace: input.workspace,
        });
        if (declaredSize > MAX_HANDOFF_FILE_BYTES) {
          throw new Error(
            `${resolved.relativePath} is larger than the 32,000 bytes allowed for one Local Agent handoff file.`
          );
        }
        const content = await input.workspace.fs.readFile(
          resolved.absolutePath,
          "utf8"
        );
        if (content.includes("\0")) {
          throw new Error(
            `${resolved.relativePath} is not a plain text file and cannot be copied to a Local Agent.`
          );
        }
        const bytes = new TextEncoder().encode(content).byteLength;
        if (bytes > MAX_HANDOFF_FILE_BYTES) {
          throw new Error(
            `${resolved.relativePath} is larger than the 32,000 bytes allowed for one Local Agent handoff file.`
          );
        }
        totalBytes += bytes;
        if (totalBytes > MAX_HANDOFF_TOTAL_BYTES) {
          throw new Error(
            "The selected Computer files exceed the 64,000-byte limit for one Local Agent Wake. Choose a smaller set."
          );
        }
        files.push({ content, path: resolved.relativePath });
      }
      return files;
    },
  };
}

function resolveSelectedPath(input: {
  selectedPath: string;
  workingDirectory: string;
}): { absolutePath: string; relativePath: string } {
  const selectedPath = input.selectedPath.trim();
  if (!selectedPath || selectedPath.includes("\0")) {
    throw new Error("A Computer handoff file path must be non-empty text.");
  }
  const rawPath = selectedPath.startsWith("/")
    ? selectedPath
    : `${input.workingDirectory}/${selectedPath}`;
  const segments: string[] = [];
  for (const segment of rawPath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      throw new Error(
        "Local Agent handoff files must stay inside the current Computer working directory."
      );
    }
    segments.push(segment);
  }
  const absolutePath = `/${segments.join("/")}`;
  if (!absolutePath.startsWith(`${input.workingDirectory}/`)) {
    throw new Error(
      "Local Agent handoff files must stay inside the current Computer working directory."
    );
  }
  const relativePath = absolutePath.slice(input.workingDirectory.length + 1);
  if (relativePath.endsWith(WORKING_COPY_METADATA_SUFFIX)) {
    throw new Error(
      "Private Computer metadata cannot be copied to a Local Agent. Choose the working file instead."
    );
  }
  return { absolutePath, relativePath };
}

async function requireRegularFileWithoutSymlink(input: {
  relativePath: string;
  workingDirectory: string;
  workspace: Pick<WorkspaceClient, "fs">;
}): Promise<number> {
  const segments = input.relativePath.split("/");
  let fileSize = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = `${input.workingDirectory}/${segments
      .slice(0, index + 1)
      .join("/")}`;
    const stat = await input.workspace.fs.lstat(candidate);
    if (stat.isSymbolicLink) {
      throw new Error(
        `${input.relativePath} crosses a symbolic link and cannot be copied to a Local Agent.`
      );
    }
    if (index === segments.length - 1 && !stat.isFile) {
      throw new Error(
        `${input.relativePath} is not a regular file and cannot be copied to a Local Agent.`
      );
    }
    if (index === segments.length - 1) {
      fileSize = stat.size;
    }
  }
  return fileSize;
}
