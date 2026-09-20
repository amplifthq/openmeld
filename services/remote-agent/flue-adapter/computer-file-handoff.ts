import type { WorkspaceClient } from "@cloudflare/computer";
import { CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES } from "@openmeld/schemas";
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
  maxBinaryFileBytes?: number;
  workingDirectory: string;
  workspace: Pick<WorkspaceClient, "fs">;
}): RemoteAgentComputerFileHandoff {
  const workingDirectory = input.workingDirectory.replace(
    TRAILING_SLASHES_PATTERN,
    ""
  );
  return {
    async readBinaryFile(path) {
      const resolved = resolveSelectedPath({
        selectedPath: path,
        workingDirectory,
      });
      const declaredSize = await requireRegularFileWithoutSymlink({
        relativePath: resolved.relativePath,
        workingDirectory,
        workspace: input.workspace,
      });
      const maxBytes =
        input.maxBinaryFileBytes ?? CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES;
      if (declaredSize > maxBytes) {
        throw new Error(
          `${resolved.relativePath} is larger than the ${maxBytes}-byte file limit.`
        );
      }
      const bytes = await readWorkspaceFileBytes(
        input.workspace,
        resolved.absolutePath
      );
      if (bytes.byteLength !== declaredSize) {
        throw new Error(
          `${resolved.relativePath} changed while OpenMeld was reading it.`
        );
      }
      return {
        bytes,
        fileName: resolved.relativePath.split("/").at(-1) ?? "file",
        path: resolved.relativePath,
      };
    },
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
    async writeChannelFile({ bytes, fileId, fileName, provider }) {
      if (
        bytes.byteLength < 1 ||
        bytes.byteLength > CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES
      ) {
        throw new Error(
          `Channel files must be between 1 and ${CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES} bytes.`
        );
      }
      const safeFileId = fileId.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 128);
      const safeFileName = fileName
        .replace(/[\\/\0]/gu, "_")
        .trim()
        .slice(0, 255);
      if (!(safeFileId && safeFileName)) {
        throw new Error(
          "Channel file identity and name must be non-empty text."
        );
      }
      const filesDirectory = `${provider}-files`;
      const directory = `${workingDirectory}/${filesDirectory}`;
      await input.workspace.fs.mkdir(directory, { recursive: true });
      const directoryStat = await input.workspace.fs.lstat(directory);
      if (directoryStat.isSymbolicLink || !directoryStat.isDirectory) {
        throw new Error(
          "The channel files directory is not a safe Computer directory."
        );
      }
      const relativePath = `${filesDirectory}/${safeFileId}-${crypto.randomUUID()}-${safeFileName}`;
      await input.workspace.fs.writeFile(
        `${workingDirectory}/${relativePath}`,
        bytes,
        { exclusive: true }
      );
      return { path: relativePath };
    },
  };
}

async function readWorkspaceFileBytes(
  workspace: Pick<WorkspaceClient, "fs">,
  path: string
): Promise<Uint8Array> {
  const stream = await workspace.fs.readFile(path);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES) {
      await reader.cancel();
      throw new Error(
        `Computer file is larger than the ${CENTER_AGENT_SLACK_FILE_MAX_SIZE_BYTES}-byte Slack file limit.`
      );
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
